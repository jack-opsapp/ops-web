import type { PropsWithChildren } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabaseClientMock } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

import { queryKeys } from "@/lib/api/query-client";
import { useLeadAssignmentRealtime } from "@/lib/hooks/use-lead-assignment-realtime";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

type ChangeHandler = (payload: { new: Record<string, unknown> }) => void;

function queryBuilder(result: { data: unknown[] | null; error: unknown }) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: promise.then.bind(promise),
  };
  return builder;
}

function harness(permissionBacklog: unknown[] = []) {
  const handlers = new Map<string, ChangeHandler>();
  const channel = {
    on: vi.fn(
      (_kind: string, config: { table: string }, handler: ChangeHandler) => {
        handlers.set(config.table, handler);
        return channel;
      }
    ),
    subscribe: vi.fn(() => channel),
  };
  const assignmentBuilder = queryBuilder({ data: [], error: null });
  const permissionBuilder = queryBuilder({
    data: permissionBacklog,
    error: null,
  });
  const from = vi.fn((table: string) =>
    table === "user_permission_change_deliveries"
      ? permissionBuilder
      : assignmentBuilder
  );
  const removeChannel = vi.fn();
  getSupabaseClientMock.mockReturnValue({
    channel: () => channel,
    from,
    removeChannel,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { handlers, permissionBuilder, queryClient, wrapper };
}

describe("lead permission realtime delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      company: { id: "company-1" } as never,
      currentUser: { id: "user-1" } as never,
    });
  });

  it("replays a missed permission change and clears sensitive caches first", async () => {
    const fetchPermissions = vi.fn().mockResolvedValue(undefined);
    usePermissionStore.setState({ fetchPermissions });
    const delivery = {
      id: "permission-delivery-1",
      company_id: "company-1",
      recipient_user_id: "user-1",
    };
    const { permissionBuilder, queryClient, wrapper } = harness([delivery]);
    const contextKey = ["opportunities", "assigned-context", "lead-1"];
    queryClient.setQueryData(contextKey, {
      activities: [{ bodyText: "private email body" }],
    });

    renderHook(() => useLeadAssignmentRealtime(), { wrapper });

    await waitFor(() =>
      expect(fetchPermissions).toHaveBeenCalledWith("user-1")
    );
    expect(queryClient.getQueryData(contextKey)).toBeUndefined();
    expect(permissionBuilder.eq).toHaveBeenCalledWith(
      "recipient_user_id",
      "user-1"
    );
    expect(permissionBuilder.limit).toHaveBeenCalledWith(1);
  });

  it("handles a live recipient-addressed permission change exactly once", async () => {
    const fetchPermissions = vi.fn().mockResolvedValue(undefined);
    usePermissionStore.setState({ fetchPermissions });
    const { handlers, queryClient, wrapper } = harness();
    const inboxKey = queryKeys.inbox.threads({ companyId: "company-1" });
    queryClient.setQueryData(inboxKey, {
      pages: [{ bodyText: "private email body" }],
    });

    renderHook(() => useLeadAssignmentRealtime(), { wrapper });
    await waitFor(() =>
      expect(handlers.has("user_permission_change_deliveries")).toBe(true)
    );

    const payload = {
      new: {
        id: "permission-delivery-1",
        company_id: "company-1",
        recipient_user_id: "user-1",
      },
    };
    await act(async () => {
      handlers.get("user_permission_change_deliveries")?.(payload);
      handlers.get("user_permission_change_deliveries")?.(payload);
      await Promise.resolve();
    });

    expect(queryClient.getQueryData(inboxKey)).toBeUndefined();
    expect(fetchPermissions).toHaveBeenCalledTimes(1);
  });

  it("redacts a mounted sensitive query before refreshing it under fresh permissions", async () => {
    let releasePermissions!: () => void;
    const permissionsPending = new Promise<void>((resolve) => {
      releasePermissions = resolve;
    });
    const fetchPermissions = vi.fn(() => permissionsPending);
    usePermissionStore.setState({ fetchPermissions });

    const secret = { bodyText: "private email body" };
    const refreshed = { bodyText: "authorized refresh" };
    const fetchThread = vi
      .fn()
      .mockResolvedValueOnce(secret)
      .mockResolvedValueOnce(refreshed);
    const { handlers, wrapper } = harness();
    const inboxKey = queryKeys.inbox.threadDetail("thread-1");
    const { result } = renderHook(
      () => {
        useLeadAssignmentRealtime();
        return useQuery({
          queryKey: inboxKey,
          queryFn: fetchThread,
          staleTime: Infinity,
        });
      },
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(secret));
    await waitFor(() =>
      expect(handlers.has("user_permission_change_deliveries")).toBe(true)
    );

    await act(async () => {
      handlers.get("user_permission_change_deliveries")?.({
        new: {
          id: "permission-delivery-active-query",
          company_id: "company-1",
          recipient_user_id: "user-1",
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.data).toBeUndefined());
    expect(fetchThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      releasePermissions();
      await permissionsPending;
    });

    await waitFor(() => expect(result.current.data).toEqual(refreshed));
    expect(fetchThread).toHaveBeenCalledTimes(2);
  });
});

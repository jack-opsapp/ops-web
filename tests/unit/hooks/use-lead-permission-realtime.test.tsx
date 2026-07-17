import type { PropsWithChildren } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabaseClientMock, toastInfoMock } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    info: toastInfoMock,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { queryKeys } from "@/lib/api/query-client";
import {
  cancelAuthorityVerificationDeadline,
  reconcileLeadAssignmentDelivery,
  useLeadAssignmentRealtime,
} from "@/lib/hooks/use-lead-assignment-realtime";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

type ChangeHandler = (payload: { new: Record<string, unknown> }) => void;

function queryBuilder(result: { data: unknown[] | null; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (
      onFulfilled: (value: { data: unknown[] | null; error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function harness(
  permissionBacklog: unknown[] = [],
  options?: {
    assignmentResult?: { data: unknown[] | null; error: unknown };
    permissionResult?: { data: unknown[] | null; error: unknown };
  }
) {
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
  const assignmentBuilder = queryBuilder(
    options?.assignmentResult ?? { data: [], error: null }
  );
  const permissionBuilder = queryBuilder(
    options?.permissionResult ?? { data: permissionBacklog, error: null }
  );
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
    // The fail-closed deadline is module-level state — never let one test's
    // armed timer bleed into the next.
    cancelAuthorityVerificationDeadline();
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

  it("toasts exactly once when a live delivery revokes a visible lead", async () => {
    const fetchPermissions = vi.fn().mockResolvedValue(undefined);
    usePermissionStore.setState({ fetchPermissions });
    const { handlers, queryClient, wrapper } = harness();
    const listKey = queryKeys.opportunities.list("company-1");
    queryClient.setQueryData(listKey, [
      { id: "lead-1", title: "Deck rebuild", contactName: "Jordan Lee" },
    ]);

    renderHook(() => useLeadAssignmentRealtime(), { wrapper });
    await waitFor(() =>
      expect(handlers.has("opportunity_assignment_deliveries")).toBe(true)
    );

    const payload = {
      new: {
        id: "delivery-1",
        company_id: "company-1",
        opportunity_id: "lead-1",
        recipient_user_id: "user-1",
        access_after: false,
        assignment_version: 2,
      },
    };
    await act(async () => {
      handlers.get("opportunity_assignment_deliveries")?.(payload);
      // A duplicate live payload (same version) must not double-announce.
      handlers.get("opportunity_assignment_deliveries")?.(payload);
      await Promise.resolve();
    });

    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastInfoMock.mock.calls[0] as [
      string,
      { description?: string },
    ];
    expect(title).toBe("Lead reassigned");
    // Cached display name (contact name here — no client on the row), never
    // the new assignee.
    expect(options?.description).toContain("Jordan Lee");
    expect(queryClient.getQueryData(listKey)).toEqual([]);
  });

  it("holds last-good data through a transient replay failure, then fails closed at the deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchPermissions = vi.fn().mockResolvedValue(undefined);
      usePermissionStore.setState({ fetchPermissions });

      // Both backlog reads fail — a dead edge / offline blip, NOT a confirmed
      // revocation.
      const failure = { data: null, error: new Error("connection down") };
      const { queryClient, wrapper } = harness([], {
        assignmentResult: failure,
        permissionResult: failure,
      });
      const listKey = queryKeys.opportunities.list("company-1");
      queryClient.setQueryData(listKey, [{ id: "lead-1" }]);

      const { unmount } = renderHook(() => useLeadAssignmentRealtime(), {
        wrapper,
      });

      // Initial read + the full 1s/3s/9s backoff, all failing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(13_100);
      });

      // Grace path: data holds (invalidated, not reset), authority re-derived
      // in hold mode — no revoke-first wipe.
      expect(queryClient.getQueryData(listKey)).toEqual([{ id: "lead-1" }]);
      expect(fetchPermissions).toHaveBeenCalledWith("user-1", {
        mode: "hold",
      });
      expect(fetchPermissions).not.toHaveBeenCalledWith("user-1", {
        mode: "revoke-first",
      });

      // No replay success and no SUBSCRIBED before the 3-minute deadline →
      // the destructive fail-closed fallback runs.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * 60_000);
      });

      expect(queryClient.getQueryData(listKey)).toBeUndefined();
      expect(fetchPermissions).toHaveBeenCalledWith("user-1", {
        mode: "revoke-first",
      });

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts a mounted sensitive query while a revoked assignment refetches under RLS", async () => {
    let releaseRefetch!: (value: { bodyText: string }) => void;
    const refetchPending = new Promise<{ bodyText: string }>((resolve) => {
      releaseRefetch = resolve;
    });
    const secret = { bodyText: "private email body" };
    const refreshed = { bodyText: "remaining authorized thread" };
    const fetchThread = vi
      .fn()
      .mockResolvedValueOnce(secret)
      .mockReturnValueOnce(refetchPending);
    const { queryClient, wrapper } = harness();
    const inboxKey = queryKeys.inbox.threadDetail("thread-1");
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: inboxKey,
          queryFn: fetchThread,
          staleTime: Infinity,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(secret));

    act(() => {
      reconcileLeadAssignmentDelivery(queryClient, {
        opportunityId: "lead-1",
        accessAfter: false,
      });
    });

    await waitFor(() => expect(result.current.data).toBeUndefined());
    expect(fetchThread).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseRefetch(refreshed);
      await refetchPending;
    });

    await waitFor(() => expect(result.current.data).toEqual(refreshed));
  });
});

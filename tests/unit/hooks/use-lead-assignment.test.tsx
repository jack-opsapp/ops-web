import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { changeAssignmentMock } = vi.hoisted(() => ({
  changeAssignmentMock: vi.fn(),
}));

const { toastInfo } = vi.hoisted(() => ({
  toastInfo: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { info: toastInfo },
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) =>
      ({
        "toast.leadReassignedAway": "Lead reassigned",
        "toast.leadReassignedAwayDesc": "{title} is no longer yours.",
        "toast.leadReassignedAwayFallback": "A lead",
      })[key] ??
      fallback ??
      key,
  }),
}));

vi.mock("@/lib/firebase/auth", () => ({ getIdToken: vi.fn() }));

vi.mock(
  "@/lib/api/services/lead-assignment-service",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/lib/api/services/lead-assignment-service")
      >();
    return {
      ...original,
      LeadAssignmentService: { changeAssignment: changeAssignmentMock },
    };
  }
);

import { queryKeys } from "@/lib/api/query-client";
import {
  LeadAssignmentAccessLostError,
  LeadAssignmentConflictError,
} from "@/lib/api/services/lead-assignment-service";
import { useLeadAssignment } from "@/lib/hooks/use-lead-assignment";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { Opportunity } from "@/lib/types/pipeline";

const input = {
  opportunityId: "11111111-1111-4111-8111-111111111111",
  expectedAssignedTo: "22222222-2222-4222-8222-222222222222",
  expectedAssignmentVersion: 7,
  newAssignedTo: "33333333-3333-4333-8333-333333333333",
} as const;

const cachedOpportunity = {
  id: input.opportunityId,
  assignedTo: input.expectedAssignedTo,
  assignmentVersion: input.expectedAssignmentVersion,
  title: "Framing consultation",
} as Opportunity;

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(
    queryKeys.opportunities.detail(input.opportunityId),
    cachedOpportunity
  );
  queryClient.setQueryData(queryKeys.opportunities.list("company-1"), [
    cachedOpportunity,
  ]);

  return {
    queryClient,
    wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    },
  };
}

describe("useLeadAssignment", () => {
  beforeEach(() => {
    changeAssignmentMock.mockReset();
    toastInfo.mockReset();
    useAuthStore.setState({
      company: { id: "company-1" } as never,
      currentUser: { id: input.expectedAssignedTo } as never,
    });
    usePermissionStore.setState({
      permissions: new Map([["pipeline.view", "all"]]),
      configuredPermissions: new Set(["pipeline.view"]),
      initialized: true,
    });
  });

  it("does not optimistically assign and then merges the authoritative result", async () => {
    let resolve!: (value: {
      ok: true;
      conflict: false;
      assignedTo: string;
      assignmentVersion: number;
      eventId: string;
    }) => void;
    changeAssignmentMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useLeadAssignment(), { wrapper });

    act(() => result.current.mutate(input));

    expect(
      queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(input.opportunityId)
      )?.assignedTo
    ).toBe(input.expectedAssignedTo);

    await act(async () => {
      resolve({
        ok: true,
        conflict: false,
        assignedTo: input.newAssignedTo,
        assignmentVersion: 8,
        eventId: "44444444-4444-4444-8444-444444444444",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(input.opportunityId)
      )
    ).toMatchObject({ assignedTo: input.newAssignedTo, assignmentVersion: 8 });
    expect(
      queryClient.getQueryData<Opportunity[]>(
        queryKeys.opportunities.list("company-1")
      )?.[0]
    ).toMatchObject({ assignedTo: input.newAssignedTo, assignmentVersion: 8 });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.metrics.all,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.inbox.all,
    });
  });

  it("merges the locked server snapshot on conflict before invalidating", async () => {
    changeAssignmentMock.mockRejectedValueOnce(
      new LeadAssignmentConflictError(null, 9)
    );
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useLeadAssignment(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input).catch(() => undefined);
    });

    expect(
      queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(input.opportunityId)
      )
    ).toMatchObject({ assignedTo: null, assignmentVersion: 9 });
    expect(
      queryClient.getQueryData<Opportunity[]>(
        queryKeys.opportunities.list("company-1")
      )?.[0]
    ).toMatchObject({ assignedTo: null, assignmentVersion: 9 });
  });

  it("purges immediately when the authoritative transfer removes assigned access", async () => {
    usePermissionStore.setState({
      permissions: new Map([["pipeline.view", "assigned"]]),
      configuredPermissions: new Set(["pipeline.view"]),
      initialized: true,
    });
    changeAssignmentMock.mockResolvedValueOnce({
      ok: true,
      conflict: false,
      assignedTo: input.newAssignedTo,
      assignmentVersion: 8,
      eventId: "44444444-4444-4444-8444-444444444444",
    });
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useLeadAssignment(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(
      queryClient.getQueryData(
        queryKeys.opportunities.detail(input.opportunityId)
      )
    ).toBeUndefined();
    expect(
      queryClient.getQueryData<Opportunity[]>(
        queryKeys.opportunities.list("company-1")
      )
    ).toBeUndefined();
    expect(toastInfo).toHaveBeenCalledWith("Lead reassigned", {
      description: "Framing consultation is no longer yours.",
    });
  });

  it("purges stale lead data when a completed transfer revokes the caller's access", async () => {
    usePermissionStore.setState({
      permissions: new Map([["pipeline.view", "assigned"]]),
      configuredPermissions: new Set(["pipeline.view"]),
      initialized: true,
    });
    changeAssignmentMock.mockRejectedValueOnce(
      new LeadAssignmentAccessLostError()
    );
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useLeadAssignment(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input).catch(() => undefined);
    });

    expect(
      queryClient.getQueryData(
        queryKeys.opportunities.detail(input.opportunityId)
      )
    ).toBeUndefined();
    expect(
      queryClient.getQueryData<Opportunity[]>(
        queryKeys.opportunities.list("company-1")
      )
    ).toBeUndefined();
  });
});

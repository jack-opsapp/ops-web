import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-client";
import {
  armAuthorityVerificationDeadline,
  cancelAuthorityVerificationDeadline,
  reconcileLeadAssignmentBacklog,
  reconcileLeadAssignmentDelivery,
  reconcilePermissionChangeDelivery,
  replayWithRetryAndDeadline,
  type AssignmentDeliveryRow,
} from "@/lib/hooks/use-lead-assignment-realtime";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { useWindowStore } from "@/stores/window-store";
import type { Opportunity } from "@/lib/types/pipeline";

function opportunity(id: string): Opportunity {
  return { id } as Opportunity;
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  usePipelineModeStore.setState({ detailPanelOpportunityId: null });
  useWindowStore.setState({ windows: [], nextZIndex: 2_000 });
});

describe("reconcileLeadAssignmentDelivery", () => {
  it("immediately purges a revoked lead and every access-sensitive surface", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    const inboxKey = queryKeys.inbox.threads({ companyId: "company-1" });
    const metricsKey = queryKeys.metrics.tab("leads", "company-1");
    const clientKey = queryKeys.clients.detail("client-1");
    const estimateKey = queryKeys.estimates.detail("estimate-1");
    const siteVisitKey = queryKeys.siteVisits.detail("visit-1");
    const commentKey = queryKeys.activityComments.byActivity("activity-1");
    const draftKey = queryKeys.aiDrafting.pendingSends("company-1");
    const approvalKey = queryKeys.approvalQueue.detail("approval-1");

    client.setQueryData(listKey, [
      opportunity("lead-1"),
      opportunity("lead-2"),
    ]);
    client.setQueryData(
      queryKeys.opportunities.detail("lead-1"),
      opportunity("lead-1")
    );
    client.setQueryData(queryKeys.opportunities.activities("lead-1"), [
      { id: "activity-1" },
    ]);
    client.setQueryData(inboxKey, { pages: [{ id: "thread-1" }] });
    client.setQueryData(metricsKey, { count: 2 });
    client.setQueryData(clientKey, { id: "client-1", phone: "555-0100" });
    client.setQueryData(estimateKey, { id: "estimate-1" });
    client.setQueryData(siteVisitKey, { id: "visit-1" });
    client.setQueryData(commentKey, [{ id: "comment-1" }]);
    client.setQueryData(draftKey, [{ id: "draft-1" }]);
    client.setQueryData(approvalKey, { id: "approval-1" });
    usePipelineModeStore.setState({ detailPanelOpportunityId: "lead-1" });
    useWindowStore.setState({
      windows: [
        {
          id: "pipeline-detail:lead-1",
          title: "Lead",
          type: "pipeline-detail",
          isMinimized: false,
          position: { x: 0, y: 0 },
          size: { width: 780, height: 680 },
          zIndex: 2_000,
          metadata: { opportunityId: "lead-1" },
        },
      ],
    });

    reconcileLeadAssignmentDelivery(client, {
      opportunityId: "lead-1",
      accessAfter: false,
    });

    expect(
      client.getQueryData<Opportunity[]>(listKey)?.map(({ id }) => id)
    ).toEqual(["lead-2"]);
    expect(
      client.getQueryData(queryKeys.opportunities.detail("lead-1"))
    ).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.opportunities.activities("lead-1"))
    ).toBeUndefined();
    expect(client.getQueryData(inboxKey)).toBeUndefined();
    expect(client.getQueryData(metricsKey)).toBeUndefined();
    expect(client.getQueryData(clientKey)).toBeUndefined();
    expect(client.getQueryData(estimateKey)).toBeUndefined();
    expect(client.getQueryData(siteVisitKey)).toBeUndefined();
    expect(client.getQueryData(commentKey)).toBeUndefined();
    expect(client.getQueryData(draftKey)).toBeUndefined();
    expect(client.getQueryData(approvalKey)).toBeUndefined();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
    expect(useWindowStore.getState().windows).toEqual([]);
  });

  it("replays a missed backlog at only the latest version per lead", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    client.setQueryData(listKey, [opportunity("lead-1")]);
    const seen = new Map<string, number>();
    const rows: AssignmentDeliveryRow[] = [
      {
        id: "delivery-1",
        company_id: "company-1",
        opportunity_id: "lead-1",
        recipient_user_id: "user-1",
        access_after: false,
        assignment_version: 1,
      },
      {
        id: "delivery-2",
        company_id: "company-1",
        opportunity_id: "lead-1",
        recipient_user_id: "user-1",
        access_after: true,
        assignment_version: 2,
      },
    ];

    reconcileLeadAssignmentBacklog(client, rows, "company-1", "user-1", seen);

    expect(client.getQueryData(listKey)).toEqual([opportunity("lead-1")]);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(seen.get("lead-1")).toBe(2);
  });

  it("dedupes reconnect replays and applies only a newer revocation", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    client.setQueryData(listKey, [opportunity("lead-1")]);
    const seen = new Map<string, number>();
    const retained: AssignmentDeliveryRow = {
      id: "delivery-2",
      company_id: "company-1",
      opportunity_id: "lead-1",
      recipient_user_id: "user-1",
      access_after: true,
      assignment_version: 2,
    };

    reconcileLeadAssignmentBacklog(
      client,
      [retained],
      "company-1",
      "user-1",
      seen
    );
    client.setQueryData(listKey, [opportunity("lead-1")]);
    reconcileLeadAssignmentBacklog(
      client,
      [retained],
      "company-1",
      "user-1",
      seen
    );
    expect(client.getQueryData(listKey)).toEqual([opportunity("lead-1")]);

    reconcileLeadAssignmentBacklog(
      client,
      [
        {
          ...retained,
          id: "delivery-3",
          access_after: false,
          assignment_version: 3,
        },
      ],
      "company-1",
      "user-1",
      seen
    );
    expect(client.getQueryData(listKey)).toEqual([]);
    expect(seen.get("lead-1")).toBe(3);
  });

  it("invalidates every dependent namespace when access remains available", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    const detailKey = queryKeys.opportunities.detail("lead-1");
    const candidatesKey =
      queryKeys.opportunities.assignmentCandidates("lead-1");
    const inboxKey = queryKeys.inbox.threads({ companyId: "company-1" });
    const metricsKey = queryKeys.metrics.tab("leads", "company-1");

    for (const key of [
      listKey,
      detailKey,
      candidatesKey,
      inboxKey,
      metricsKey,
    ]) {
      client.setQueryData(key, { seeded: true });
    }

    reconcileLeadAssignmentDelivery(client, {
      opportunityId: "lead-1",
      accessAfter: true,
    });

    for (const key of [
      listKey,
      detailKey,
      candidatesKey,
      inboxKey,
      metricsKey,
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("closes every lead-backed window, not only the primary detail window", () => {
    const client = queryClient();
    const closeWindow = vi.spyOn(useWindowStore.getState(), "closeWindow");
    useWindowStore.setState({
      windows: [
        {
          id: "compose:lead-1",
          title: "Compose",
          type: "compose-email",
          isMinimized: false,
          position: { x: 0, y: 0 },
          size: { width: 620, height: 680 },
          zIndex: 2_000,
          metadata: { opportunityId: "lead-1" },
        },
        {
          id: "compose:lead-2",
          title: "Other",
          type: "compose-email",
          isMinimized: false,
          position: { x: 0, y: 0 },
          size: { width: 620, height: 680 },
          zIndex: 2_001,
          metadata: { opportunityId: "lead-2" },
        },
      ],
    });

    reconcileLeadAssignmentDelivery(client, {
      opportunityId: "lead-1",
      accessAfter: false,
    });

    expect(closeWindow).toHaveBeenCalledWith("compose:lead-1");
    expect(useWindowStore.getState().windows.map(({ id }) => id)).toEqual([
      "compose:lead-2",
    ]);
  });
});

describe("lead-revoked notification", () => {
  it("notifies exactly once with the cached display title when a visible lead is revoked", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    client.setQueryData(listKey, [
      {
        id: "lead-1",
        title: "Deck rebuild",
        contactName: "Jordan Lee",
        client: { name: "Acme Exteriors" },
      } as unknown as Opportunity,
      opportunity("lead-2"),
    ]);
    const onLeadRevoked = vi.fn();

    reconcileLeadAssignmentDelivery(
      client,
      { opportunityId: "lead-1", accessAfter: false },
      onLeadRevoked
    );

    expect(onLeadRevoked).toHaveBeenCalledTimes(1);
    expect(onLeadRevoked).toHaveBeenCalledWith({ title: "Acme Exteriors" });
    // The purge itself still ran.
    expect(
      client.getQueryData<Opportunity[]>(listKey)?.map(({ id }) => id)
    ).toEqual(["lead-2"]);
  });

  it("stays silent when the revoked lead was not visible in any list cache", () => {
    const client = queryClient();
    const onLeadRevoked = vi.fn();

    // Boot-time backlog replay over an empty cache: nothing vanished before
    // the operator's eyes, so nothing announces.
    reconcileLeadAssignmentDelivery(
      client,
      { opportunityId: "lead-1", accessAfter: false },
      onLeadRevoked
    );

    expect(onLeadRevoked).not.toHaveBeenCalled();
  });

  it("does not notify for retained or gained access", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    client.setQueryData(listKey, [opportunity("lead-1")]);
    const onLeadRevoked = vi.fn();

    reconcileLeadAssignmentDelivery(
      client,
      { opportunityId: "lead-1", accessAfter: true },
      onLeadRevoked
    );

    expect(onLeadRevoked).not.toHaveBeenCalled();
  });

  it("dedupes the notification when the same revocation version replays", () => {
    const client = queryClient();
    const listKey = queryKeys.opportunities.list("company-1");
    const seen = new Map<string, number>();
    const onLeadRevoked = vi.fn();
    const revocation: AssignmentDeliveryRow = {
      id: "delivery-1",
      company_id: "company-1",
      opportunity_id: "lead-1",
      recipient_user_id: "user-1",
      access_after: false,
      assignment_version: 3,
    };

    client.setQueryData(listKey, [
      { id: "lead-1", title: "Deck rebuild" } as unknown as Opportunity,
    ]);
    reconcileLeadAssignmentBacklog(
      client,
      [revocation],
      "company-1",
      "user-1",
      seen,
      onLeadRevoked
    );
    // Reconnect replays the same delivery; the lead is even back in cache
    // (e.g. a stale refetch) — the seen-version dedupe must keep it silent.
    client.setQueryData(listKey, [
      { id: "lead-1", title: "Deck rebuild" } as unknown as Opportunity,
    ]);
    reconcileLeadAssignmentBacklog(
      client,
      [revocation],
      "company-1",
      "user-1",
      seen,
      onLeadRevoked
    );

    expect(onLeadRevoked).toHaveBeenCalledTimes(1);
    expect(onLeadRevoked).toHaveBeenCalledWith({ title: "Deck rebuild" });
  });
});

describe("replayWithRetryAndDeadline", () => {
  it("retries a failing replay on backoff and recovers without failing closed", async () => {
    const runReplay = vi.fn(async () => false);
    runReplay
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onSuccess = vi.fn();
    const onFinalFailure = vi.fn();
    const sleep = vi.fn(async (_ms: number) => {});

    const result = await replayWithRetryAndDeadline({
      runReplay,
      onSuccess,
      onFinalFailure,
      isDisposed: () => false,
      sleep,
    });

    expect(result).toBe(true);
    // Initial attempt + three backoff retries, recovering on the fourth.
    expect(runReplay).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([
      1_000, 3_000, 9_000,
    ]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it("hands off to the fail-closed path only after every retry is exhausted", async () => {
    const runReplay = vi.fn(async () => false);
    const onSuccess = vi.fn();
    const onFinalFailure = vi.fn();

    const result = await replayWithRetryAndDeadline({
      runReplay,
      onSuccess,
      onFinalFailure,
      isDisposed: () => false,
      sleep: async () => {},
    });

    expect(result).toBe(false);
    expect(runReplay).toHaveBeenCalledTimes(4);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("stops retrying and never fails closed once disposed mid-backoff", async () => {
    let disposed = false;
    const runReplay = vi.fn(async () => false);
    const onFinalFailure = vi.fn();
    const sleep = vi.fn(async () => {
      disposed = true; // the effect tore down during the wait
    });

    const result = await replayWithRetryAndDeadline({
      runReplay,
      onSuccess: vi.fn(),
      onFinalFailure,
      isDisposed: () => disposed,
      sleep,
    });

    expect(result).toBe(false);
    expect(runReplay).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });
});

describe("authority verification deadline", () => {
  beforeEach(() => {
    cancelAuthorityVerificationDeadline();
  });

  it("fires the destructive fallback exactly once after the deadline elapses", () => {
    vi.useFakeTimers();
    try {
      const fallback = vi.fn();
      armAuthorityVerificationDeadline(fallback);
      // A second arm while one is pending must not schedule a second wipe.
      armAuthorityVerificationDeadline(fallback);
      vi.advanceTimersByTime(3 * 60_000);
      expect(fallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel prevents the fallback from firing", () => {
    vi.useFakeTimers();
    try {
      const fallback = vi.fn();
      armAuthorityVerificationDeadline(fallback);
      cancelAuthorityVerificationDeadline();
      vi.advanceTimersByTime(3 * 60_000);
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("reconcilePermissionChangeDelivery", () => {
  it("clears sensitive lead and email state before refreshing permissions", async () => {
    const client = queryClient();
    const assignedContextKey = ["opportunities", "assigned-context", "lead-1"];
    client.setQueryData(queryKeys.opportunities.list("company-1"), [
      opportunity("lead-1"),
    ]);
    client.setQueryData(assignedContextKey, {
      activities: [{ bodyText: "private email body" }],
    });
    usePipelineModeStore.setState({ detailPanelOpportunityId: "lead-1" });
    useWindowStore.setState({
      windows: [
        {
          id: "pipeline-detail:lead-1",
          title: "Lead",
          type: "pipeline-detail",
          isMinimized: false,
          position: { x: 0, y: 0 },
          size: { width: 780, height: 680 },
          zIndex: 2_000,
          metadata: { opportunityId: "lead-1" },
        },
      ],
    });
    let finishRefresh!: () => void;
    const fetchPermissions = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        })
    );
    usePermissionStore.setState({ fetchPermissions });

    const refresh = reconcilePermissionChangeDelivery(
      client,
      {
        id: "delivery-1",
        company_id: "company-1",
        recipient_user_id: "user-1",
      },
      "user-1"
    );

    expect(client.getQueryData(assignedContextKey)).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.opportunities.list("company-1"))
    ).toBeUndefined();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
    expect(useWindowStore.getState().windows).toEqual([]);
    expect(fetchPermissions).toHaveBeenCalledWith("user-1");

    finishRefresh();
    await expect(refresh).resolves.toBe(true);
  });

  it("ignores a permission delivery addressed to another user", async () => {
    const client = queryClient();
    const key = queryKeys.opportunities.list("company-1");
    client.setQueryData(key, [opportunity("lead-1")]);
    const fetchPermissions = vi.fn();
    usePermissionStore.setState({ fetchPermissions });

    await expect(
      reconcilePermissionChangeDelivery(
        client,
        {
          id: "delivery-1",
          company_id: "company-1",
          recipient_user_id: "other-user",
        },
        "user-1"
      )
    ).resolves.toBe(false);

    expect(client.getQueryData(key)).toEqual([opportunity("lead-1")]);
    expect(fetchPermissions).not.toHaveBeenCalled();
  });
});

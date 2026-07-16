import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-client";
import {
  reconcileLeadAssignmentBacklog,
  reconcileLeadAssignmentDelivery,
  reconcilePermissionChangeDelivery,
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

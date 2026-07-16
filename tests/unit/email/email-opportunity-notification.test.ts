import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createClassifiedEmailThreadNotifications,
  createEmailOpportunityNotification,
} from "@/lib/email/email-opportunity-notification";

describe("createEmailOpportunityNotification", () => {
  it("passes only the exact lead mailbox thread snapshot to the service operation", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const result = await createEmailOpportunityNotification({
      opportunityId: "00000000-0000-4000-8000-000000000001",
      connectionId: "00000000-0000-4000-8000-000000000002",
      providerThreadId: "provider-thread-1",
      expectedAssignmentVersion: 7,
      eventType: "terminal_likely_won",
      supabase: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "create_email_opportunity_notification_as_system",
      {
        p_opportunity_id: "00000000-0000-4000-8000-000000000001",
        p_connection_id: "00000000-0000-4000-8000-000000000002",
        p_provider_thread_id: "provider-thread-1",
        p_expected_assignment_version: 7,
        p_event_type: "terminal_likely_won",
      }
    );
  });

  it("returns no delivery when the locked assignment snapshot is stale", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    await expect(
      createEmailOpportunityNotification({
        opportunityId: "00000000-0000-4000-8000-000000000001",
        connectionId: "00000000-0000-4000-8000-000000000002",
        providerThreadId: "provider-thread-1",
        expectedAssignmentVersion: 6,
        eventType: "accept_review_won",
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).resolves.toBe(false);
  });
});

describe("createClassifiedEmailThreadNotifications", () => {
  const previous = {
    id: "00000000-0000-4000-8000-000000000003",
    companyId: "00000000-0000-4000-8000-000000000004",
    connectionId: "00000000-0000-4000-8000-000000000005",
    providerThreadId: "provider-thread-1",
    opportunityId: "00000000-0000-4000-8000-000000000006",
    primaryCategory: "OTHER",
    labels: [] as string[],
    latestDirection: "inbound" as const,
  };

  function client(input?: {
    assignmentVersion?: number | null;
    rpcResults?: boolean[];
  }) {
    const maybeSingle = vi.fn(async () => ({
      data:
        input?.assignmentVersion === null
          ? null
          : { assignment_version: input?.assignmentVersion ?? 8 },
      error: null,
    }));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      maybeSingle,
    };
    const from = vi.fn(() => query);
    const results = [...(input?.rpcResults ?? [true, true])];
    const rpc = vi.fn(async () => ({
      data: results.shift() ?? false,
      error: null,
    }));
    return { supabase: { from, rpc } as unknown as SupabaseClient, from, rpc };
  }

  it("delivers new-customer and urgent alerts only through the locked assignee operation", async () => {
    const { supabase, from, rpc } = client();
    const delivered = await createClassifiedEmailThreadNotifications({
      previous,
      next: {
        ...previous,
        primaryCategory: "CUSTOMER",
        labels: ["URGENT"],
      },
      supabase,
    });

    expect(delivered).toBe(2);
    expect(from).toHaveBeenCalledWith("opportunities");
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "create_email_opportunity_notification_as_system",
      expect.objectContaining({
        p_expected_assignment_version: 8,
        p_event_type: "thread_customer",
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "create_email_opportunity_notification_as_system",
      expect.objectContaining({
        p_expected_assignment_version: 8,
        p_event_type: "thread_urgent",
      })
    );
  });

  it("does not notify a connector user for an unlinked shared-mailbox thread", async () => {
    const { supabase, from, rpc } = client();
    const delivered = await createClassifiedEmailThreadNotifications({
      previous: { ...previous, opportunityId: null },
      next: {
        ...previous,
        opportunityId: null,
        primaryCategory: "CUSTOMER",
      },
      supabase,
    });

    expect(delivered).toBe(0);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not alert on outbound classification changes", async () => {
    const { supabase, from, rpc } = client();
    const delivered = await createClassifiedEmailThreadNotifications({
      previous,
      next: {
        ...previous,
        primaryCategory: "PLATFORM_BID",
        latestDirection: "outbound",
      },
      supabase,
    });

    expect(delivered).toBe(0);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

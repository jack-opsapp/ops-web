import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildLeadAssignmentPushBody,
  LeadAssignmentDeliveryService,
} from "@/lib/api/services/lead-assignment-delivery-service";

const visibleClaim = {
  delivery_id: "11111111-1111-4111-8111-111111111111",
  delivery_lease_token: "22222222-2222-4222-8222-222222222222",
  assignment_event_id: "33333333-3333-4333-8333-333333333333",
  company_id: "44444444-4444-4444-8444-444444444444",
  opportunity_id: "55555555-5555-4555-8555-555555555555",
  recipient_user_id: "66666666-6666-4666-8666-666666666666",
  notification_id: "77777777-7777-4777-8777-777777777777",
  lead_title: "Canpro framing renovation",
  should_push: true,
  requires_notification: true,
  disposition: "notified",
};

function rpcClient(params: {
  claims?: Array<Record<string, unknown>>;
  claimError?: { message: string } | null;
  completeError?: { message: string } | null;
  completeData?: Record<string, unknown>;
  failTerminal?: boolean;
}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_opportunity_assignment_deliveries") {
      return {
        data: params.claims ?? [],
        error: params.claimError ?? null,
      };
    }
    if (name === "complete_opportunity_assignment_delivery") {
      return {
        data: params.completeError
          ? null
          : (params.completeData ?? { ok: true }),
        error: params.completeError ?? null,
      };
    }
    if (name === "fail_opportunity_assignment_delivery") {
      return {
        data: { ok: true, terminal: params.failTerminal ?? false },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  return {
    rpc,
    client: { rpc } as unknown as SupabaseClient,
  };
}

describe("LeadAssignmentDeliveryService", () => {
  const sendPush = vi.fn();

  beforeEach(() => {
    sendPush.mockReset();
  });

  it("claims with a bounded lease and returns an empty operational summary", async () => {
    const { client, rpc } = rpcClient({});

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 17, leaseSeconds: 240, workerId: "worker-1" },
      { sendPush }
    );

    expect(rpc).toHaveBeenCalledWith(
      "claim_opportunity_assignment_deliveries",
      {
        p_worker_id: "worker-1",
        p_limit: 17,
        p_lease_seconds: 240,
      }
    );
    expect(result).toEqual({
      claimed: 0,
      consumed: 0,
      delivered: 0,
      pushed: 0,
      pushSuppressed: 0,
      requeued: 0,
      terminalFailed: 0,
      errors: [],
    });
  });

  it("completes preference-suppressed push while preserving the rail", async () => {
    const { client, rpc } = rpcClient({
      claims: [{ ...visibleClaim, should_push: false }],
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_opportunity_assignment_delivery",
      {
        p_delivery_id: visibleClaim.delivery_id,
        p_lease_token: visibleClaim.delivery_lease_token,
        p_push_state: "suppressed",
      }
    );
    expect(result).toMatchObject({
      claimed: 1,
      delivered: 1,
      pushed: 0,
      pushSuppressed: 1,
      errors: [],
    });
  });

  it("reports a completion-time access loss as consumed instead of delivered", async () => {
    const { client } = rpcClient({
      claims: [{ ...visibleClaim, should_push: false }],
      completeData: { ok: true, suppressed: true },
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(result).toMatchObject({
      claimed: 1,
      consumed: 1,
      delivered: 0,
      pushSuppressed: 1,
    });
  });

  it("sends retry-safe iOS lead data and completes only after provider success", async () => {
    const { client, rpc } = rpcClient({ claims: [visibleClaim] });
    sendPush.mockResolvedValue({
      ok: true,
      recipients: 1,
      onesignalId: "os-1",
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledWith({
      recipientUserIds: [visibleClaim.recipient_user_id],
      title: "Lead assigned",
      body: "Open Canpro framing renovation",
      data: {
        leadId: visibleClaim.opportunity_id,
        screen: "leadDetails",
        type: "lead_assigned",
      },
      idempotencyKey: visibleClaim.delivery_id,
    });
    const callNames = rpc.mock.calls.map(([name]) => name);
    expect(callNames).toEqual([
      "claim_opportunity_assignment_deliveries",
      "complete_opportunity_assignment_delivery",
    ]);
    expect(result).toMatchObject({ delivered: 1, pushed: 1, errors: [] });
  });

  it("requeues retryable provider failures without falsely completing", async () => {
    const { client, rpc } = rpcClient({ claims: [visibleClaim] });
    sendPush.mockResolvedValue({
      ok: false,
      error: "unavailable",
      status: 503,
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(rpc).not.toHaveBeenCalledWith(
      "complete_opportunity_assignment_delivery",
      expect.anything()
    );
    expect(rpc).toHaveBeenCalledWith(
      "fail_opportunity_assignment_delivery",
      expect.objectContaining({
        p_delivery_id: visibleClaim.delivery_id,
        p_lease_token: visibleClaim.delivery_lease_token,
        p_retryable: true,
      })
    );
    expect(result).toMatchObject({
      delivered: 0,
      requeued: 1,
      terminalFailed: 0,
    });
    expect(result.errors).toHaveLength(1);
  });

  it("terminalizes non-retryable provider rejection", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      failTerminal: true,
    });
    sendPush.mockResolvedValue({
      ok: false,
      error: "invalid target",
      status: 400,
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(rpc).toHaveBeenCalledWith(
      "fail_opportunity_assignment_delivery",
      expect.objectContaining({ p_retryable: false })
    );
    expect(result).toMatchObject({ requeued: 0, terminalFailed: 1 });
  });

  it("requeues when completion fails after an acknowledged idempotent push", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      completeError: { message: "database timeout" },
    });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(rpc).toHaveBeenCalledWith(
      "fail_opportunity_assignment_delivery",
      expect.objectContaining({
        p_retryable: true,
        p_error: expect.stringContaining("database timeout"),
      })
    );
    expect(result).toMatchObject({ delivered: 0, requeued: 1 });
  });

  it("counts silently consumed old-assignee or stale rows without channel work", async () => {
    const { client, rpc } = rpcClient({
      claims: [
        {
          ...visibleClaim,
          delivery_lease_token: null,
          notification_id: null,
          should_push: false,
          requires_notification: false,
          disposition: "silent",
        },
      ],
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ claimed: 1, consumed: 1, delivered: 0 });
  });

  it("surfaces an exhausted recovered lease as a terminal failure", async () => {
    const { client } = rpcClient({
      claims: [
        {
          ...visibleClaim,
          delivery_lease_token: null,
          should_push: false,
          requires_notification: false,
          disposition: "terminal_failure",
        },
      ],
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: "worker-1" },
      { sendPush }
    );

    expect(result).toMatchObject({
      claimed: 1,
      consumed: 0,
      terminalFailed: 1,
    });
  });

  it("fails the invocation closed when the service-only claim RPC fails", async () => {
    const { client } = rpcClient({
      claimError: { message: "permission denied" },
    });

    await expect(
      LeadAssignmentDeliveryService.processBatch(
        client,
        { workerId: "worker-1" },
        { sendPush }
      )
    ).rejects.toThrow("permission denied");
  });

  it("keeps actionable push copy at 50 characters or fewer", () => {
    expect(buildLeadAssignmentPushBody(" Canpro framing renovation ")).toBe(
      "Open Canpro framing renovation"
    );
    const long = buildLeadAssignmentPushBody("A".repeat(90));
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long).toMatch(/^Open A+…$/);
    expect(buildLeadAssignmentPushBody("   ")).toBe("Open New lead");
  });
});

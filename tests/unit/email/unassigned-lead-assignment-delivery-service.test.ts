import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildUnassignedLeadAssignmentPushBody,
  UnassignedLeadAssignmentDeliveryService,
} from "@/lib/api/services/unassigned-lead-assignment-delivery-service";

const visibleClaim = {
  delivery_id: "11111111-1111-4111-8111-111111111111",
  delivery_lease_token: "22222222-2222-4222-8222-222222222222",
  company_id: "33333333-3333-4333-8333-333333333333",
  opportunity_id: "44444444-4444-4444-8444-444444444444",
  recipient_user_id: "55555555-5555-4555-8555-555555555555",
  notification_id: "66666666-6666-4666-8666-666666666666",
  lead_title: "Canpro framing renovation",
  should_push: true,
  requires_notification: true,
  disposition: "notified",
};

interface RpcOptions {
  claims?: Array<Record<string, unknown>>;
  claimError?: { message: string } | null;
  completeError?: { message: string } | null;
  completeData?: Record<string, unknown>;
  failError?: { message: string } | null;
  failTerminal?: boolean;
}

function rpcClient(options: RpcOptions = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_unassigned_lead_assignment_deliveries") {
      return {
        data: options.claims ?? [],
        error: options.claimError ?? null,
      };
    }
    if (name === "complete_unassigned_lead_assignment_delivery") {
      return {
        data: options.completeError
          ? null
          : (options.completeData ?? { ok: true, suppressed: false }),
        error: options.completeError ?? null,
      };
    }
    if (name === "fail_unassigned_lead_assignment_delivery") {
      return {
        data: options.failError
          ? null
          : { ok: true, terminal: options.failTerminal ?? false },
        error: options.failError ?? null,
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

describe("UnassignedLeadAssignmentDeliveryService", () => {
  const sendPush = vi.fn();

  beforeEach(() => {
    sendPush.mockReset();
  });

  it("claims a bounded batch and returns an empty operational summary", async () => {
    const { client, rpc } = rpcClient();

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 17, leaseSeconds: 240, workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(rpc).toHaveBeenCalledWith(
      "claim_unassigned_lead_assignment_deliveries",
      {
        p_worker_id: visibleClaim.delivery_id,
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

  it("sends the assignment prompt with retry-safe lead routing data", async () => {
    const { client, rpc } = rpcClient({ claims: [visibleClaim] });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledWith({
      recipientUserIds: [visibleClaim.recipient_user_id],
      title: "Lead needs an owner",
      body: "Assign Canpro framing renovation",
      data: {
        leadId: visibleClaim.opportunity_id,
        screen: "leadDetails",
        type: "lead_assignment_required",
      },
      idempotencyKey: visibleClaim.delivery_id,
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_unassigned_lead_assignment_delivery",
      {
        p_delivery_id: visibleClaim.delivery_id,
        p_lease_token: visibleClaim.delivery_lease_token,
        p_push_state: "sent",
      }
    );
    expect(result).toMatchObject({
      claimed: 1,
      delivered: 1,
      pushed: 1,
      errors: [],
    });
  });

  it("keeps the persistent rail prompt when push is disabled", async () => {
    const { client, rpc } = rpcClient({
      claims: [{ ...visibleClaim, should_push: false }],
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(sendPush).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_unassigned_lead_assignment_delivery",
      expect.objectContaining({ p_push_state: "suppressed" })
    );
    expect(result).toMatchObject({
      delivered: 1,
      pushed: 0,
      pushSuppressed: 1,
    });
  });

  it("counts stale and inaccessible claims without channel work", async () => {
    const staleClaim = {
      ...visibleClaim,
      delivery_lease_token: null,
      notification_id: null,
      should_push: false,
      requires_notification: false,
      disposition: "stale",
    };
    const { client, rpc } = rpcClient({ claims: [staleClaim] });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(sendPush).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      claimed: 1,
      consumed: 1,
      delivered: 0,
    });
  });

  it("surfaces exhausted deliveries as terminal failures", async () => {
    const { client } = rpcClient({
      claims: [
        {
          ...visibleClaim,
          delivery_lease_token: null,
          notification_id: null,
          should_push: false,
          requires_notification: false,
          disposition: "terminal_failure",
        },
      ],
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(result).toMatchObject({
      claimed: 1,
      consumed: 0,
      terminalFailed: 1,
    });
  });

  it("requeues retryable provider failures without completing", async () => {
    const { client, rpc } = rpcClient({ claims: [visibleClaim] });
    sendPush.mockResolvedValue({
      ok: false,
      status: 503,
      error: "provider unavailable",
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(rpc).toHaveBeenCalledWith(
      "fail_unassigned_lead_assignment_delivery",
      expect.objectContaining({
        p_delivery_id: visibleClaim.delivery_id,
        p_lease_token: visibleClaim.delivery_lease_token,
        p_retryable: true,
        p_error: expect.stringContaining("503"),
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "complete_unassigned_lead_assignment_delivery",
      expect.anything()
    );
    expect(result).toMatchObject({ delivered: 0, requeued: 1 });
  });

  it("terminalizes non-retryable provider rejection", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      failTerminal: true,
    });
    sendPush.mockResolvedValue({
      ok: false,
      status: 400,
      error: "invalid recipient",
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(rpc).toHaveBeenCalledWith(
      "fail_unassigned_lead_assignment_delivery",
      expect.objectContaining({ p_retryable: false })
    );
    expect(result).toMatchObject({ requeued: 0, terminalFailed: 1 });
  });

  it("requeues completion failure after an acknowledged idempotent push", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      completeError: { message: "database timeout" },
    });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "fail_unassigned_lead_assignment_delivery",
      expect.objectContaining({
        p_retryable: true,
        p_error: expect.stringContaining("database timeout"),
      })
    );
    expect(result.requeued).toBe(1);
  });

  it("fails closed when the service-only claim RPC is unavailable", async () => {
    const { client } = rpcClient({
      claimError: { message: "permission denied" },
    });

    await expect(
      UnassignedLeadAssignmentDeliveryService.processBatch(
        client,
        { workerId: visibleClaim.delivery_id },
        { sendPush }
      )
    ).rejects.toThrow("permission denied");
  });

  it("rejects malformed claim shapes before provider work", async () => {
    const { client } = rpcClient({
      claims: [{ ...visibleClaim, recipient_user_id: "" }],
    });

    await expect(
      UnassignedLeadAssignmentDeliveryService.processBatch(
        client,
        { workerId: visibleClaim.delivery_id },
        { sendPush }
      )
    ).rejects.toThrow(/recipient_user_id/);
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe("buildUnassignedLeadAssignmentPushBody", () => {
  it("normalizes and truncates the assignment command to 50 characters", () => {
    expect(
      buildUnassignedLeadAssignmentPushBody("  Fernwood   railing  ")
    ).toBe("Assign Fernwood railing");
    expect(buildUnassignedLeadAssignmentPushBody("   ")).toBe(
      "Assign new lead"
    );

    const body = buildUnassignedLeadAssignmentPushBody("A".repeat(90));
    expect(body.length).toBeLessThanOrEqual(50);
    expect(body).toMatch(/^Assign A+…$/);
  });

  it("never splits a Unicode character at the push boundary", () => {
    const body = buildUnassignedLeadAssignmentPushBody(
      `${"A".repeat(41)}🧰${"B".repeat(40)}`
    );

    expect(body.length).toBeLessThanOrEqual(50);
    expect(() => encodeURIComponent(body)).not.toThrow();
    expect(body.endsWith("…")).toBe(true);
  });
});

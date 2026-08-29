import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildUnassignedLeadAssignmentPushBody,
  UnassignedLeadAssignmentDeliveryService,
} from "@/lib/api/services/unassigned-lead-assignment-delivery-service";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-control-service";

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

const secondVisibleClaim = {
  ...visibleClaim,
  delivery_id: "77777777-7777-4777-8777-777777777777",
  delivery_lease_token: "88888888-8888-4888-8888-888888888888",
  notification_id: "99999999-9999-4999-8999-999999999999",
};

interface ClaimResponse {
  claims?: Array<Record<string, unknown>>;
  error?: { message: string; code?: string; status?: number } | null;
}

interface RpcOptions {
  /** Quiet-hours fixtures: `notification_preferences` rows for the recipient. */
  preferences?: Array<Record<string, unknown>>;
  /** `companies.timezone` used to evaluate any configured window. */
  timezone?: string;
  claims?: Array<Record<string, unknown>>;
  claimResponses?: ClaimResponse[];
  claimError?: { message: string; code?: string; status?: number } | null;
  completeError?: { message: string; code?: string; status?: number } | null;
  completeData?: Record<string, unknown>;
  failError?: { message: string; code?: string; status?: number } | null;
  failTerminal?: boolean;
}

/**
 * Quiet-hours reads (`notification_preferences`, then `companies` only when a
 * window is configured). Default fixture: no preference rows at all, which is
 * production reality for every Canpro user today — nobody is suppressed, so the
 * existing push assertions in this file are unaffected.
 */
function quietHoursFrom(options: {
  preferences?: Array<Record<string, unknown>>;
  timezone?: string;
}) {
  return (table: string) => {
    const result =
      table === "notification_preferences"
        ? { data: options.preferences ?? [], error: null }
        : table === "companies"
          ? { data: { timezone: options.timezone ?? "UTC" }, error: null }
          : { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "in", "eq", "is", "limit"]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = async () => result;
    builder.then = (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return builder;
  };
}

function rpcClient(options: RpcOptions = {}) {
  let claimCall = 0;
  const rpc = vi.fn(async (name: string, _args?: unknown) => {
    if (name === "claim_unassigned_lead_assignment_deliveries") {
      const scripted = options.claimResponses?.[claimCall];
      claimCall += 1;
      return {
        data:
          scripted?.claims ?? (claimCall === 1 ? (options.claims ?? []) : []),
        error:
          scripted?.error ??
          (claimCall === 1 ? (options.claimError ?? null) : null),
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

  const from = vi.fn(quietHoursFrom(options));
  return { rpc, from, client: { rpc, from } as unknown as SupabaseClient };
}

describe("UnassignedLeadAssignmentDeliveryService", () => {
  const sendPush = vi.fn();

  beforeEach(() => {
    sendPush.mockReset();
  });

  it("claims one row with a bounded lease and returns an empty operational summary", async () => {
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
        p_limit: 1,
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

  it("completes each claimed row before requesting the next one", async () => {
    const { client, rpc } = rpcClient({
      claimResponses: [
        { claims: [{ ...visibleClaim, should_push: false }] },
        { claims: [{ ...secondVisibleClaim, should_push: false }] },
      ],
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 2, workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_unassigned_lead_assignment_deliveries",
      "complete_unassigned_lead_assignment_delivery",
      "claim_unassigned_lead_assignment_deliveries",
      "complete_unassigned_lead_assignment_delivery",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_limit: 1 });
    expect(rpc.mock.calls[2]?.[1]).toMatchObject({ p_limit: 1 });
    expect(result).toMatchObject({ claimed: 2, delivered: 2 });
  });

  it("stops requesting rows when the caller's bounded total is reached", async () => {
    const thirdVisibleClaim = {
      ...secondVisibleClaim,
      delivery_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      delivery_lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const { client, rpc } = rpcClient({
      claimResponses: [
        { claims: [{ ...visibleClaim, should_push: false }] },
        { claims: [{ ...secondVisibleClaim, should_push: false }] },
        { claims: [{ ...thirdVisibleClaim, should_push: false }] },
      ],
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 2, workerId: visibleClaim.delivery_id },
      { sendPush }
    );

    expect(
      rpc.mock.calls.filter(
        ([name]) => name === "claim_unassigned_lead_assignment_deliveries"
      )
    ).toHaveLength(2);
    expect(result).toMatchObject({ claimed: 2, delivered: 2 });
  });

  it("aborts when a later claim reports PGRST002 without another RPC", async () => {
    const { client, rpc } = rpcClient({
      claimResponses: [
        { claims: [{ ...visibleClaim, should_push: false }] },
        {
          error: {
            message:
              "PGRST002: Could not query the database for the schema cache",
          },
        },
      ],
    });

    await expect(
      UnassignedLeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 3, workerId: visibleClaim.delivery_id },
        { sendPush }
      )
    ).rejects.toThrow("PGRST002");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_unassigned_lead_assignment_deliveries",
      "complete_unassigned_lead_assignment_delivery",
      "claim_unassigned_lead_assignment_deliveries",
    ]);
  });

  it("preserves a code-only 53300 claim failure for the database circuit", async () => {
    const { client } = rpcClient({
      claimError: {
        code: "53300",
        message: "remaining connection slots are reserved",
      },
    });

    const failure =
      await UnassignedLeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 2, workerId: visibleClaim.delivery_id },
        { sendPush }
      ).catch((error: unknown) => error);

    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it("aborts a 57014 completion failure without trying to persist or claim again", async () => {
    const { client, rpc } = rpcClient({
      claimResponses: [
        { claims: [visibleClaim] },
        { claims: [secondVisibleClaim] },
      ],
      completeError: {
        message: "57014: canceling statement due to statement timeout",
      },
    });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    await expect(
      UnassignedLeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 2, workerId: visibleClaim.delivery_id },
        { sendPush }
      )
    ).rejects.toThrow("57014");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_unassigned_lead_assignment_deliveries",
      "complete_unassigned_lead_assignment_delivery",
    ]);
  });

  it("aborts a connection-timeout failure persistence without claiming again", async () => {
    const { client, rpc } = rpcClient({
      claimResponses: [
        { claims: [visibleClaim] },
        { claims: [secondVisibleClaim] },
      ],
      failError: {
        message: "Connection terminated due to connection timeout",
      },
    });
    sendPush.mockResolvedValue({
      ok: false,
      error: "provider unavailable",
      status: 503,
    });

    await expect(
      UnassignedLeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 2, workerId: visibleClaim.delivery_id },
        { sendPush }
      )
    ).rejects.toThrow("connection timeout");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_unassigned_lead_assignment_deliveries",
      "fail_unassigned_lead_assignment_delivery",
    ]);
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
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_unassigned_lead_assignment_deliveries",
      "claim_unassigned_lead_assignment_deliveries",
    ]);
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
      completeError: { message: "delivery row changed" },
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
        p_error: expect.stringContaining("delivery row changed"),
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

/**
 * Quiet hours (bug 42aa787c). This worker derives its recipient from the RPC
 * claim, so before the shared filter landed it pushed straight through a crew
 * member's window. Suppression drops the PUSH only — the delivery still
 * completes and the rail row this delivery references is untouched.
 */
describe("UnassignedLeadAssignmentDeliveryService quiet hours", () => {
  const sendPush = vi.fn();

  const quietWindow = [
    {
      user_id: visibleClaim.recipient_user_id,
      quiet_hours_start: "22:00:00",
      quiet_hours_end: "07:00:00",
    },
  ];

  beforeEach(() => {
    sendPush.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses the push inside the window and still completes the delivery", async () => {
    // 23:00 UTC sits inside 22:00–07:00.
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z"));
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      timezone: "UTC",
      preferences: quietWindow,
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 1, workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimed: 1,
      delivered: 1,
      pushed: 0,
      pushSuppressed: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_unassigned_lead_assignment_delivery",
      expect.objectContaining({ p_push_state: "suppressed" })
    );
  });

  it("sends the push outside the window", async () => {
    // 12:00 UTC sits outside 22:00–07:00.
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });
    const { client } = rpcClient({
      claims: [visibleClaim],
      timezone: "UTC",
      preferences: quietWindow,
    });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 1, workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: [visibleClaim.recipient_user_id],
      })
    );
    expect(result).toMatchObject({ pushed: 1 });
  });

  it("pushes normally when the recipient has no window configured", async () => {
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z"));
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });
    const { client } = rpcClient({ claims: [visibleClaim], timezone: "UTC" });

    const result = await UnassignedLeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 1, workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pushed: 1 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildLeadAssignmentPushBody,
  LeadAssignmentDeliveryService,
} from "@/lib/api/services/lead-assignment-delivery-service";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-control-service";

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

const secondVisibleClaim = {
  ...visibleClaim,
  delivery_id: "88888888-8888-4888-8888-888888888888",
  delivery_lease_token: "99999999-9999-4999-8999-999999999999",
  assignment_event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  notification_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

interface ClaimResponse {
  claims?: Array<Record<string, unknown>>;
  error?: { message: string; code?: string; status?: number } | null;
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

function rpcClient(params: {
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
}) {
  let claimCall = 0;
  const rpc = vi.fn(async (name: string, _args?: unknown) => {
    if (name === "claim_opportunity_assignment_deliveries") {
      const scripted = params.claimResponses?.[claimCall];
      claimCall += 1;
      return {
        data:
          scripted?.claims ?? (claimCall === 1 ? (params.claims ?? []) : []),
        error:
          scripted?.error ??
          (claimCall === 1 ? (params.claimError ?? null) : null),
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
        data: params.failError
          ? null
          : { ok: true, terminal: params.failTerminal ?? false },
        error: params.failError ?? null,
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  const from = vi.fn(quietHoursFrom(params));

  return {
    rpc,
    from,
    client: { rpc, from } as unknown as SupabaseClient,
  };
}

describe("LeadAssignmentDeliveryService", () => {
  const sendPush = vi.fn();

  beforeEach(() => {
    sendPush.mockReset();
  });

  it("claims one row with a bounded lease and returns an empty operational summary", async () => {
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

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 2, workerId: "worker-1" },
      { sendPush }
    );

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_opportunity_assignment_deliveries",
      "complete_opportunity_assignment_delivery",
      "claim_opportunity_assignment_deliveries",
      "complete_opportunity_assignment_delivery",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_limit: 1 });
    expect(rpc.mock.calls[2]?.[1]).toMatchObject({ p_limit: 1 });
    expect(result).toMatchObject({ claimed: 2, delivered: 2 });
  });

  it("stops requesting rows when the caller's bounded total is reached", async () => {
    const thirdVisibleClaim = {
      ...secondVisibleClaim,
      delivery_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      delivery_lease_token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    };
    const { client, rpc } = rpcClient({
      claimResponses: [
        { claims: [{ ...visibleClaim, should_push: false }] },
        { claims: [{ ...secondVisibleClaim, should_push: false }] },
        { claims: [{ ...thirdVisibleClaim, should_push: false }] },
      ],
    });

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 2, workerId: "worker-1" },
      { sendPush }
    );

    expect(
      rpc.mock.calls.filter(
        ([name]) => name === "claim_opportunity_assignment_deliveries"
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
      LeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 3, workerId: "worker-1" },
        { sendPush }
      )
    ).rejects.toThrow("PGRST002");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_opportunity_assignment_deliveries",
      "complete_opportunity_assignment_delivery",
      "claim_opportunity_assignment_deliveries",
    ]);
  });

  it("preserves a code-only 53300 claim failure for the database circuit", async () => {
    const { client } = rpcClient({
      claimError: {
        code: "53300",
        message: "remaining connection slots are reserved",
      },
    });

    const failure = await LeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 2, workerId: "worker-1" },
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
      LeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 2, workerId: "worker-1" },
        { sendPush }
      )
    ).rejects.toThrow("57014");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_opportunity_assignment_deliveries",
      "complete_opportunity_assignment_delivery",
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
      error: "unavailable",
      status: 503,
    });

    await expect(
      LeadAssignmentDeliveryService.processBatch(
        client,
        { limit: 2, workerId: "worker-1" },
        { sendPush }
      )
    ).rejects.toThrow("connection timeout");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_opportunity_assignment_deliveries",
      "fail_opportunity_assignment_delivery",
    ]);
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
      "claim_opportunity_assignment_deliveries",
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
      completeError: { message: "delivery row changed" },
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
        p_error: expect.stringContaining("delivery row changed"),
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
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_opportunity_assignment_deliveries",
      "claim_opportunity_assignment_deliveries",
    ]);
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

/**
 * Quiet hours (bug 42aa787c). This worker derives its recipient from the RPC
 * claim, so before the shared filter landed it pushed straight through a crew
 * member's window. Suppression drops the PUSH only — the delivery still
 * completes and the rail row this delivery references is untouched.
 */
describe("LeadAssignmentDeliveryService quiet hours", () => {
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

    const result = await LeadAssignmentDeliveryService.processBatch(
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
      "complete_opportunity_assignment_delivery",
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

    const result = await LeadAssignmentDeliveryService.processBatch(
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

    const result = await LeadAssignmentDeliveryService.processBatch(
      client,
      { limit: 1, workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pushed: 1 });
  });
});

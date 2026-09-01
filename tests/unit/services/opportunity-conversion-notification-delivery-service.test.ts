import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildOpportunityConversionPushBody,
  OpportunityConversionNotificationDeliveryService,
} from "@/lib/api/services/opportunity-conversion-notification-delivery-service";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-control-service";

const visibleClaim = {
  delivery_id: "11111111-1111-4111-8111-111111111111",
  delivery_lease_token: "22222222-2222-4222-8222-222222222222",
  conversion_event_id: "33333333-3333-4333-8333-333333333333",
  company_id: "44444444-4444-4444-8444-444444444444",
  opportunity_id: "55555555-5555-4555-8555-555555555555",
  project_id: "66666666-6666-4666-8666-666666666666",
  recipient_user_id: "77777777-7777-4777-8777-777777777777",
  actor_user_id: null,
  notification_id: "88888888-8888-4888-8888-888888888888",
  lead_title: "Canpro framing renovation",
  destination: "project",
  should_push: true,
  requires_notification: true,
  disposition: "notified",
};

interface RpcOptions {
  /** Quiet-hours fixtures: `notification_preferences` rows for the recipient. */
  preferences?: Array<Record<string, unknown>>;
  /** `companies.timezone` used to evaluate any configured window. */
  timezone?: string;
  claims?: Array<Record<string, unknown>>;
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

function rpcClient(options: RpcOptions) {
  let claimCalls = 0;
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_opportunity_conversion_notification_deliveries") {
      claimCalls += 1;
      return {
        data: claimCalls === 1 ? (options.claims ?? []) : [],
        error: options.claimError ?? null,
      };
    }
    if (name === "complete_opportunity_conversion_notification_delivery") {
      return {
        data: options.completeError
          ? null
          : (options.completeData ?? { ok: true, suppressed: false }),
        error: options.completeError ?? null,
      };
    }
    if (name === "fail_opportunity_conversion_notification_delivery") {
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

describe("OpportunityConversionNotificationDeliveryService", () => {
  const sendPush = vi.fn();

  beforeEach(() => {
    sendPush.mockReset();
  });

  it("claims immediately before work and stops on an empty queue", async () => {
    const { client, rpc } = rpcClient({});

    const result =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 5 },
        { sendPush }
      );

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "claim_opportunity_conversion_notification_deliveries",
      {
        p_worker_id: "99999999-9999-4999-8999-999999999999",
        p_lease_seconds: 180,
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

  it("pushes an actorless conversion with the immutable event id as idempotency key", async () => {
    const { client, rpc } = rpcClient({ claims: [visibleClaim] });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    const result =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );

    expect(sendPush).toHaveBeenCalledWith({
      recipientUserIds: [visibleClaim.recipient_user_id],
      title: "Lead converted",
      body: "Canpro framing renovation is now a project.",
      data: {
        type: "lead_converted",
        projectId: visibleClaim.project_id,
        opportunityId: visibleClaim.opportunity_id,
        screen: "projectDetails",
      },
      idempotencyKey: visibleClaim.conversion_event_id,
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_opportunity_conversion_notification_delivery",
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

  it("keeps the rail and completes when push is disabled", async () => {
    const { client, rpc } = rpcClient({
      claims: [{ ...visibleClaim, should_push: false }],
    });

    const result =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );

    expect(sendPush).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_opportunity_conversion_notification_delivery",
      expect.objectContaining({ p_push_state: "suppressed" })
    );
    expect(result).toMatchObject({ delivered: 1, pushSuppressed: 1 });
  });

  it("never exposes a hidden project id in a lead-fallback push", async () => {
    const { client } = rpcClient({
      claims: [{ ...visibleClaim, destination: "lead" }],
    });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    await OpportunityConversionNotificationDeliveryService.processBatch(
      client,
      { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          type: "lead_converted",
          opportunityId: visibleClaim.opportunity_id,
          screen: "leadDetails",
        },
      })
    );
    expect(sendPush.mock.calls[0]?.[0]?.data).not.toHaveProperty("projectId");
  });

  it("counts inaccessible and terminal claims without channel work", async () => {
    const inaccessible = {
      ...visibleClaim,
      delivery_lease_token: null,
      notification_id: null,
      destination: null,
      should_push: false,
      requires_notification: false,
      disposition: "inaccessible",
    };
    const terminal = { ...inaccessible, disposition: "terminal_failure" };
    const { client } = rpcClient({ claims: [inaccessible] });
    const first =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );
    const { client: terminalClient } = rpcClient({ claims: [terminal] });
    const second =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        terminalClient,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );

    expect(sendPush).not.toHaveBeenCalled();
    expect(first.consumed).toBe(1);
    expect(second.terminalFailed).toBe(1);
  });

  it("persists a retryable provider failure without completing", async () => {
    const { client, rpc } = rpcClient({ claims: [visibleClaim] });
    sendPush.mockResolvedValue({
      ok: false,
      status: 503,
      error: "provider unavailable",
    });

    const result =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );

    expect(rpc).toHaveBeenCalledWith(
      "fail_opportunity_conversion_notification_delivery",
      expect.objectContaining({
        p_delivery_id: visibleClaim.delivery_id,
        p_lease_token: visibleClaim.delivery_lease_token,
        p_retryable: true,
        p_error: expect.stringContaining("503"),
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "complete_opportunity_conversion_notification_delivery",
      expect.anything()
    );
    expect(result).toMatchObject({ requeued: 1, delivered: 0 });
  });

  it("terminalizes a non-retryable provider rejection", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      failTerminal: true,
    });
    sendPush.mockResolvedValue({
      ok: false,
      status: 403,
      error: "invalid recipient",
    });

    const result =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );

    expect(rpc).toHaveBeenCalledWith(
      "fail_opportunity_conversion_notification_delivery",
      expect.objectContaining({ p_retryable: false })
    );
    expect(result.terminalFailed).toBe(1);
  });

  it("requeues a completion persistence failure without resending inside the batch", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      completeError: { message: "database timeout" },
    });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    const result =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      );

    expect(sendPush).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "fail_opportunity_conversion_notification_delivery",
      expect.objectContaining({
        p_retryable: true,
        p_error: expect.stringContaining("database timeout"),
      })
    );
    expect(result.requeued).toBe(1);
  });

  it("stops without retry persistence when completion reports database pressure", async () => {
    const { client, rpc } = rpcClient({
      claims: [visibleClaim],
      completeError: { message: "PGRST002 schema cache unavailable" },
    });
    sendPush.mockResolvedValue({ ok: true, recipients: 1 });

    await expect(
      OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 5 },
        { sendPush }
      )
    ).rejects.toThrow("PGRST002");

    expect(rpc).not.toHaveBeenCalledWith(
      "fail_opportunity_conversion_notification_delivery",
      expect.anything()
    );
  });

  it("preserves a code-only 53300 claim failure for the database circuit", async () => {
    const { client } = rpcClient({
      claimError: {
        code: "53300",
        message: "remaining connection slots are reserved",
      },
    });

    const failure =
      await OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 5 },
        { sendPush }
      ).catch((error: unknown) => error);

    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it("rejects forged or malformed claim shapes before provider work", async () => {
    const { client } = rpcClient({
      claims: [{ ...visibleClaim, conversion_event_id: "" }],
    });

    await expect(
      OpportunityConversionNotificationDeliveryService.processBatch(
        client,
        { workerId: "99999999-9999-4999-8999-999999999999", limit: 1 },
        { sendPush }
      )
    ).rejects.toThrow(/conversion_event_id/);
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe("buildOpportunityConversionPushBody", () => {
  it("normalizes and truncates to the 50-character push limit", () => {
    const body = buildOpportunityConversionPushBody(
      "  A very long framing and renovation opportunity title for Canpro  "
    );

    expect(body.length).toBeLessThanOrEqual(50);
    expect(body).not.toMatch(/\s{2,}/);
    expect(body.endsWith("…")).toBe(true);
  });
});

/**
 * Quiet hours (bug 42aa787c). This worker derives its recipient from the RPC
 * claim, so before the shared filter landed it pushed straight through a crew
 * member's window. Suppression drops the PUSH only — the delivery still
 * completes and the rail row this delivery references is untouched.
 */
describe("OpportunityConversionNotificationDeliveryService quiet hours", () => {
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

    const result = await OpportunityConversionNotificationDeliveryService.processBatch(
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
      "complete_opportunity_conversion_notification_delivery",
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

    const result = await OpportunityConversionNotificationDeliveryService.processBatch(
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

    const result = await OpportunityConversionNotificationDeliveryService.processBatch(
      client,
      { limit: 1, workerId: "worker-1" },
      { sendPush }
    );

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pushed: 1 });
  });
});

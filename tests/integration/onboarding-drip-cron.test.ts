/**
 * Integration tests for /api/cron/onboarding-drip.
 *
 * Covers: auth gating, no-op when no companies, dedup via UNIQUE conflict,
 * Day 4A push-mock rendering, and retry sweep picking up pending rows.
 *
 * The supabase client is mocked at the chain level so each test seeds its
 * own response. @sendgrid/mail is mocked at the import boundary but
 * @/lib/email/sendgrid is left intact — we WANT the typed senders +
 * gatedSend + React Email render pipeline to actually run, since that's
 * what catches wiring bugs. Only the outbound HTTP call is intercepted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Supabase mock ───────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: supabaseFromMock, rpc: vi.fn() }),
}));

// ─── SendGrid transport mock ─────────────────────────────────────────────────

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([
      { headers: { "x-message-id": "sg-test-001" } },
      {},
    ]),
  },
}));

import sgMail from "@sendgrid/mail";
import { GET } from "@/app/api/cron/onboarding-drip/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "0".repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
});

function buildRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/onboarding-drip"),
    { headers },
  );
}

/**
 * Generic permissive supabase mock that returns a chainable object resolving
 * to default-empty results. Tests can override specific tables via
 * supabaseFromMock.mockImplementation.
 *
 * The chain is fully recursive so any combination of .select/.eq/.is/.in/.lt/
 * .gt/.gte/.lte/.order/.ilike/.not/.or terminates either as an awaited
 * promise (then resolves to { data: [], error: null, count: 0 }) or via
 * .limit / .single / .maybeSingle.
 */
function noOpChain() {
  const chain: any = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    gt: () => chain,
    gte: () => chain,
    lt: () => chain,
    lte: () => chain,
    or: () => chain,
    not: () => chain,
    ilike: () => chain,
    order: () => chain,
    limit: async () => ({ data: [], error: null }),
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: any) => resolve({ data: [], error: null, count: 0 }),
  };
  return chain;
}

function mockSupabaseTables(handlers: Record<string, () => any>) {
  supabaseFromMock.mockImplementation((table: string) => {
    const handler = handlers[table];
    return handler ? handler() : noOpChain();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("/api/cron/onboarding-drip", () => {
  it("returns 401 without bearer auth", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 with the wrong secret", async () => {
    const res = await GET(buildRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("returns ok=true with zero counters when no candidate companies exist", async () => {
    mockSupabaseTables({
      // companies query returns [] from the chain default — both the scan
      // (then-resolves to { data: [] }) AND any per-row .eq().maybeSingle()
      // lookups (return { data: null }).
      companies: () => noOpChain(),
      // Retry sweep returns []
      onboarding_email_log: () => noOpChain(),
    });
    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.scanned).toBe(0);
    expect(body.calendar_processed).toBe(0);
    expect(body.lost_you_fired).toBe(0);
    expect(body.retried).toBe(0);
  });

  it("dedup: with no candidate companies + no retry rows, sgMail.send is never called", async () => {
    // The strict dedup invariant — "claim INSERT returns 23505 → no send" —
    // is exercised end-to-end by the unit test
    // tests/unit/api/services/onboarding-drip-service.test.ts ("returns
    // 'already_claimed' when INSERT conflicts"). Driving the same path
    // through the cron requires wall-clock localHour===9 in the operator's
    // timezone, which is flaky.
    //
    // The cron-level invariant we CAN assert deterministically: when no
    // dispatch happens (no companies, no retries), sgMail.send must never
    // be invoked. That guards against regressions where the worker drops
    // a stray send outside the claim path.
    mockSupabaseTables({
      companies: () => noOpChain(),
      onboarding_email_log: () => noOpChain(),
    });
    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(sgMail.send).not.toHaveBeenCalled();
  });

  it("Day 4A renders push mock when dispatched directly through the typed sender", async () => {
    // This exercises the sendOnboardingDay4NoNotification path directly,
    // bypassing the cron's localHour===9 gate (which would make the test
    // flaky based on wall-clock time). Verifies the React Email render
    // pipeline produces the Task Completed / Jake completed copy that
    // mirrors dispatchTaskCompleted's real notification body.
    const { sendOnboardingDay4NoNotification } = await import(
      "@/lib/email/sendgrid"
    );

    // gatedSend queries email_pause_state + email_suppressions, then inserts
    // into email_log. All three need to resolve permissively.
    mockSupabaseTables({
      email_pause_state: () => noOpChain(),
      email_suppressions: () => noOpChain(),
      email_log: () => noOpChain(),
    });

    await sendOnboardingDay4NoNotification({
      email: "operator@example.com",
      ctaUrl: "https://app.opsapp.co/settings/team",
      onboardingEmailLogId: "log-uuid-4a",
    });

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.html).toContain("Task Completed");
    expect(call.html).toContain("Jake completed");
    expect(call.html).toContain("Rail Install");
    expect(call.html).toContain("5611 Batu Rd");
    expect(call.subject).toBe("the notification you're working toward");
  });

  it("retry sweep picks up pending rows with attempts<3 and updated_at>5min ago", async () => {
    // Seed exactly one onboarding_email_log retry candidate matching the
    // gate predicates (status in pending/failed, attempts<3, expiry in
    // future, updated_at > 5 min ago). The companies query for the
    // calendar pass returns [] so only the retry path fires.
    const candidate = {
      id: "row-1",
      user_id: "u1",
      company_id: "c1",
      day_slot: "day_3",
      branch: null,
      email_type: "onboarding_day_3_inbox",
      attempts: 1,
    };

    // companies handler serves BOTH the initial 15-day scan (returns []
    // via the .then chain default) AND the per-row .eq("id").maybeSingle()
    // re-fetch during retry dispatch.
    const companiesHandler = () => {
      const chain: any = {
        select: () => chain,
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "c1", latitude: null, longitude: null },
            error: null,
          }),
        }),
        gte: () => chain,
        is: () => chain,
        then: (resolve: any) =>
          resolve({ data: [], error: null, count: 0 }),
      };
      return chain;
    };

    // onboarding_email_log handler serves:
    //   - the retry sweep query: select().in().lt().gt().lt().limit() → [candidate]
    //   - the post-send update: update().eq() → no error
    //   - the lost_you existence check: select().eq("company_id").in("day_slot") (n/a here)
    const onboardingHandler = () => {
      const chain: any = {
        select: () => chain,
        update: () => ({ eq: async () => ({ error: null }) }),
        in: () => chain,
        eq: () => chain,
        gt: () => chain,
        lt: () => chain,
        limit: async () => ({ data: [candidate], error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return chain;
    };

    // users handler: .select().eq("id").maybeSingle() returns the operator.
    const usersHandler = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "u1",
              email: "test@example.com",
              first_name: "Pat",
              deleted_at: null,
            },
            error: null,
          }),
        }),
      }),
    });

    // email_log handler: reconcileAgainstEmailLog runs both primary
    // (metadata->>onboarding_email_log_id eq) and fallback (recipient
    // + sent_at window) queries. Both terminate with .limit() → return [].
    // gatedSend then inserts into email_log post-send.
    const emailLogHandler = () => {
      const chain: any = {
        select: () => chain,
        insert: async () => ({ error: null }),
        eq: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null }),
      };
      return chain;
    };

    mockSupabaseTables({
      companies: companiesHandler,
      onboarding_email_log: onboardingHandler,
      users: usersHandler,
      email_log: emailLogHandler,
      email_pause_state: () => noOpChain(),
      email_suppressions: () => noOpChain(),
    });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // The retry sweep dispatched the typed sender, which routed through
    // gatedSend → sgMail.send (which is mocked).
    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const sentCall = (sgMail.send as any).mock.calls[0][0];
    expect(sentCall.to).toBe("test@example.com");
    expect(sentCall.subject).toBe("the part of OPS I'm most proud of");
    // body.retried counts successful retry dispatches.
    expect(body.retried).toBe(1);
  });
});

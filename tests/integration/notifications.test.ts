/**
 * Integration tests for the unified PMF notification sender (Task 28).
 *
 * Scope: exercise `sendPmfNotification` end-to-end with ONLY the external
 * transport boundaries mocked. Internal helpers (`withRetry`,
 * `hasRecentSend`, `logSend`, `errorMessage`) run for real. This proves
 * the module wires correctly at the import-edge level — a guarantee the
 * unit tests in `tests/unit/notifications/pmf-send.test.ts` cannot make,
 * since those mock the helpers too.
 *
 * What's mocked:
 *   - `@/lib/notifications/twilio`         → sendSms
 *   - `@/lib/email/sendgrid`               → sendTransactionalEmail
 *   - `@/lib/supabase/admin-client`        → getAdminSupabase (chainable,
 *     with per-table handlers so dedup reads + log inserts + in-app
 *     inserts can be driven/inspected independently)
 *
 * What's NOT mocked:
 *   - `@/lib/pmf/recipients`   → real module; env vars set per-test
 *   - `@react-email/render`    → real renderer; we pass a minimal element
 *   - `@/lib/notifications/pmf-send` itself (the unit under test)
 *
 * Test coverage (7 scenarios):
 *   1. threshold_alert → fires SMS + email + in-app with 3 log rows
 *   2. daily_digest    → email only; no SMS, no in-app, 1 log row
 *   3. weekly_digest   → email only; no SMS, no in-app, 1 log row
 *   4. email transport failure → retried, failure log row recorded, no throw
 *   5. in-app insert DB failure → failure log row; SMS/email unaffected
 *   6. prior successful send blocks this run (dedup hit)
 *   7. dedup query chain includes `.is('error', null)` so prior failures
 *      do not suppress; all three channels still fire
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactElement } from "react";

// ─── Tracker: every cross-boundary call lands here ──────────────────────────

interface SupabaseCall {
  table: string;
  method: string;
  args: unknown[];
}

interface MockTracker {
  smsCalls: Array<{ to: string; body: string }>;
  emailCalls: Array<{ to: string; subject: string; html: string }>;
  supabaseCalls: SupabaseCall[];
  // Per-table terminal-op result queues. Non-terminal chain calls (select,
  // eq, gte, is, limit, insert) return the same builder; terminal ops
  // (await / .single()) consume from the matching queue.
  dedupResultQueue: Array<{ data: unknown; error: unknown }>;
  logInsertResultQueue: Array<{ data: unknown; error: unknown }>;
  railInsertResultQueue: Array<{ data: unknown; error: unknown }>;
}

const tracker: MockTracker = {
  smsCalls: [],
  emailCalls: [],
  supabaseCalls: [],
  dedupResultQueue: [],
  logInsertResultQueue: [],
  railInsertResultQueue: [],
};

// ─── Transport mocks ────────────────────────────────────────────────────────

const sendSmsMock =
  vi.fn<(to: string, body: string) => Promise<{ sid: string }>>();

vi.mock("@/lib/notifications/twilio", () => ({
  sendSms: (to: string, body: string) => {
    tracker.smsCalls.push({ to, body });
    return sendSmsMock(to, body);
  },
}));

const sendTransactionalEmailMock =
  vi.fn<
    (params: { to: string; subject: string; html: string }) => Promise<void>
  >();

vi.mock("@/lib/email/sendgrid", () => ({
  sendTransactionalEmail: (params: {
    to: string;
    subject: string;
    html: string;
  }) => {
    tracker.emailCalls.push(params);
    return sendTransactionalEmailMock(params);
  },
}));

// ─── Supabase mock: per-table chainable builder ─────────────────────────────

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  insert: (rows: unknown) => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  gte: (col: string, val: unknown) => MockBuilder;
  is: (col: string, val: unknown) => MockBuilder;
  limit: (n: number) => MockBuilder;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: (
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown
  ) => Promise<unknown>;
}

function makeTableBuilder(table: string): MockBuilder {
  // Tracks whether this chain performed an insert or is a read. `.insert`
  // on `notifications` resolves the rail queue; insert on
  // `pmf_notification_log` resolves the log queue; anything else on
  // `pmf_notification_log` is the dedup read path.
  let isInsertChain = false;

  const record = (method: string, ...args: unknown[]) => {
    tracker.supabaseCalls.push({ table, method, args });
  };

  const resolveResult = (): { data: unknown; error: unknown } => {
    if (table === "notifications" && isInsertChain) {
      return (
        tracker.railInsertResultQueue.shift() ?? { data: null, error: null }
      );
    }
    if (table === "pmf_notification_log" && isInsertChain) {
      return (
        tracker.logInsertResultQueue.shift() ?? { data: null, error: null }
      );
    }
    if (table === "pmf_notification_log") {
      return tracker.dedupResultQueue.shift() ?? { data: [], error: null };
    }
    return { data: null, error: null };
  };

  const builder: MockBuilder = {
    select: (cols) => {
      record("select", cols);
      return builder;
    },
    insert: (rows) => {
      isInsertChain = true;
      record("insert", rows);
      return builder;
    },
    eq: (col, val) => {
      record("eq", col, val);
      return builder;
    },
    gte: (col, val) => {
      record("gte", col, val);
      return builder;
    },
    is: (col, val) => {
      record("is", col, val);
      return builder;
    },
    limit: (n) => {
      record("limit", n);
      return builder;
    },
    single: async () => {
      record("single");
      return resolveResult();
    },
    then: (onFulfilled) => {
      record("await");
      return Promise.resolve(resolveResult()).then(onFulfilled);
    },
  };

  return builder;
}

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => makeTableBuilder(table),
  }),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function logInsertsFor(
  channel: "sms" | "email" | "in_app"
): Array<Record<string, unknown>> {
  return tracker.supabaseCalls
    .filter((c) => c.table === "pmf_notification_log" && c.method === "insert")
    .map((c) => c.args[0] as Record<string, unknown>)
    .filter((row) => row.channel === channel);
}

function railInserts(): Array<Record<string, unknown>> {
  return tracker.supabaseCalls
    .filter((c) => c.table === "notifications" && c.method === "insert")
    .map((c) => c.args[0] as Record<string, unknown>);
}

/**
 * Minimal React element for the email body. `@react-email/render` runs
 * for real against this — no mock — so we exercise the module's render
 * boundary end-to-end.
 */
function miniEmailReact(): ReactElement {
  return createElement("div", null, "PMF test email body");
}

// ─── Setup / teardown ───────────────────────────────────────────────────────

const RECIPIENT_SMS = "+15555550123";
const RECIPIENT_EMAIL = "pmf-integration@ops.test";
const OPERATOR_UID = "operator-integration-uid";
const OPERATOR_COMPANY = "ops-platform-integration";

beforeEach(() => {
  tracker.smsCalls.length = 0;
  tracker.emailCalls.length = 0;
  tracker.supabaseCalls.length = 0;
  tracker.dedupResultQueue.length = 0;
  tracker.logInsertResultQueue.length = 0;
  tracker.railInsertResultQueue.length = 0;
  sendSmsMock.mockReset();
  sendTransactionalEmailMock.mockReset();

  // Env vars — real `getPmfRecipients` reads these. Task 24's fix requires
  // all four present or it throws at `sendPmfNotification` call time.
  process.env.PMF_NOTIFICATION_SMS = RECIPIENT_SMS;
  process.env.PMF_NOTIFICATION_EMAIL = RECIPIENT_EMAIL;
  process.env.PMF_OPERATOR_USER_ID = OPERATOR_UID;
  process.env.PMF_OPERATOR_COMPANY_ID = OPERATOR_COMPANY;
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("sendPmfNotification — integration (transport boundaries)", () => {
  describe("core routing", () => {
    it("threshold_alert with all three channels populated fires SMS, email, and in-app rail", async () => {
      // Dedup read returns empty → proceed to fan-out.
      tracker.dedupResultQueue.push({ data: [], error: null });
      sendSmsMock.mockResolvedValue({ sid: "SM_integration_1" });
      sendTransactionalEmailMock.mockResolvedValue(undefined);

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      await sendPmfNotification({
        kind: "threshold_alert",
        trigger: "marker_1_red",
        smsBody: "PMF :: M1 RED",
        emailSubject: "PMF alert — M1 red",
        emailReact: miniEmailReact(),
        inAppTitle: "// PMF — M1 RED",
        inAppBody: "Marker 1 flipped red",
        inAppActionUrl: "/admin/pmf?marker=1",
      });

      // SMS boundary hit exactly once.
      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      expect(tracker.smsCalls).toEqual([
        { to: RECIPIENT_SMS, body: "PMF :: M1 RED" },
      ]);

      // Email boundary hit exactly once with real-rendered HTML.
      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(tracker.emailCalls.length).toBe(1);
      const emailCall = tracker.emailCalls[0];
      expect(emailCall.to).toBe(RECIPIENT_EMAIL);
      expect(emailCall.subject).toBe("PMF alert — M1 red");
      // `@react-email/render` ran for real — verify the output is a
      // non-empty string containing our div body.
      expect(typeof emailCall.html).toBe("string");
      expect(emailCall.html.length).toBeGreaterThan(0);
      expect(emailCall.html).toContain("PMF test email body");

      // In-app rail insert into `notifications` — one row, keyed by the
      // operator company_id (the fix from Task 24).
      const rail = railInserts();
      expect(rail.length).toBe(1);
      expect(rail[0].company_id).toBe(OPERATOR_COMPANY);
      expect(rail[0].user_id).toBe(OPERATOR_UID);
      expect(rail[0].type).toBe("pmf_alert");
      expect(rail[0].title).toBe("// PMF — M1 RED");
      expect(rail[0].body).toBe("Marker 1 flipped red");
      expect(rail[0].action_url).toBe("/admin/pmf?marker=1");
      expect(rail[0].action_label).toBe("VIEW DECK");
      expect(rail[0].is_read).toBe(false);
      expect(rail[0].persistent).toBe(false);

      // Three log rows written (one per channel) — each success shape.
      const logRows = tracker.supabaseCalls
        .filter(
          (c) => c.table === "pmf_notification_log" && c.method === "insert"
        )
        .map((c) => c.args[0] as Record<string, unknown>);
      expect(logRows.length).toBe(3);
      for (const row of logRows) {
        expect(row.error).toBeNull();
        expect(typeof row.sent_at).toBe("string");
        expect(row.sent_at).not.toBeNull();
        expect(row.kind).toBe("threshold_alert");
        expect(row.trigger).toBe("marker_1_red");
      }
      expect(logInsertsFor("sms").length).toBe(1);
      expect(logInsertsFor("email").length).toBe(1);
      expect(logInsertsFor("in_app").length).toBe(1);
    });

    it("daily_digest fires email only (no SMS, no in-app, exactly one log row)", async () => {
      tracker.dedupResultQueue.push({ data: [], error: null });
      sendTransactionalEmailMock.mockResolvedValue(undefined);

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      await sendPmfNotification({
        kind: "daily_digest",
        trigger: "daily_2026-04-22",
        // Even if smsBody/inAppTitle are supplied, kind routing must ignore them.
        smsBody: "should be ignored",
        inAppTitle: "should be ignored",
        emailSubject: "[OPS] Daily PMF digest",
        emailReact: miniEmailReact(),
      });

      expect(sendSmsMock).not.toHaveBeenCalled();
      expect(tracker.smsCalls.length).toBe(0);

      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(tracker.emailCalls.length).toBe(1);
      expect(tracker.emailCalls[0].subject).toBe("[OPS] Daily PMF digest");
      expect(tracker.emailCalls[0].html).toContain("PMF test email body");

      expect(railInserts().length).toBe(0);
      expect(logInsertsFor("email").length).toBe(1);
      expect(logInsertsFor("sms").length).toBe(0);
      expect(logInsertsFor("in_app").length).toBe(0);
    });

    it("weekly_digest fires email only (no SMS, no in-app, exactly one log row)", async () => {
      tracker.dedupResultQueue.push({ data: [], error: null });
      sendTransactionalEmailMock.mockResolvedValue(undefined);

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      await sendPmfNotification({
        kind: "weekly_digest",
        trigger: "weekly_2026-W17",
        smsBody: "ignored",
        inAppTitle: "ignored",
        emailSubject: "[OPS] Weekly PMF digest",
        emailReact: miniEmailReact(),
      });

      expect(sendSmsMock).not.toHaveBeenCalled();
      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(tracker.emailCalls[0].subject).toBe("[OPS] Weekly PMF digest");

      expect(railInserts().length).toBe(0);
      expect(logInsertsFor("email").length).toBe(1);
      expect(logInsertsFor("sms").length).toBe(0);
      expect(logInsertsFor("in_app").length).toBe(0);
    });
  });

  describe("observability", () => {
    it("email transport failure is retried by withRetry and logs a failure row", async () => {
      vi.useFakeTimers();
      tracker.dedupResultQueue.push({ data: [], error: null });
      sendTransactionalEmailMock.mockRejectedValue(
        new Error("sendgrid 502 transient")
      );

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      const p = sendPmfNotification({
        kind: "daily_digest",
        trigger: "daily_2026-04-22",
        emailSubject: "[OPS] Daily PMF digest",
        emailReact: miniEmailReact(),
      });

      // withRetry uses 1s + 5s delays between 3 attempts; drive them past.
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      // The function must not throw to the caller — it swallows per-channel
      // failure and logs it.
      await expect(p).resolves.toBeUndefined();

      // Retried: at least 2 calls (unit test confirms exact = 3; we assert
      // the ≥ 2 lower bound here for robustness against retry-count tuning).
      expect(
        sendTransactionalEmailMock.mock.calls.length
      ).toBeGreaterThanOrEqual(2);

      // Failure log row has sent_at: null and a non-empty error.
      const emailRows = logInsertsFor("email");
      expect(emailRows.length).toBe(1);
      expect(emailRows[0].sent_at).toBeNull();
      expect(typeof emailRows[0].error).toBe("string");
      expect((emailRows[0].error as string).length).toBeGreaterThan(0);
      expect(emailRows[0].error).toBe("sendgrid 502 transient");
      expect(emailRows[0].recipient).toBe(RECIPIENT_EMAIL);
    });

    it("in-app insert DB failure logs a failure row without disrupting SMS/email", async () => {
      tracker.dedupResultQueue.push({ data: [], error: null });
      sendSmsMock.mockResolvedValue({ sid: "SM_ok" });
      sendTransactionalEmailMock.mockResolvedValue(undefined);
      // Rail insert fails with RLS-style error.
      tracker.railInsertResultQueue.push({
        data: null,
        error: { message: "RLS denied" },
      });

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      await sendPmfNotification({
        kind: "threshold_alert",
        trigger: "marker_2_red",
        smsBody: "PMF :: M2 RED",
        emailSubject: "PMF alert — M2 red",
        emailReact: miniEmailReact(),
        inAppTitle: "// PMF — M2 RED",
        inAppBody: "Marker 2 flipped red",
      });

      // SMS + email unaffected by the rail failure.
      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(logInsertsFor("sms")[0].sent_at).toBeTypeOf("string");
      expect(logInsertsFor("sms")[0].error).toBeNull();
      expect(logInsertsFor("email")[0].sent_at).toBeTypeOf("string");
      expect(logInsertsFor("email")[0].error).toBeNull();

      // In-app rail insert was attempted…
      expect(railInserts().length).toBe(1);
      // …and the failure produced a log row with the captured message.
      const inAppRows = logInsertsFor("in_app");
      expect(inAppRows.length).toBe(1);
      expect(inAppRows[0].sent_at).toBeNull();
      expect(inAppRows[0].error).toBe("RLS denied");
    });
  });

  describe("dedup at the boundary", () => {
    it("prior successful send in the window suppresses all channels", async () => {
      // Dedup read returns a prior row → hasRecentSend() resolves truthy.
      tracker.dedupResultQueue.push({
        data: [{ id: "prior-success" }],
        error: null,
      });

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      await sendPmfNotification({
        kind: "threshold_alert",
        trigger: "marker_1_red",
        smsBody: "PMF :: M1 RED",
        emailSubject: "PMF alert — M1 red",
        emailReact: miniEmailReact(),
        inAppTitle: "// PMF — M1 RED",
        inAppBody: "Marker 1 flipped red",
      });

      // Not a single transport/DB write should have fired.
      expect(sendSmsMock).not.toHaveBeenCalled();
      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
      expect(railInserts().length).toBe(0);
      // No new rows inserted into pmf_notification_log either.
      expect(
        tracker.supabaseCalls.some(
          (c) => c.table === "pmf_notification_log" && c.method === "insert"
        )
      ).toBe(false);
    });

    it("dedup query chain includes `.is('error', null)` so prior failures do not block a retry", async () => {
      // The dedup SELECT must filter out failure rows via `.is('error', null)`.
      // We simulate the filtered result (empty) and verify both: (a) all
      // three channels still fire, and (b) the `.is('error', null)` clause
      // is present in the recorded chain.
      tracker.dedupResultQueue.push({ data: [], error: null });
      sendSmsMock.mockResolvedValue({ sid: "SM_retry" });
      sendTransactionalEmailMock.mockResolvedValue(undefined);

      const { sendPmfNotification } =
        await import("@/lib/notifications/pmf-send");
      await sendPmfNotification({
        kind: "threshold_alert",
        trigger: "marker_3_red",
        smsBody: "PMF :: M3 RED",
        emailSubject: "PMF alert — M3 red",
        emailReact: miniEmailReact(),
        inAppTitle: "// PMF — M3 RED",
        inAppBody: "Marker 3 flipped red",
      });

      // All three channels still fire.
      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(railInserts().length).toBe(1);

      // The dedup query (on pmf_notification_log, pre-insert) includes an
      // `.is('error', null)` clause — without it, a prior failure row would
      // falsely block the retry.
      const isClauses = tracker.supabaseCalls.filter(
        (c) =>
          c.table === "pmf_notification_log" &&
          c.method === "is" &&
          c.args[0] === "error" &&
          c.args[1] === null
      );
      expect(isClauses.length).toBeGreaterThanOrEqual(1);
    });
  });
});

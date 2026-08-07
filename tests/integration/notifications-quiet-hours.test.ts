/**
 * Integration tests for quiet hours at the notification dispatch chokepoint.
 *
 * Scope: `resolveNotificationPreferences` is the single seam that decides who
 * receives an in-app rail row, a push, and an email for every dispatch —
 * both the authenticated HTTP route (`/api/notifications/dispatch`) and
 * trusted server workflows funnel through `dispatchNotificationEvent`, which
 * calls it. Quiet hours therefore belong here, not at any individual caller.
 *
 * What's mocked:
 *   - the Supabase client only (`users`, `notification_preferences`,
 *     `companies` reads). Recipient filtering, preference parsing, timezone
 *     resolution, and the quiet-hours predicate all run for real.
 *
 * Contract under test (ported from iOS
 * `NotificationManager.shouldSendNotification`):
 *   start > end  → window spans midnight → quiet when now >= start OR now < end
 *   start < end  → same-day window       → quiet when now >= start AND now < end
 *   start == end → NOT quiet hours (matches the settings-screen warning copy)
 *   either NULL  → NOT quiet hours
 *
 * "Now" is a time-of-day read in the company's IANA timezone
 * (`companies.timezone`) — OPS has no per-user timezone column. Suppression
 * removes PUSH only: the in-app rail row is the durable audit surface and
 * email is unaffected. Suppressed pushes are dropped, never queued.
 *
 * Time is frozen with `vi.useFakeTimers({ toFake: ["Date"] })` so no assertion
 * depends on the wall clock at run time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveNotificationPreferences } from "@/lib/notifications/server-notification-service";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_COMPANY_ID = "44444444-4444-4444-8444-444444444444";
const USER_ONE = "11111111-1111-4111-8111-111111111111";
const USER_TWO = "22222222-2222-4222-8222-222222222222";
const USER_THREE = "55555555-5555-4555-8555-555555555555";
const PREFERENCE_KEY = "project_updates";

/** Row shape as PostgREST returns it from `notification_preferences`. */
interface PreferenceRow {
  user_id: string;
  push_enabled?: boolean | null;
  email_enabled?: boolean | null;
  channel_preferences?: Record<string, unknown> | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

interface FakeDbOptions {
  companyId: string;
  preferences: PreferenceRow[];
  /** `companies.timezone` — NOT NULL in prod, so a string unless overridden. */
  timezone?: string;
  /** Simulate a missing company row (maybeSingle → data: null). */
  companyRowMissing?: boolean;
  /** Simulate a failed company lookup. */
  companyError?: { message: string };
}

interface FakeDb {
  db: SupabaseClient;
  tablesRead: string[];
}

/**
 * Chainable Supabase stub. Every filter method returns the builder and the
 * builder is thenable, so both terminal styles used by the service work:
 * `await db.from(...).select().in().eq().eq()` and `.maybeSingle()`.
 */
function makeDb(options: FakeDbOptions): FakeDb {
  const tablesRead: string[] = [];

  const resultFor = (table: string): { data: unknown; error: unknown } => {
    if (table === "users") {
      return {
        data: options.preferences.map((row) => ({ id: row.user_id })),
        error: null,
      };
    }
    if (table === "notification_preferences") {
      return { data: options.preferences, error: null };
    }
    if (table === "companies") {
      if (options.companyError) {
        return { data: null, error: options.companyError };
      }
      return {
        data: options.companyRowMissing
          ? null
          : { timezone: options.timezone ?? "America/Vancouver" },
        error: null,
      };
    }
    return { data: null, error: null };
  };

  const db = {
    from(table: string) {
      tablesRead.push(table);
      const result = resultFor(table);
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
    },
  } as unknown as SupabaseClient;

  return { db, tablesRead };
}

/** Freeze the clock at `now`, then resolve preferences through the real seam. */
async function resolveAt(params: FakeDbOptions & { now: string }) {
  vi.setSystemTime(new Date(params.now));
  const { db, tablesRead } = makeDb(params);
  const result = await resolveNotificationPreferences({
    companyId: params.companyId,
    recipientUserIds: params.preferences.map((row) => row.user_id),
    preferenceKey: PREFERENCE_KEY,
    db,
  });
  return { result, tablesRead };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Only Date is faked — timers/microtasks stay real so awaited DB stubs
  // resolve normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warnSpy.mockRestore();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("quiet hours at the notification dispatch chokepoint", () => {
  describe("same-day window (start < end)", () => {
    it("suppresses push inside the window while keeping the in-app rail row", async () => {
      const { result } = await resolveAt({
        // 20:00 in UTC, inside 19:00–21:00.
        now: "2026-01-15T20:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "19:00:00",
            quiet_hours_end: "21:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
      expect(result.inAppRecipientIds).toEqual([USER_ONE]);
    });

    it("sends push outside the window", async () => {
      const { result } = await resolveAt({
        // 20:00 in UTC, outside 08:00–09:00.
        now: "2026-01-15T20:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "08:00:00",
            quiet_hours_end: "09:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([USER_ONE]);
      expect(result.inAppRecipientIds).toEqual([USER_ONE]);
    });
  });

  describe("window spanning midnight (start > end)", () => {
    it("suppresses push after the start boundary", async () => {
      const { result } = await resolveAt({
        // 23:00 in UTC, inside 22:00–07:00.
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
      expect(result.inAppRecipientIds).toEqual([USER_ONE]);
    });

    it("suppresses push before the end boundary", async () => {
      const { result } = await resolveAt({
        // 03:00 in UTC, still inside 22:00–07:00.
        now: "2026-01-15T03:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
    });

    it("sends push between the end and start boundaries", async () => {
      const { result } = await resolveAt({
        // 12:00 in UTC, outside 22:00–07:00.
        now: "2026-01-15T12:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([USER_ONE]);
    });

    it("tolerates HH:MM values without a seconds component", async () => {
      const { result } = await resolveAt({
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00",
            quiet_hours_end: "07:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
    });
  });

  describe("windows that mean nothing", () => {
    it("sends push when start, end, or both are NULL — without reading companies", async () => {
      const { result, tablesRead } = await resolveAt({
        // 23:00 UTC would be inside 22:00–07:00 had the window been complete.
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: null,
            quiet_hours_end: "07:00:00",
          },
          {
            user_id: USER_TWO,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: null,
          },
          {
            user_id: USER_THREE,
            quiet_hours_start: null,
            quiet_hours_end: null,
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([USER_ONE, USER_TWO, USER_THREE]);
      // Cost guarantee: no configured window → no extra round-trip per dispatch.
      expect(tablesRead).not.toContain("companies");
    });

    it("sends push when start equals end", async () => {
      const { result } = await resolveAt({
        // Exactly on the boundary — iOS treats start == end as no quiet hours.
        now: "2026-01-15T22:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "22:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([USER_ONE]);
    });
  });

  describe("timezone resolution", () => {
    it("evaluates the same window against each company's own timezone", async () => {
      // One fixed instant. 06:00Z is inside 22:00–07:00 for a UTC company and
      // 15:00 the same day for a Tokyo (UTC+9) company.
      const instant = "2026-01-15T06:00:00Z";
      const window = {
        user_id: USER_ONE,
        quiet_hours_start: "22:00:00",
        quiet_hours_end: "07:00:00",
      };

      const utcCompany = await resolveAt({
        now: instant,
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [window],
      });
      const tokyoCompany = await resolveAt({
        now: instant,
        companyId: OTHER_COMPANY_ID,
        timezone: "Asia/Tokyo",
        preferences: [window],
      });

      expect(utcCompany.result.pushRecipientIds).toEqual([]);
      expect(tokyoCompany.result.pushRecipientIds).toEqual([USER_ONE]);
      expect(utcCompany.tablesRead).toContain("companies");
    });

    it("falls back to UTC with a warning when the timezone is not a known zone", async () => {
      const { result } = await resolveAt({
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "Mars/Olympus_Mons",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      // 23:00 UTC → inside the window under the fallback zone.
      expect(result.pushRecipientIds).toEqual([]);
      const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(
        warnings.some(
          (line) =>
            line.includes("quiet_hours_timezone_fallback") &&
            line.includes(COMPANY_ID)
        )
      ).toBe(true);
    });

    it("falls back to UTC when the company row is missing", async () => {
      const { result } = await resolveAt({
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        companyRowMissing: true,
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
    });

    it("surfaces a company timezone lookup failure instead of guessing", async () => {
      vi.setSystemTime(new Date("2026-01-15T23:00:00Z"));
      const { db } = makeDb({
        companyId: COMPANY_ID,
        companyError: { message: "timezone read unavailable" },
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      await expect(
        resolveNotificationPreferences({
          companyId: COMPANY_ID,
          recipientUserIds: [USER_ONE],
          preferenceKey: PREFERENCE_KEY,
          db,
        })
      ).rejects.toThrow(
        "Company timezone lookup failed: timezone read unavailable"
      );
    });
  });

  describe("blast radius", () => {
    it("suppresses only the recipients inside their own window", async () => {
      const { result } = await resolveAt({
        // 23:00 UTC: inside USER_ONE's 22:00–07:00, outside USER_TWO's 09:00–17:00.
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
          {
            user_id: USER_TWO,
            quiet_hours_start: "09:00:00",
            quiet_hours_end: "17:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([USER_TWO]);
      expect(result.inAppRecipientIds).toEqual([USER_ONE, USER_TWO]);
    });

    it("leaves the rail and email untouched while push is suppressed", async () => {
      const { result } = await resolveAt({
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            email_enabled: true,
            channel_preferences: { [PREFERENCE_KEY]: { email: true } },
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
      expect(result.inAppRecipientIds).toEqual([USER_ONE]);
      expect(result.emailRecipientIds).toEqual([USER_ONE]);
    });

    it("logs one deferred_quiet_hours line naming the count and company", async () => {
      await resolveAt({
        now: "2026-01-15T23:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
          {
            user_id: USER_TWO,
            quiet_hours_start: "21:00:00",
            quiet_hours_end: "06:00:00",
          },
          {
            user_id: USER_THREE,
            quiet_hours_start: "09:00:00",
            quiet_hours_end: "17:00:00",
          },
        ],
      });

      const suppressionLines = warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("deferred_quiet_hours"));
      expect(suppressionLines).toHaveLength(1);
      expect(suppressionLines[0]).toContain("2");
      expect(suppressionLines[0]).toContain(COMPANY_ID);
    });

    it("stays silent when nothing is suppressed", async () => {
      await resolveAt({
        now: "2026-01-15T12:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(
        warnSpy.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes("deferred_quiet_hours"))
      ).toHaveLength(0);
    });

    it("never pushes to a recipient who disabled push, quiet hours or not", async () => {
      const { result } = await resolveAt({
        now: "2026-01-15T12:00:00Z",
        companyId: COMPANY_ID,
        timezone: "UTC",
        preferences: [
          {
            user_id: USER_ONE,
            push_enabled: false,
            quiet_hours_start: "22:00:00",
            quiet_hours_end: "07:00:00",
          },
        ],
      });

      expect(result.pushRecipientIds).toEqual([]);
      expect(result.inAppRecipientIds).toEqual([USER_ONE]);
    });
  });
});

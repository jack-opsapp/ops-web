/**
 * Unit tests for `filterPushRecipientsByQuietHours` — the shared quiet-hours
 * gate for push senders that do NOT flow through
 * `resolveNotificationPreferences`.
 *
 * Those senders (the task-mutation outbox, the three lead-delivery workers, the
 * opportunity-conversion worker, trial expiry, role-needed) each derive their
 * own recipients from an RPC claim and then pushed unconditionally — the crew
 * leak behind bug 42aa787c. This helper is the one place they now share.
 *
 * What's mocked: the Supabase client only (`notification_preferences` and
 * `companies` reads). Window parsing, timezone resolution and the quiet-hours
 * predicate all run for real, so these tests pin the same contract the
 * dispatch chokepoint enforces:
 *
 *   start > end  → window spans midnight → quiet when now >= start OR now < end
 *   start < end  → same-day window       → quiet when now >= start AND now < end
 *   start == end → NOT quiet hours
 *   either NULL  → NOT quiet hours
 *
 * Time is frozen with `vi.useFakeTimers({ toFake: ["Date"] })` so no assertion
 * depends on the wall clock at run time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { filterPushRecipientsByQuietHours } from "@/lib/notifications/server-notification-service";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const USER_ONE = "11111111-1111-4111-8111-111111111111";
const USER_TWO = "22222222-2222-4222-8222-222222222222";

/** Row shape as PostgREST returns it from `notification_preferences`. */
interface PreferenceRow {
  user_id: string;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

interface FakeDbOptions {
  preferences: PreferenceRow[];
  /** `companies.timezone` — NOT NULL in prod, so a string unless overridden. */
  timezone?: string;
  /** Simulate a failed preference lookup. */
  preferenceError?: { message: string };
}

interface FakeDb {
  db: SupabaseClient;
  tablesRead: string[];
}

/**
 * Chainable Supabase stub. Every filter method returns the builder and the
 * builder is thenable, so both terminal styles the service uses work:
 * `await db.from(...).select().in().eq()` and `.maybeSingle()`.
 */
function makeDb(options: FakeDbOptions): FakeDb {
  const tablesRead: string[] = [];

  const resultFor = (table: string): { data: unknown; error: unknown } => {
    if (table === "notification_preferences") {
      if (options.preferenceError) {
        return { data: null, error: options.preferenceError };
      }
      return { data: options.preferences, error: null };
    }
    if (table === "companies") {
      return {
        data: { timezone: options.timezone ?? "America/Vancouver" },
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

/** Freeze the clock at `now`, then run the real filter. */
async function filterAt(
  params: FakeDbOptions & { now: string; recipientUserIds?: string[] }
) {
  vi.setSystemTime(new Date(params.now));
  const { db, tablesRead } = makeDb(params);
  const delivered = await filterPushRecipientsByQuietHours({
    companyId: COMPANY_ID,
    recipientUserIds:
      params.recipientUserIds ?? params.preferences.map((row) => row.user_id),
    db,
  });
  return { delivered, tablesRead };
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

describe("filterPushRecipientsByQuietHours", () => {
  it("returns an empty list without touching the database for no recipients", async () => {
    const { delivered, tablesRead } = await filterAt({
      now: "2026-01-15T23:00:00Z",
      preferences: [],
      recipientUserIds: [],
    });

    expect(delivered).toEqual([]);
    expect(tablesRead).toEqual([]);
  });

  it("passes NULL windows through untouched and skips the company read", async () => {
    // Every Canpro row has NULL quiet hours today — this is the hot path and
    // it must cost exactly one query.
    const { delivered, tablesRead } = await filterAt({
      now: "2026-01-15T23:00:00Z",
      preferences: [
        { user_id: USER_ONE, quiet_hours_start: null, quiet_hours_end: null },
        { user_id: USER_TWO },
      ],
    });

    expect(delivered).toEqual([USER_ONE, USER_TWO]);
    expect(tablesRead).toEqual(["notification_preferences"]);
  });

  it("passes recipients with no preference row at all", async () => {
    const { delivered } = await filterAt({
      now: "2026-01-15T23:00:00Z",
      preferences: [],
      recipientUserIds: [USER_ONE],
    });

    expect(delivered).toEqual([USER_ONE]);
  });

  it("drops the recipient inside a midnight-spanning window and keeps the one outside", async () => {
    const { delivered, tablesRead } = await filterAt({
      // 23:00 UTC — inside USER_ONE's 22:00–07:00, outside USER_TWO's 01:00–06:00.
      now: "2026-01-15T23:00:00Z",
      timezone: "UTC",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "22:00:00",
          quiet_hours_end: "07:00:00",
        },
        {
          user_id: USER_TWO,
          quiet_hours_start: "01:00:00",
          quiet_hours_end: "06:00:00",
        },
      ],
    });

    expect(delivered).toEqual([USER_TWO]);
    // A configured window costs the company timezone read.
    expect(tablesRead).toEqual(["notification_preferences", "companies"]);
  });

  it("suppresses inside a same-day window and delivers outside it", async () => {
    const inside = await filterAt({
      now: "2026-01-15T13:30:00Z",
      timezone: "UTC",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "13:00:00",
          quiet_hours_end: "14:00:00",
        },
      ],
    });
    expect(inside.delivered).toEqual([]);

    const outside = await filterAt({
      now: "2026-01-15T15:30:00Z",
      timezone: "UTC",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "13:00:00",
          quiet_hours_end: "14:00:00",
        },
      ],
    });
    expect(outside.delivered).toEqual([USER_ONE]);
  });

  it("never suppresses when start equals end", async () => {
    const { delivered, tablesRead } = await filterAt({
      now: "2026-01-15T22:00:00Z",
      timezone: "UTC",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "22:00:00",
          quiet_hours_end: "22:00:00",
        },
      ],
    });

    expect(delivered).toEqual([USER_ONE]);
    // A zero-width window cannot silence anything, so no company read.
    expect(tablesRead).toEqual(["notification_preferences"]);
  });

  it("evaluates the window in the company's timezone, not UTC", async () => {
    // 06:00 UTC is 22:00 the previous day in America/Vancouver (PST, UTC-8),
    // which sits inside a 21:00–07:00 window. A naive UTC read would deliver.
    const { delivered } = await filterAt({
      now: "2026-01-16T06:00:00Z",
      timezone: "America/Vancouver",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "21:00:00",
          quiet_hours_end: "07:00:00",
        },
      ],
    });

    expect(delivered).toEqual([]);
  });

  it("falls back to UTC for an unresolvable timezone and still filters", async () => {
    const { delivered } = await filterAt({
      // 23:00 UTC, inside 22:00–07:00 once the fallback pins the clock to UTC.
      now: "2026-01-15T23:00:00Z",
      timezone: "Mars/Olympus_Mons",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "22:00:00",
          quiet_hours_end: "07:00:00",
        },
      ],
    });

    expect(delivered).toEqual([]);
  });

  it("de-duplicates recipient ids", async () => {
    const { delivered } = await filterAt({
      now: "2026-01-15T12:00:00Z",
      timezone: "UTC",
      preferences: [{ user_id: USER_ONE }],
      recipientUserIds: [USER_ONE, USER_ONE],
    });

    expect(delivered).toEqual([USER_ONE]);
  });

  it("throws when the preference lookup fails rather than pushing blind", async () => {
    await expect(
      filterAt({
        now: "2026-01-15T23:00:00Z",
        preferences: [],
        recipientUserIds: [USER_ONE],
        preferenceError: { message: "connection reset" },
      })
    ).rejects.toThrow("Quiet-hours preference lookup failed: connection reset");
  });
});

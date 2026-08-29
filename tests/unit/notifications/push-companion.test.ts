/**
 * Unit tests for the push-companion core (bug c2946efc audit + 42aa787c).
 *
 * Every iOS companion push has been dead since 2026-07-16, when the arbitrary
 * -recipient/arbitrary-copy proxy at `/api/notifications/send` became a 404.
 * The replacement is proof-based: the caller names a notification type and the
 * recipients whose rail rows a narrow SECURITY DEFINER RPC just wrote, and the
 * server pushes those durable rows' own copy.
 *
 * These tests pin the properties that keep it from being the old hole again:
 * company scope, the 15-minute window, actor exclusion, newest-row-per-user,
 * the preference and quiet-hours gates, row-derived payloads, and a per-row
 * idempotency key.
 *
 * What's mocked: OneSignal and the Supabase client. Preference parsing, the
 * channel map, quiet-hours evaluation and payload derivation all run for real.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/onesignal", () => ({ sendOneSignalPush: push }));

import {
  opportunityIdFromActionUrl,
  parsePushCompanionRequest,
  sendPushCompanions,
} from "@/lib/notifications/push-companion";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "99999999-9999-4999-8999-999999999999";
const USER_ONE = "11111111-1111-4111-8111-111111111111";
const USER_TWO = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY_ID = "44444444-4444-4444-8444-444444444444";

const actor = { userId: ACTOR_ID, companyId: COMPANY_ID };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user_id: USER_ONE,
    type: "mention",
    title: "Jackson mentioned you",
    body: "Check the framing detail on the north elevation.",
    deep_link_type: "projectNotes",
    project_id: "project-1",
    batch_id: null,
    note_id: "note-1",
    action_url: "/dashboard?openProject=project-1",
    created_at: "2026-01-15T11:59:00.000Z",
    ...overrides,
  };
}

interface DbOptions {
  notifications?: Array<Record<string, unknown>>;
  preferences?: Array<Record<string, unknown>>;
  timezone?: string;
  notificationsError?: { message: string };
}

interface Recorded {
  table: string;
  filters: Array<{ method: string; args: unknown[] }>;
}

function makeDb(options: DbOptions) {
  const calls: Recorded[] = [];

  const db = {
    from(table: string) {
      const recorded: Recorded = { table, filters: [] };
      calls.push(recorded);

      const result =
        table === "notifications"
          ? {
              data: options.notificationsError
                ? null
                : (options.notifications ?? []),
              error: options.notificationsError ?? null,
            }
          : table === "notification_preferences"
            ? { data: options.preferences ?? [], error: null }
            : table === "companies"
              ? {
                  data: { timezone: options.timezone ?? "UTC" },
                  error: null,
                }
              : { data: null, error: null };

      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "gte", "order", "is", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          recorded.filters.push({ method, args });
          return builder;
        };
      }
      builder.maybeSingle = async () => result;
      builder.then = (
        resolve: (value: typeof result) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

function run(options: DbOptions, request?: Partial<Record<string, unknown>>) {
  const { db, calls } = makeDb(options);
  return sendPushCompanions({
    db,
    actor,
    request: {
      notificationType: "mention",
      recipientUserIds: [USER_ONE, USER_TWO],
      ...request,
    } as Parameters<typeof sendPushCompanions>[0]["request"],
  }).then((result) => ({ result, calls }));
}

beforeEach(() => {
  push.mockReset();
  push.mockResolvedValue({ ok: true, recipients: 1 });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Request parsing ────────────────────────────────────────────────────────

describe("parsePushCompanionRequest", () => {
  it("accepts a well-formed body and de-duplicates recipients", () => {
    const parsed = parsePushCompanionRequest({
      notificationType: " mention ",
      recipientUserIds: [USER_ONE, USER_ONE, "  "],
      dedupeKey: "mention:note-1",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        notificationType: "mention",
        recipientUserIds: [USER_ONE],
        dedupeKey: "mention:note-1",
      },
    });
  });

  it("rejects a missing type, a non-array recipient list, and an empty one", () => {
    expect(
      parsePushCompanionRequest({ recipientUserIds: [USER_ONE] })
    ).toMatchObject({ ok: false });
    expect(
      parsePushCompanionRequest({ notificationType: "mention", recipientUserIds: USER_ONE })
    ).toMatchObject({ ok: false });
    expect(
      parsePushCompanionRequest({ notificationType: "mention", recipientUserIds: [] })
    ).toMatchObject({ ok: false });
    expect(parsePushCompanionRequest(null)).toMatchObject({ ok: false });
  });
});

// ─── Payload derivation ─────────────────────────────────────────────────────

describe("opportunityIdFromActionUrl", () => {
  it("reads every query form the rail builders stamp", () => {
    expect(
      opportunityIdFromActionUrl(`/pipeline?opportunityId=${OPPORTUNITY_ID}`)
    ).toBe(OPPORTUNITY_ID);
    expect(opportunityIdFromActionUrl(`/pipeline?leadId=${OPPORTUNITY_ID}`)).toBe(
      OPPORTUNITY_ID
    );
    expect(opportunityIdFromActionUrl(`/leads?id=${OPPORTUNITY_ID}`)).toBe(
      OPPORTUNITY_ID
    );
  });

  it("returns null when there is no id to hand iOS", () => {
    expect(opportunityIdFromActionUrl("/pipeline")).toBeNull();
    expect(opportunityIdFromActionUrl(null)).toBeNull();
    expect(opportunityIdFromActionUrl("   ")).toBeNull();
  });
});

// ─── Row matching ───────────────────────────────────────────────────────────

describe("sendPushCompanions row matching", () => {
  it("scopes the lookup to the actor's company, the type, and a 15-minute window", async () => {
    const { calls } = await run({ notifications: [row()] });

    const lookup = calls.find((call) => call.table === "notifications");
    expect(lookup).toBeDefined();
    const filters = lookup!.filters;
    expect(filters).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_ID],
    });
    expect(filters).toContainEqual({ method: "eq", args: ["type", "mention"] });
    expect(filters).toContainEqual({
      method: "in",
      args: ["user_id", [USER_ONE, USER_TWO]],
    });
    // 12:00:00Z minus fifteen minutes.
    expect(filters).toContainEqual({
      method: "gte",
      args: ["created_at", "2026-01-15T11:45:00.000Z"],
    });
  });

  it("adds the dedupe-key filter only when one is supplied", async () => {
    const withKey = await run({ notifications: [row()] }, { dedupeKey: "k-1" });
    expect(
      withKey.calls.find((c) => c.table === "notifications")!.filters
    ).toContainEqual({ method: "eq", args: ["dedupe_key", "k-1"] });

    const withoutKey = await run({ notifications: [row()] });
    expect(
      withoutKey.calls
        .find((c) => c.table === "notifications")!
        .filters.some(
          (f) => f.method === "eq" && f.args[0] === "dedupe_key"
        )
    ).toBe(false);
  });

  it("never pushes the actor's own receipt row", async () => {
    const { result } = await run({
      notifications: [row({ user_id: ACTOR_ID })],
    });

    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: 0, pushed: 0, suppressed: 0 });
  });

  it("keeps only the newest row per recipient", async () => {
    // The query orders newest first, so the first row per user wins.
    const { result } = await run({
      notifications: [
        row({ id: "newest", created_at: "2026-01-15T11:59:00.000Z" }),
        row({ id: "older", created_at: "2026-01-15T11:50:00.000Z" }),
      ],
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "newest" })
    );
    expect(result).toMatchObject({ matched: 1, pushed: 1 });
  });

  it("does nothing when no row matches", async () => {
    const { result } = await run({ notifications: [] });

    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: 0, pushed: 0, suppressed: 0 });
  });

  it("throws rather than pushing blind when the lookup fails", async () => {
    await expect(
      run({ notificationsError: { message: "connection reset" } })
    ).rejects.toThrow("Companion row lookup failed: connection reset");
  });
});

// ─── Payload ────────────────────────────────────────────────────────────────

describe("sendPushCompanions payload", () => {
  it("sends the row's own copy, a row-derived payload, and the row id as the idempotency key", async () => {
    await run({
      notifications: [
        row({
          id: "row-1",
          type: "expense_approved",
          title: "Expense approved",
          body: "Your Home Depot batch was approved.",
          deep_link_type: "expense",
          project_id: null,
          batch_id: "batch-9",
          note_id: null,
          action_url: `/pipeline?opportunityId=${OPPORTUNITY_ID}`,
        }),
      ],
    });

    expect(push).toHaveBeenCalledWith({
      recipientUserIds: [USER_ONE],
      title: "Expense approved",
      body: "Your Home Depot batch was approved.",
      data: {
        type: "expense_approved",
        deep_link_type: "expense",
        batchId: "batch-9",
        leadId: OPPORTUNITY_ID,
      },
      idempotencyKey: "row-1",
    });
  });

  it("omits every key the row does not carry and never sends a screen key", async () => {
    await run({
      notifications: [
        row({
          deep_link_type: null,
          project_id: null,
          batch_id: null,
          note_id: null,
          action_url: null,
        }),
      ],
    });

    const [[params]] = push.mock.calls;
    expect(params.data).toEqual({ type: "mention" });
    expect(params.data).not.toHaveProperty("screen");
  });
});

// ─── Preference and quiet-hours gates ───────────────────────────────────────

describe("sendPushCompanions gates", () => {
  it("drops a recipient with push disabled globally", async () => {
    const { result } = await run({
      notifications: [row()],
      preferences: [{ user_id: USER_ONE, push_enabled: false }],
    });

    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: 1, pushed: 0, suppressed: 1 });
  });

  it("honours the channel key mapped for the type", async () => {
    // `mention` maps to `team_mentions`.
    const off = await run({
      notifications: [row()],
      preferences: [
        {
          user_id: USER_ONE,
          channel_preferences: { team_mentions: { push: false } },
        },
      ],
    });
    expect(push).not.toHaveBeenCalled();
    expect(off.result).toMatchObject({ matched: 1, pushed: 0, suppressed: 1 });

    push.mockClear();

    // A different channel being off must not silence this one.
    await run({
      notifications: [row()],
      preferences: [
        {
          user_id: USER_ONE,
          channel_preferences: { project_updates: { push: false } },
        },
      ],
    });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("pushes an unmapped type on the global flag alone", async () => {
    await run(
      {
        notifications: [row({ type: "team_join" })],
        preferences: [
          {
            user_id: USER_ONE,
            channel_preferences: { team_mentions: { push: false } },
          },
        ],
      },
      { notificationType: "team_join" }
    );

    expect(push).toHaveBeenCalledTimes(1);
  });

  it("suppresses a recipient inside their quiet hours", async () => {
    // 12:00 UTC sits inside an 08:00–17:00 window.
    const { result } = await run({
      notifications: [row()],
      timezone: "UTC",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "08:00:00",
          quiet_hours_end: "17:00:00",
        },
      ],
    });

    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: 1, pushed: 0, suppressed: 1 });
  });

  it("delivers outside the window", async () => {
    const { result } = await run({
      notifications: [row()],
      timezone: "UTC",
      preferences: [
        {
          user_id: USER_ONE,
          quiet_hours_start: "22:00:00",
          quiet_hours_end: "07:00:00",
        },
      ],
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ matched: 1, pushed: 1, suppressed: 0 });
  });

  it("counts a provider failure as suppressed rather than throwing", async () => {
    push.mockResolvedValue({ ok: false, error: new Error("provider down") });

    const { result } = await run({ notifications: [row()] });

    expect(result).toEqual({ matched: 1, pushed: 0, suppressed: 1 });
  });
});

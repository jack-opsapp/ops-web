/**
 * Integration tests for GET /api/cron/google-calendar-sync.
 *
 * Drains `google_calendar_sync_queue` (fed by the site_visits trigger) into
 * the Google Calendar API for the company's calendar-scoped mailbox.
 *
 *   create/update → upsert on calendar `primary` (patch when an event id is
 *                   known, insert otherwise; 404 on patch recreates — OPS is
 *                   the source of truth), then write the event id back to
 *                   the visit and settle the row `succeeded`.
 *   delete        → remove the remote event; 404/410 count as done.
 *
 * A connection without calendar scope settles rows `skipped`/
 * `missing_calendar_scope` — never an error. Revoked grants
 * (invalid_grant refresh, 401 from the API) settle `skipped`/
 * `grant_revoked`. Transient failures back off exponentially and fail
 * permanently on the fifth attempt.
 *
 * Mocking strategy mirrors the other cron suites: hand-rolled chainable
 * Supabase mock, pass-through workload control, HTTP faked at the
 * deadline-fetch seam, token refresh faked at the gmail-token seam.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const VALID_SECRET = "test-cron-secret";
const APP_URL = "https://app.test";
const GMAIL_SCOPE = "https://mail.google.com/";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

let tableResponses: Record<
  string,
  { data: unknown; error: { message: string } | null }
> = {};
let recordedUpdates: RecordedUpdate[] = [];
let nextControlSkip: "lease_held" | "circuit_open" | null = null;

const { tokenMock, fetchOnceMock } = vi.hoisted(() => ({
  tokenMock: vi.fn(),
  fetchOnceMock: vi.fn(),
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeMockClient(),
}));

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    return {
      ...actual,
      runWithCronWorkloadControl: async ({
        work,
      }: {
        work: () => Promise<unknown>;
      }) => {
        if (nextControlSkip) {
          return { status: "skipped", reason: nextControlSkip };
        }
        return { status: "completed", value: await work() };
      },
    };
  }
);

vi.mock("@/lib/api/services/gmail-token", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/services/gmail-token")>();
  return {
    ...actual,
    getValidGmailToken: tokenMock,
  };
});

vi.mock("@/lib/api/services/providers/gmail-read", () => ({
  fetchGmailOnceWithinDeadline: fetchOnceMock,
}));

function makeQuery(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  let update: RecordedUpdate | null = null;
  for (const method of ["select", "eq", "lte", "in", "order", "limit"]) {
    q[method] = (...args: unknown[]) => {
      if (update && method === "eq") {
        update.filters.push([args[0] as string, args[1]]);
      }
      return q;
    };
  }
  q.update = (payload: Record<string, unknown>) => {
    update = { table, payload, filters: [] };
    recordedUpdates.push(update);
    return q;
  };
  q.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown
  ) => {
    const response = update
      ? { data: null, error: null }
      : (tableResponses[table] ?? { data: [], error: null });
    return Promise.resolve(response).then(resolve, reject);
  };
  return q;
}

function makeMockClient() {
  return { from: (table: string) => makeQuery(table) };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PAST = "2026-08-12T00:00:00.000Z";

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    company_id: "11111111-1111-4111-8111-111111111111",
    connection_id: "conn-1",
    site_visit_id: "visit-1",
    operation: "create",
    google_calendar_id: null,
    google_calendar_event_id: null,
    status: "pending",
    attempts: 0,
    next_attempt_at: PAST,
    created_at: PAST,
    ...overrides,
  };
}

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    company_id: "11111111-1111-4111-8111-111111111111",
    status: "active",
    granted_scopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
    access_token: "stored-access",
    refresh_token: "stored-refresh",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    opportunity_id: "opp-1",
    scheduled_at: "2026-08-13T21:00:00.000Z",
    duration_minutes: 60,
    status: "scheduled",
    booked_at: "2026-08-11T12:00:00.000Z",
    deleted_at: null,
    google_calendar_event_id: null,
    google_calendar_id: null,
    ...overrides,
  };
}

const LEAD = { id: "opp-1", title: "Faye Keys", address: "630 Agnes St" };

function scriptTables(params: {
  queue: Array<Record<string, unknown>>;
  connections?: Array<Record<string, unknown>>;
  visits?: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
}) {
  tableResponses = {
    google_calendar_sync_queue: { data: params.queue, error: null },
    email_connections: {
      data: params.connections ?? [connectionRow()],
      error: null,
    },
    site_visits: { data: params.visits ?? [visitRow()], error: null },
    opportunities: { data: params.opportunities ?? [LEAD], error: null },
  };
}

function googleResponse(
  status: number,
  body: Record<string, unknown> = {}
): {
  ok: boolean;
  status: number;
  json: () => Promise<Record<string, unknown>>;
  text: () => Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function googleCalls(): Array<{ method: string; url: string }> {
  return fetchOnceMock.mock.calls.map((call) => ({
    method:
      ((call[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase(),
    url: String(call[0]),
  }));
}

function updatesFor(table: string): RecordedUpdate[] {
  return recordedUpdates.filter((entry) => entry.table === table);
}

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request("http://localhost/api/cron/google-calendar-sync", {
    method: "GET",
    headers,
  }) as unknown as NextRequest;
}

async function runRoute(authHeader = `Bearer ${VALID_SECRET}`) {
  const { GET } = await import("@/app/api/cron/google-calendar-sync/route");
  return GET(buildReq(authHeader));
}

beforeEach(() => {
  vi.clearAllMocks();
  tableResponses = {};
  recordedUpdates = [];
  nextControlSkip = null;
  process.env.CRON_SECRET = VALID_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  tokenMock.mockResolvedValue("fresh-access-token");
});

// ─── Auth ────────────────────────────────────────────────────────────────────

describe("auth", () => {
  it("rejects a missing or wrong bearer", async () => {
    const response = await runRoute("Bearer wrong");
    expect(response.status).toBe(401);
  });

  it("fails closed without a configured secret", async () => {
    delete process.env.CRON_SECRET;
    const response = await runRoute();
    expect(response.status).toBe(500);
  });

  it("reports lease-held as an ok no-run", async () => {
    nextControlSkip = "lease_held";
    const response = await runRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ran: false });
  });
});

// ─── Upsert lane ─────────────────────────────────────────────────────────────

describe("create/update drain", () => {
  it("creates the event, writes it back to the visit, settles the row", async () => {
    scriptTables({ queue: [queueRow()] });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(200, { id: "gev-1" }));

    const response = await runRoute();
    expect(response.status).toBe(200);

    const calls = googleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    );
    const sentBody = JSON.parse(
      String((fetchOnceMock.mock.calls[0][1] as RequestInit).body)
    );
    expect(sentBody).toMatchObject({
      summary: "Site visit — Faye Keys",
      location: "630 Agnes St",
      description: `Open in OPS: ${APP_URL}/pipeline?opportunityId=opp-1`,
      start: { dateTime: "2026-08-13T21:00:00.000Z" },
      end: { dateTime: "2026-08-13T22:00:00.000Z" },
    });

    const visitUpdates = updatesFor("site_visits");
    expect(visitUpdates).toHaveLength(1);
    expect(visitUpdates[0].payload).toMatchObject({
      google_calendar_event_id: "gev-1",
      google_calendar_id: "primary",
    });
    expect(visitUpdates[0].payload.google_calendar_synced_at).toBeTruthy();
    expect(visitUpdates[0].filters).toContainEqual(["id", "visit-1"]);

    const queueUpdates = updatesFor("google_calendar_sync_queue");
    expect(queueUpdates).toHaveLength(1);
    expect(queueUpdates[0].payload).toMatchObject({ status: "succeeded" });
    expect(queueUpdates[0].filters).toContainEqual(["id", "q-1"]);

    expect(await response.json()).toMatchObject({ succeeded: 1 });
  });

  it("patches when the visit already carries an event id", async () => {
    scriptTables({
      queue: [queueRow({ operation: "update" })],
      visits: [
        visitRow({
          google_calendar_event_id: "gev-existing",
          google_calendar_id: "primary",
        }),
      ],
    });
    fetchOnceMock.mockResolvedValueOnce(
      googleResponse(200, { id: "gev-existing" })
    );

    await runRoute();

    const calls = googleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/gev-existing"
    );
  });

  it("inserts on an update row when the visit was never synced", async () => {
    scriptTables({ queue: [queueRow({ operation: "update" })] });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(200, { id: "gev-2" }));

    await runRoute();

    expect(googleCalls()[0].method).toBe("POST");
    expect(updatesFor("site_visits")[0].payload).toMatchObject({
      google_calendar_event_id: "gev-2",
    });
  });

  it("recreates the event when the patch target is gone", async () => {
    scriptTables({
      queue: [queueRow({ operation: "update" })],
      visits: [visitRow({ google_calendar_event_id: "gev-stale" })],
    });
    fetchOnceMock
      .mockResolvedValueOnce(googleResponse(404, {}))
      .mockResolvedValueOnce(googleResponse(200, { id: "gev-fresh" }));

    await runRoute();

    const calls = googleCalls();
    expect(calls.map((call) => call.method)).toEqual(["PATCH", "POST"]);
    expect(updatesFor("site_visits")[0].payload).toMatchObject({
      google_calendar_event_id: "gev-fresh",
    });
    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "succeeded",
    });
  });

  it("skips a create whose visit was cancelled before the drain", async () => {
    scriptTables({
      queue: [queueRow()],
      visits: [visitRow({ status: "cancelled" })],
    });

    const response = await runRoute();

    expect(googleCalls()).toHaveLength(0);
    expect(updatesFor("site_visits")).toHaveLength(0);
    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "skipped",
      skip_reason: "visit_not_syncable",
    });
    expect(await response.json()).toMatchObject({ skipped: 1 });
  });

  it("keeps a completed visit's event current instead of skipping it", async () => {
    scriptTables({
      queue: [queueRow({ operation: "update" })],
      visits: [
        visitRow({
          status: "completed",
          google_calendar_event_id: "gev-done",
        }),
      ],
    });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(200, { id: "gev-done" }));

    await runRoute();

    expect(googleCalls()[0].method).toBe("PATCH");
  });
});

// ─── Delete lane ─────────────────────────────────────────────────────────────

describe("delete drain", () => {
  it("removes the remote event and clears the visit's calendar fields", async () => {
    scriptTables({
      queue: [
        queueRow({
          operation: "delete",
          google_calendar_event_id: "gev-1",
          google_calendar_id: "primary",
        }),
      ],
      visits: [
        visitRow({
          status: "cancelled",
          google_calendar_event_id: "gev-1",
          google_calendar_id: "primary",
        }),
      ],
    });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(204, {}));

    const response = await runRoute();

    const calls = googleCalls();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/gev-1"
    );
    expect(updatesFor("site_visits")[0].payload).toMatchObject({
      google_calendar_event_id: null,
      google_calendar_id: null,
    });
    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "succeeded",
    });
    expect(await response.json()).toMatchObject({ succeeded: 1 });
  });

  it("counts an already-gone event as done", async () => {
    scriptTables({
      queue: [
        queueRow({ operation: "delete", google_calendar_event_id: "gev-1" }),
      ],
      visits: [visitRow({ status: "cancelled" })],
    });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(404, {}));

    await runRoute();

    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "succeeded",
    });
  });

  it("settles a delete with nothing to delete without calling Google", async () => {
    scriptTables({
      queue: [queueRow({ operation: "delete" })],
      visits: [visitRow({ status: "cancelled" })],
    });

    await runRoute();

    expect(googleCalls()).toHaveLength(0);
    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "succeeded",
    });
  });
});

// ─── Skip + revocation lanes ─────────────────────────────────────────────────

describe("skips", () => {
  it("settles rows for a mail-only grant as missing_calendar_scope", async () => {
    scriptTables({
      queue: [queueRow()],
      connections: [connectionRow({ granted_scopes: [GMAIL_SCOPE] })],
    });

    const response = await runRoute();

    expect(googleCalls()).toHaveLength(0);
    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "skipped",
      skip_reason: "missing_calendar_scope",
    });
    expect(await response.json()).toMatchObject({ skipped: 1 });
  });

  it("settles rows whose connection is no longer active", async () => {
    scriptTables({
      queue: [queueRow()],
      connections: [connectionRow({ status: "needs_reconnect" })],
    });

    await runRoute();

    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "skipped",
      skip_reason: "connection_inactive",
    });
  });

  it("settles rows whose connection vanished", async () => {
    scriptTables({ queue: [queueRow()], connections: [] });

    await runRoute();

    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "skipped",
      skip_reason: "connection_missing",
    });
  });

  it("settles an invalid_grant refresh as grant_revoked", async () => {
    scriptTables({ queue: [queueRow()] });
    const { GmailTokenRefreshError } = await import(
      "@/lib/api/services/gmail-token"
    );
    tokenMock.mockRejectedValueOnce(
      new GmailTokenRefreshError(400, JSON.stringify({ error: "invalid_grant" }))
    );

    await runRoute();

    expect(googleCalls()).toHaveLength(0);
    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "skipped",
      skip_reason: "grant_revoked",
    });
  });

  it("settles a 401 from the Calendar API as grant_revoked", async () => {
    scriptTables({ queue: [queueRow()] });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(401, {}));

    await runRoute();

    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "skipped",
      skip_reason: "grant_revoked",
    });
  });
});

// ─── Retry lane ──────────────────────────────────────────────────────────────

describe("retries", () => {
  it("backs off exponentially on a transient provider failure", async () => {
    scriptTables({ queue: [queueRow({ attempts: 1 })] });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(500, {}));

    const before = Date.now();
    const response = await runRoute();

    const update = updatesFor("google_calendar_sync_queue")[0];
    expect(update.payload).toMatchObject({ status: "pending", attempts: 2 });
    expect(typeof update.payload.last_error).toBe("string");
    const nextAttempt = Date.parse(String(update.payload.next_attempt_at));
    // Second failure → ten-minute delay.
    expect(nextAttempt - before).toBeGreaterThanOrEqual(9 * 60_000);
    expect(nextAttempt - before).toBeLessThanOrEqual(11 * 60_000);
    expect(await response.json()).toMatchObject({ retried: 1 });
  });

  it("fails a row permanently on its fifth attempt", async () => {
    scriptTables({ queue: [queueRow({ attempts: 4 })] });
    fetchOnceMock.mockResolvedValueOnce(googleResponse(500, {}));

    const response = await runRoute();

    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "failed",
      attempts: 5,
    });
    expect(await response.json()).toMatchObject({ failed: 1 });
  });

  it("retries a transient token refresh failure without burning the grant", async () => {
    scriptTables({ queue: [queueRow()] });
    const { GmailTokenRefreshError } = await import(
      "@/lib/api/services/gmail-token"
    );
    tokenMock.mockRejectedValueOnce(
      new GmailTokenRefreshError(500, "upstream boom")
    );

    await runRoute();

    expect(updatesFor("google_calendar_sync_queue")[0].payload).toMatchObject({
      status: "pending",
      attempts: 1,
    });
  });
});

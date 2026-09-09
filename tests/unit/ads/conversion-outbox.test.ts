/**
 * Conversion outbox: pure request builder + state machine with an injected
 * repository, plus the Supabase repository's query shapes against a
 * chain-recording fake client.
 */
import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  buildIngestRequests,
  createSupabaseOutboxRepository,
  formatEventTimestamp,
  MAX_ATTEMPTS,
  MAX_EVENTS_PER_REQUEST,
  nextAttemptAt,
  processOutbox,
  READY_GRACE_MINUTES,
  type CompanyIdentifiers,
  type ConversionActionRow,
  type OutboxEvent,
  type OutboxRepository,
} from "@/lib/ads/conversion-outbox";
import type { ConversionEventKind } from "@/lib/ads/conversion-actions";
import type { IngestEventsRequest, IngestEventsResponse } from "@/lib/ads/data-manager-client";

type IngestFn = (request: IngestEventsRequest, options: { validateOnly: boolean }) => Promise<IngestEventsResponse>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NOW = new Date("2026-09-08T18:00:00.000Z");
const ACCOUNTS = { operatingAccountId: "4454506598", loginAccountId: "5448339076" };
const ACTIONS: Record<ConversionEventKind, ConversionActionRow> = {
  trial_started: { kind: "trial_started", google_id: "101", resource_name: "customers/4454506598/conversionActions/101", name: "OPS · Trial started" },
  trial_activated: { kind: "trial_activated", google_id: "102", resource_name: "customers/4454506598/conversionActions/102", name: "OPS · Trial activated" },
  paid: { kind: "paid", google_id: "103", resource_name: "customers/4454506598/conversionActions/103", name: "OPS · Paid subscription" },
};

let seq = 0;
function event(over: Partial<OutboxEvent> = {}): OutboxEvent {
  seq += 1;
  const company = over.company_id ?? `company-${seq}`;
  const kind = over.kind ?? "trial_started";
  return {
    id: over.id ?? `evt-${seq}`,
    company_id: company,
    kind,
    occurred_at: "2026-09-08T17:15:30.000Z",
    value: null,
    currency: "CAD",
    transaction_id: `${kind}:${company}`,
    state: "queued",
    attempts: 0,
    created_at: "2026-09-08T17:20:00.000Z",
    ...over,
  };
}

describe("formatEventTimestamp", () => {
  it("renders RFC 3339 in America/Vancouver with the local offset", () => {
    expect(formatEventTimestamp("2026-09-08T17:15:30.000Z")).toBe("2026-09-08T10:15:30-07:00");
    expect(formatEventTimestamp("2026-01-15T17:15:30.000Z")).toBe("2026-01-15T09:15:30-08:00");
  });
  it("honours an explicit UTC zone", () => {
    expect(formatEventTimestamp("2026-09-08T17:15:30.000Z", "UTC")).toBe("2026-09-08T17:15:30+00:00");
  });
});

describe("nextAttemptAt", () => {
  it("backs off 15 minutes doubling per prior attempt", () => {
    expect(nextAttemptAt(0, NOW).toISOString()).toBe("2026-09-08T18:15:00.000Z");
    expect(nextAttemptAt(1, NOW).toISOString()).toBe("2026-09-08T18:30:00.000Z");
    expect(nextAttemptAt(2, NOW).toISOString()).toBe("2026-09-08T19:00:00.000Z");
    expect(nextAttemptAt(3, NOW).toISOString()).toBe("2026-09-08T20:00:00.000Z");
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describe("buildIngestRequests", () => {
  it("builds one ingest request per kind with the kind's destination and ≤2000 events", () => {
    const events = [
      ...Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => event({ kind: "trial_started" })),
      event({ kind: "paid", value: 1680 }),
    ];
    const identifiers = new Map<string, CompanyIdentifiers>(
      events.map((e) => [e.company_id, { gclid: `g-${e.company_id}` }])
    );
    const { requests, skipped } = buildIngestRequests(events, identifiers, ACTIONS, ACCOUNTS);
    expect(skipped).toEqual([]);
    expect(requests.map((r) => [r.kind, r.eventIds.length])).toEqual([
      ["trial_started", MAX_EVENTS_PER_REQUEST],
      ["trial_started", 1],
      ["paid", 1],
    ]);
    for (const r of requests) {
      expect(r.request.destinations).toEqual([
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "4454506598" },
          loginAccount: { accountType: "GOOGLE_ADS", accountId: "5448339076" },
          productDestinationId: ACTIONS[r.kind].google_id,
        },
      ]);
      expect(r.request.encoding).toBe("HEX");
      expect(r.request.events.length).toBe(r.eventIds.length);
    }
  });

  it("attaches click ids and hashed owner email; skips events with neither identifier", () => {
    const withGclid = event({ company_id: "c-g" });
    const withGbraid = event({ company_id: "c-gb" });
    const withWbraid = event({ company_id: "c-wb" });
    const withEmail = event({ company_id: "c-e" });
    const withNothing = event({ company_id: "c-none" });
    const noAction = event({ company_id: "c-g", kind: "paid" });
    const identifiers = new Map<string, CompanyIdentifiers>([
      ["c-g", { gclid: "G1", emailSha256: sha("owner@example.com") }],
      ["c-gb", { gbraid: "GB1" }],
      ["c-wb", { wbraid: "WB1" }],
      ["c-e", { emailSha256: sha("only@example.com") }],
      ["c-none", {}],
    ]);
    const { requests, skipped } = buildIngestRequests(
      [withGclid, withGbraid, withWbraid, withEmail, withNothing, noAction],
      identifiers,
      { trial_started: ACTIONS.trial_started },
      ACCOUNTS
    );
    expect(skipped).toEqual([
      { id: withNothing.id, reason: "no_identifier" },
      { id: noAction.id, reason: "no_conversion_action" },
    ]);
    expect(requests).toHaveLength(1);
    const [e1, e2, e3, e4] = requests[0].request.events;
    expect(e1.adIdentifiers).toEqual({ gclid: "G1" });
    expect(e1.userData).toEqual({ userIdentifiers: [{ emailAddress: sha("owner@example.com") }] });
    expect(e2.adIdentifiers).toEqual({ gbraid: "GB1" });
    expect(e2.userData).toBeUndefined();
    expect(e3.adIdentifiers).toEqual({ wbraid: "WB1" });
    expect(e4.adIdentifiers).toBeUndefined();
    expect(e4.userData).toEqual({ userIdentifiers: [{ emailAddress: sha("only@example.com") }] });
  });

  it("uses transaction_id, eventSource WEB, CONSENT_GRANTED, RFC3339 with offset, and value+currency only for paid", () => {
    const started = event({ company_id: "c1", kind: "trial_started" });
    const paid = event({ company_id: "c1", kind: "paid", value: 1680, currency: "CAD" });
    const paidNoValue = event({ company_id: "c2", kind: "paid", value: null });
    const identifiers = new Map<string, CompanyIdentifiers>([
      ["c1", { gclid: "G" }],
      ["c2", { gclid: "G2" }],
    ]);
    const { requests } = buildIngestRequests([started, paid, paidNoValue], identifiers, ACTIONS, ACCOUNTS);
    const startedEvent = requests.find((r) => r.kind === "trial_started")!.request.events[0];
    expect(startedEvent).toEqual({
      transactionId: "trial_started:c1",
      eventTimestamp: "2026-09-08T10:15:30-07:00",
      eventSource: "WEB",
      adIdentifiers: { gclid: "G" },
      consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
    });
    const [paidEvent, paidNoValueEvent] = requests.find((r) => r.kind === "paid")!.request.events;
    expect(paidEvent).toMatchObject({ transactionId: "paid:c1", conversionValue: 1680, currency: "CAD" });
    expect(paidNoValueEvent).not.toHaveProperty("conversionValue");
    expect(paidNoValueEvent).not.toHaveProperty("currency");
  });
});

function fakeRepo(events: OutboxEvent[], identifiers: Map<string, CompanyIdentifiers>, opts: { failedRemaining?: number } = {}) {
  const repo: OutboxRepository = {
    selectReady: vi.fn(async () => events),
    resolveIdentifiers: vi.fn(async () => identifiers),
    loadActions: vi.fn(async () => ACTIONS),
    markSent: vi.fn(async () => {}),
    markFailure: vi.fn(async () => {}),
    markSkipped: vi.fn(async () => {}),
    countFailed: vi.fn(async () => opts.failedRemaining ?? 0),
    raiseFailureAlert: vi.fn(async () => {}),
    resolveFailureAlert: vi.fn(async () => {}),
  };
  return repo;
}

describe("processOutbox", () => {
  it("marks sent with requestId on success and resolves any open alert when nothing is failed", async () => {
    const e1 = event({ company_id: "c1" });
    const e2 = event({ company_id: "c2", kind: "paid", value: 1680 });
    const repo = fakeRepo([e1, e2], new Map([["c1", { gclid: "G1" }], ["c2", { gclid: "G2" }]]));
    let calls = 0;
    const ingest = vi.fn<IngestFn>(async () => ({ requestId: `req-${++calls}`, fieldWarnings: [] }));
    const out = await processOutbox({ validateOnly: false, now: NOW }, { repo, ingest, accounts: async () => ACCOUNTS });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest.mock.calls[0][1]).toEqual({ validateOnly: false });
    expect(repo.markSent).toHaveBeenCalledWith([e1.id], "req-1", NOW);
    expect(repo.markSent).toHaveBeenCalledWith([e2.id], "req-2", NOW);
    expect(repo.resolveFailureAlert).toHaveBeenCalledTimes(1);
    expect(repo.raiseFailureAlert).not.toHaveBeenCalled();
    expect(out).toEqual({ validateOnly: false, sent: 2, retried: 0, failed: 0, skipped: 0, requestIds: ["req-1", "req-2"], warnings: [] });
  });

  it("on failure increments attempts with backoff and marks failed after the last attempt, raising the alert", async () => {
    const fresh = event({ company_id: "c1", attempts: 0 });
    const last = event({ company_id: "c2", attempts: MAX_ATTEMPTS - 1, kind: "paid", value: 10 });
    const repo = fakeRepo([fresh, last], new Map([["c1", { gclid: "G1" }], ["c2", { gclid: "G2" }]]), { failedRemaining: 1 });
    const ingest = vi.fn<IngestFn>(async () => {
      throw Object.assign(new Error("Data Manager API error (503): upstream"), { status: 503 });
    });
    const out = await processOutbox({ validateOnly: false, now: NOW }, { repo, ingest, accounts: async () => ACCOUNTS });
    expect(repo.markFailure).toHaveBeenCalledWith(fresh.id, {
      attempts: 1,
      nextAttemptAt: new Date("2026-09-08T18:15:00.000Z"),
      lastError: "Data Manager API error (503): upstream",
      failed: false,
    });
    expect(repo.markFailure).toHaveBeenCalledWith(last.id, {
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: nextAttemptAt(MAX_ATTEMPTS - 1, NOW),
      lastError: "Data Manager API error (503): upstream",
      failed: true,
    });
    expect(repo.raiseFailureAlert).toHaveBeenCalledWith(1);
    expect(repo.resolveFailureAlert).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 0, retried: 1, failed: 1, skipped: 0 });
  });

  it("marks events without any identifier as skipped with no_identifier", async () => {
    const e = event({ company_id: "c-none" });
    const repo = fakeRepo([e], new Map([["c-none", {}]]));
    const ingest = vi.fn<IngestFn>(async () => ({ requestId: "x", fieldWarnings: [] }));
    const out = await processOutbox({ validateOnly: false, now: NOW }, { repo, ingest, accounts: async () => ACCOUNTS });
    expect(ingest).not.toHaveBeenCalled();
    expect(repo.markSkipped).toHaveBeenCalledWith(e.id, "no_identifier");
    expect(out).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("validateOnly sends with validateOnly and persists nothing", async () => {
    const e = event({ company_id: "c1" });
    const repo = fakeRepo([e], new Map([["c1", { gclid: "G1" }]]));
    const ingest = vi.fn<IngestFn>(async () => ({ requestId: "v-1", fieldWarnings: [{ field: "x" }] }));
    const out = await processOutbox({ validateOnly: true, now: NOW }, { repo, ingest, accounts: async () => ACCOUNTS });
    expect(ingest.mock.calls[0][1]).toEqual({ validateOnly: true });
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markFailure).not.toHaveBeenCalled();
    expect(repo.markSkipped).not.toHaveBeenCalled();
    expect(repo.raiseFailureAlert).not.toHaveBeenCalled();
    expect(repo.resolveFailureAlert).not.toHaveBeenCalled();
    expect(out).toEqual({ validateOnly: true, sent: 1, retried: 0, failed: 0, skipped: 0, requestIds: ["v-1"], warnings: [{ field: "x" }] });
  });

  it("re-sends the rest of a batch and retries a rejected click id as email-only, skipping it when no email exists", async () => {
    const { DataManagerApiError } = await import("@/lib/ads/data-manager-client");
    const badClickWithEmail = event({ company_id: "c-bad" });
    const badClickNoEmail = event({ company_id: "c-bad2" });
    const good = event({ company_id: "c-good" });
    const identifiers = new Map<string, CompanyIdentifiers>([
      ["c-bad", { gclid: "FAKE", emailSha256: sha("bad@example.com") }],
      ["c-bad2", { gclid: "FAKE2" }],
      ["c-good", { gclid: "REAL", emailSha256: sha("good@example.com") }],
    ]);
    const repo = fakeRepo([badClickWithEmail, badClickNoEmail, good], identifiers);
    const violation = JSON.stringify({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        details: [
          { "@type": "type.googleapis.com/google.rpc.RequestInfo", requestId: "t-1" },
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [
              { field: "events.events[0].destination_references", description: "Resource not found.", reason: "NOT_FOUND" },
              { field: "events.events[1].destination_references", description: "Resource not found.", reason: "NOT_FOUND" },
            ],
          },
        ],
      },
    });
    let calls = 0;
    const ingest = vi.fn<IngestFn>(async (request) => {
      calls += 1;
      if (request.events.some((e) => e.adIdentifiers?.gclid?.startsWith("FAKE"))) {
        throw new DataManagerApiError(400, violation);
      }
      return { requestId: `ok-${calls}`, fieldWarnings: [] };
    });
    const out = await processOutbox({ validateOnly: false, now: NOW }, { repo, ingest, accounts: async () => ACCOUNTS });

    // 1: the batch (rejected) · 2: the good event alone · 3: the bad one email-only.
    expect(ingest).toHaveBeenCalledTimes(3);
    const secondBatch = ingest.mock.calls[1][0] as { events: Array<{ transactionId: string }> };
    expect(secondBatch.events.map((e) => e.transactionId)).toEqual([good.transaction_id]);
    const emailOnly = ingest.mock.calls[2][0] as { events: Array<{ transactionId: string; adIdentifiers?: unknown; userData?: unknown }> };
    expect(emailOnly.events).toHaveLength(1);
    expect(emailOnly.events[0].transactionId).toBe(badClickWithEmail.transaction_id);
    expect(emailOnly.events[0].adIdentifiers).toBeUndefined();
    expect(emailOnly.events[0].userData).toEqual({ userIdentifiers: [{ emailAddress: sha("bad@example.com") }] });

    expect(repo.markSent).toHaveBeenCalledWith([good.id], "ok-2", NOW);
    expect(repo.markSent).toHaveBeenCalledWith([badClickWithEmail.id], "ok-3", NOW);
    expect(repo.markSkipped).toHaveBeenCalledWith(badClickNoEmail.id, "invalid_identifier");
    expect(repo.markFailure).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 2, skipped: 1, retried: 0, failed: 0, requestIds: ["ok-2", "ok-3"] });
  });

  it("does nothing when the outbox is empty", async () => {
    const repo = fakeRepo([], new Map());
    const ingest = vi.fn<IngestFn>();
    const out = await processOutbox({ validateOnly: false, now: NOW }, { repo, ingest, accounts: async () => ACCOUNTS });
    expect(ingest).not.toHaveBeenCalled();
    expect(repo.loadActions).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 0, failed: 0, skipped: 0 });
  });
});

// ─── Supabase repository query shapes ────────────────────────────────────────

interface Call { method: string; args: unknown[] }

function fakeDb(responses: Record<string, unknown[]>) {
  const calls: Record<string, Call[]> = {};
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};
  return {
    calls,
    inserted,
    updated,
    from(table: string) {
      calls[table] ??= [];
      const chain: Record<string, unknown> = {};
      const record = (method: string) => (...args: unknown[]) => {
        calls[table].push({ method, args });
        if (method === "insert") (inserted[table] ??= []).push(args[0]);
        if (method === "update") (updated[table] ??= []).push(args[0]);
        return chain;
      };
      for (const m of ["select", "eq", "lte", "gte", "in", "is", "order", "limit", "update", "insert", "maybeSingle"]) {
        chain[m] = record(m);
      }
      chain.then = (resolve: (v: unknown) => void) => {
        const data = responses[table] ?? [];
        const last = calls[table][calls[table].length - 1]?.method;
        resolve({ data: last === "maybeSingle" ? data[0] ?? null : data, error: null, count: null });
      };
      return chain;
    },
  };
}

describe("createSupabaseOutboxRepository", () => {
  it("only picks queued rows whose next_attempt_at <= now and created_at <= now - 10 minutes, oldest first", async () => {
    const db = fakeDb({ ads_conversion_events: [event()] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = createSupabaseOutboxRepository(db as any);
    const rows = await repo.selectReady(NOW, 2000);
    expect(rows).toHaveLength(1);
    const methods = db.calls.ads_conversion_events.map((c) => [c.method, ...c.args]);
    expect(methods).toEqual([
      ["select", "id, company_id, kind, occurred_at, value, currency, transaction_id, state, attempts, created_at"],
      ["eq", "state", "queued"],
      ["lte", "next_attempt_at", NOW.toISOString()],
      ["lte", "created_at", new Date(NOW.getTime() - READY_GRACE_MINUTES * 60_000).toISOString()],
      ["order", "created_at", { ascending: true }],
      ["limit", 2000],
    ]);
  });

  it("resolves the owner email (admin first, oldest first, not deleted) and click ids per company", async () => {
    const db = fakeDb({
      users: [
        { company_id: "c1", email: "Later.Admin@Gmail.com", is_company_admin: true, created_at: "2026-02-01T00:00:00Z", deleted_at: null },
        { company_id: "c1", email: "crew@example.com", is_company_admin: false, created_at: "2026-01-01T00:00:00Z", deleted_at: null },
        { company_id: "c2", email: null, is_company_admin: true, created_at: "2026-01-01T00:00:00Z", deleted_at: null },
        { company_id: "c2", email: "second@example.com", is_company_admin: false, created_at: "2026-01-02T00:00:00Z", deleted_at: null },
      ],
      trial_attributions: [
        { company_id: "c1", gclid: "G1", gbraid: null, wbraid: null },
        { company_id: "c2", gclid: null, gbraid: "GB2", wbraid: "WB2" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = createSupabaseOutboxRepository(db as any);
    const ids = await repo.resolveIdentifiers(["c1", "c2", "c3"]);
    expect(ids.get("c1")).toEqual({ gclid: "G1", gbraid: null, wbraid: null, emailSha256: sha("lateradmin@gmail.com") });
    expect(ids.get("c2")).toEqual({ gclid: null, gbraid: "GB2", wbraid: "WB2", emailSha256: sha("second@example.com") });
    expect(ids.get("c3")).toEqual({});
    const userCalls = db.calls.users.map((c) => [c.method, ...c.args]);
    expect(userCalls).toContainEqual(["in", "company_id", ["c1", "c2", "c3"]]);
    expect(userCalls).toContainEqual(["is", "deleted_at", null]);
  });

  it("raises the persistent failure alert once and resolves it by dedupe key", async () => {
    vi.stubEnv("PMF_OPERATOR_USER_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("PMF_OPERATOR_COMPANY_ID", "22222222-2222-4222-8222-222222222222");
    const db = fakeDb({ notifications: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = createSupabaseOutboxRepository(db as any);
    await repo.raiseFailureAlert(3);
    expect(db.inserted.notifications).toHaveLength(1);
    expect(db.inserted.notifications[0]).toMatchObject({
      user_id: "11111111-1111-4111-8111-111111111111",
      company_id: "22222222-2222-4222-8222-222222222222",
      type: "ads_conversion_alert",
      title: "ADS CONVERSIONS FAILING",
      persistent: true,
      dedupe_key: "ads-conversions:failed",
      action_url: "/admin/google-ads",
      action_label: "VIEW ADS",
      is_read: false,
    });
    await repo.resolveFailureAlert();
    expect(db.updated.notifications).toHaveLength(1);
    expect(db.updated.notifications[0]).toMatchObject({ resolution_reason: "outbox_drained" });
    const calls = db.calls.notifications.map((c) => [c.method, ...c.args]);
    expect(calls).toContainEqual(["eq", "dedupe_key", "ads-conversions:failed"]);
    expect(calls).toContainEqual(["is", "resolved_at", null]);
    vi.unstubAllEnvs();
  });
});

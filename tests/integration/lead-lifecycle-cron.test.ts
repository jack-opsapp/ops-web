/**
 * Integration tests for /api/cron/lead-lifecycle.
 *
 * Covers:
 *   - auth gate (401 without / with wrong secret)
 *   - non-destructive auto-exec path (create_follow_up_draft inserts a local
 *     template draft; operator_follow_up_miss inserts a deduped notification)
 *   - destructive decision → dry-run candidate only, and the guarded RPC
 *     `execute_opportunity_lifecycle_guarded_action` is NEVER called
 *   - idempotency: a second run with the open draft / unread notification
 *     already present creates 0 new rows
 *   - fragmented-opp skip: a destructive decision on an opportunity carrying a
 *     `legacy%` thread id is flagged `skipped-fragmented`, not actionable
 *
 * The Supabase client is mocked at the chain level. Each table gets a handler
 * that returns a chainable builder; terminal `insert(...).select().single()`
 * captures the inserted row so the test can assert on writes. The mock also
 * exposes `.rpc` so we can assert it is never invoked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Supabase mock ───────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn();
const supabaseRpcMock = vi.fn(async () => ({ data: null, error: null }));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: supabaseFromMock, rpc: supabaseRpcMock }),
}));

import { GET } from "@/app/api/cron/lead-lifecycle/route";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const OPERATOR_ID = "22222222-2222-2222-2222-222222222222";
const FOLLOWUP_OPP = "33333333-3333-3333-3333-333333333333";
const INBOUND_OPP = "44444444-4444-4444-4444-444444444444";
const DESTRUCTIVE_OPP = "55555555-5555-5555-5555-555555555555";
const FRAGMENTED_OPP = "66666666-6666-6666-6666-666666666666";

// 60 days ago — well past the 7-day follow-up + 30-day lost thresholds.
const LONG_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

function buildRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/lead-lifecycle"),
    { headers }
  );
}

/**
 * A recursive chainable builder. Filter methods record their (column, value)
 * pairs into `filters`. Terminal methods (`single`/`maybeSingle`/`limit`/
 * thenable) resolve to the configured result; `insert` records the payload via
 * the provided `onInsert` and returns a select/single-capable chain that
 * resolves to a synthetic id.
 */
type RecordedFilter = [string, string, unknown];

interface ChainOpts {
  selectResult?: (filters: RecordedFilter[]) => {
    data: unknown[] | null;
    error: unknown;
  };
  onInsert?: (payload: unknown) => { data: unknown; error: unknown };
  onUpdate?: (payload: unknown) => void;
}

function makeChain(opts: ChainOpts) {
  const filters: Array<[string, string, unknown]> = [];
  const chain: any = {
    filters,
    select: () => chain,
    insert: (payload: unknown) => {
      const res = opts.onInsert
        ? opts.onInsert(payload)
        : { data: { id: "generated-id" }, error: null };
      const insertChain: any = {
        select: () => insertChain,
        single: async () => res,
        maybeSingle: async () => res,
        then: (resolve: any) => resolve(res),
      };
      return insertChain;
    },
    update: (payload: unknown) => {
      opts.onUpdate?.(payload);
      const updateChain: any = {
        eq: () => updateChain,
        is: () => updateChain,
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
      return updateChain;
    },
    upsert: (payload: unknown) => {
      opts.onUpdate?.(payload);
      const upsertChain: any = {
        select: () => upsertChain,
        single: async () => ({ data: null, error: null }),
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
      return upsertChain;
    },
    eq: (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return chain;
    },
    is: (col: string, val: unknown) => {
      filters.push(["is", col, val]);
      return chain;
    },
    in: (col: string, val: unknown) => {
      filters.push(["in", col, val]);
      return chain;
    },
    like: (col: string, val: unknown) => {
      filters.push(["like", col, val]);
      return chain;
    },
    order: () => chain,
    limit: async () =>
      (opts.selectResult ?? (() => ({ data: [], error: null })))(filters),
    single: async () =>
      (opts.selectResult ?? (() => ({ data: null, error: null })))(filters),
    maybeSingle: async () =>
      (opts.selectResult ?? (() => ({ data: null, error: null })))(filters),
    then: (resolve: any) =>
      resolve(
        (opts.selectResult ?? (() => ({ data: [], error: null, count: 0 })))(filters)
      ),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

// ─── Auth gate ─────────────────────────────────────────────────────────────

describe("/api/cron/lead-lifecycle — auth", () => {
  it("returns 401 without bearer auth", async () => {
    supabaseFromMock.mockImplementation(() => makeChain({}));
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 with the wrong secret", async () => {
    supabaseFromMock.mockImplementation(() => makeChain({}));
    const res = await GET(buildRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET is unset", async () => {
    // The route refuses to run when the deploy is misconfigured (no secret) so
    // an unauthenticated caller can never reach the sweep.
    delete process.env.CRON_SECRET;
    supabaseFromMock.mockImplementation(() => makeChain({}));
    const res = await GET(buildRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });
});

// ─── Non-destructive auto-exec ───────────────────────────────────────────────

describe("/api/cron/lead-lifecycle — non-destructive auto-exec", () => {
  it("creates a template draft and a deduped operator notification", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];

    // The follow-up opp has an outbound event 60 days ago (→ create draft); the
    // inbound opp has an inbound event 60 days ago (→ operator miss notif).
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "opportunity_correspondence_events") {
        const chain = makeChain({
          selectResult: () => ({ data: [], error: null }),
        });
        // Override .in to return per-opp events; .like (fragmentation probe)
        // returns none.
        const realIn = chain.in;
        chain.in = (col: string, val: unknown) => {
          realIn(col, val);
          return chain;
        };
        chain.then = (resolve: any) => {
          const likeFilter = chain.filters.find((f: any) => f[0] === "like");
          if (likeFilter) {
            return resolve({ data: [], error: null });
          }
          const inFilter = chain.filters.find(
            (f: any) => f[0] === "in" && f[1] === "opportunity_id"
          );
          const ids = (inFilter?.[2] as string[]) ?? [];
          const events: unknown[] = [];
          if (ids.includes(FOLLOWUP_OPP)) {
            events.push({
              id: "evt-out",
              opportunity_id: FOLLOWUP_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "outbound",
              party_role: "ops",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          if (ids.includes(INBOUND_OPP)) {
            events.push({
              id: "evt-in",
              opportunity_id: INBOUND_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "inbound",
              party_role: "customer",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          return resolve({ data: events, error: null });
        };
        return chain;
      }
      switch (table) {
        case "lead_lifecycle_settings":
          // Eligibility probe (no .in filter) → return the eligible company id.
          // Settings fetch (.in company_id) → return [] so engine defaults apply
          // (autoArchiveEnabled + autoLostEnabled = true).
          return makeChain({
            selectResult: (filters) =>
              filters.some((f) => f[0] === "in" && f[1] === "company_id")
                ? { data: [], error: null }
                : { data: [{ company_id: COMPANY_ID }], error: null },
          });
        case "email_connections":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunities":
          return makeChain({
            selectResult: () => ({
              data: [
                {
                  id: FOLLOWUP_OPP,
                  company_id: COMPANY_ID,
                  title: "Roof job",
                  stage: "quoting",
                  archived_at: null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Pat",
                  updated_at: LONG_AGO,
                },
                {
                  id: INBOUND_OPP,
                  company_id: COMPANY_ID,
                  title: "Deck job",
                  stage: "qualifying",
                  archived_at: null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Sam",
                  updated_at: LONG_AGO,
                },
              ],
              error: null,
            }),
          });
        case "opportunity_lifecycle_state":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "companies":
          return makeChain({
            selectResult: () => ({
              data: [{ id: COMPANY_ID, admin_ids: [OPERATOR_ID] }],
              error: null,
            }),
          });
        case "users":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "activities":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunity_follow_up_drafts":
          return makeChain({
            selectResult: () => ({ data: [], error: null }),
            onInsert: (payload) => {
              draftInserts.push(payload);
              return { data: { id: "draft-1" }, error: null };
            },
          });
        case "notifications":
          return makeChain({
            selectResult: () => ({ data: [], error: null }),
            onInsert: (payload) => {
              notificationInserts.push(payload);
              return { data: { id: "notif-1" }, error: null };
            },
          });
        case "email_threads":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        default:
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
      }
    });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.scanned).toBe(2);
    expect(body.draftsCreated).toBe(1);
    expect(body.notificationsCreated).toBe(1);

    // The draft is a local template follow-up — no provider draft id.
    expect(draftInserts).toHaveLength(1);
    expect((draftInserts[0] as any).origin).toBe("template_follow_up");
    expect((draftInserts[0] as any).status).toBe("drafted");
    expect((draftInserts[0] as any).provider_draft_id).toBeNull();

    // The notification carries the lifecycle dedupe key.
    expect(notificationInserts).toHaveLength(1);
    expect((notificationInserts[0] as any).dedupe_key).toBe(
      `lead_lifecycle:operator_follow_up_miss:${INBOUND_OPP}`
    );
    expect((notificationInserts[0] as any).type).toBe("leads_waiting");

    // The guarded destructive RPC is never called on the non-destructive path.
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });
});

// ─── Destructive → dry-run only ─────────────────────────────────────────────

describe("/api/cron/lead-lifecycle — destructive dry-run only", () => {
  function destructiveHandlers(opts: {
    fragmented: boolean;
    draftInserts: unknown[];
  }) {
    return (table: string) => {
      if (table === "opportunity_correspondence_events") {
        const chain = makeChain({ selectResult: () => ({ data: [], error: null }) });
        chain.then = (resolve: any) => {
          const likeFilter = chain.filters.find((f: any) => f[0] === "like");
          if (likeFilter) {
            // fragmentation probe on correspondence events — none here (we use
            // the activities probe to flag fragmentation).
            return resolve({ data: [], error: null });
          }
          const inFilter = chain.filters.find(
            (f: any) => f[0] === "in" && f[1] === "opportunity_id"
          );
          const ids = (inFilter?.[2] as string[]) ?? [];
          const events: unknown[] = [];
          // An inbound meaningful event 60 days ago in a beyond-qualified stage
          // → move_to_lost_operator_no_response (destructive).
          if (ids.includes(DESTRUCTIVE_OPP)) {
            events.push({
              id: "evt-dx",
              opportunity_id: DESTRUCTIVE_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "inbound",
              party_role: "customer",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          return resolve({ data: events, error: null });
        };
        return chain;
      }
      switch (table) {
        case "lead_lifecycle_settings":
          // Eligibility probe (no .in filter) → return the eligible company id.
          // Settings fetch (.in company_id) → return [] so engine defaults apply
          // (autoArchiveEnabled + autoLostEnabled = true).
          return makeChain({
            selectResult: (filters) =>
              filters.some((f) => f[0] === "in" && f[1] === "company_id")
                ? { data: [], error: null }
                : { data: [{ company_id: COMPANY_ID }], error: null },
          });
        case "email_connections":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunities":
          return makeChain({
            selectResult: () => ({
              data: [
                {
                  id: opts.fragmented ? FRAGMENTED_OPP : DESTRUCTIVE_OPP,
                  company_id: COMPANY_ID,
                  title: "Old quote",
                  stage: "quoted",
                  archived_at: null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Lee",
                  updated_at: LONG_AGO,
                },
              ],
              error: null,
            }),
          });
        case "opportunity_lifecycle_state":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "companies":
          return makeChain({
            selectResult: () => ({
              data: [{ id: COMPANY_ID, admin_ids: [OPERATOR_ID] }],
              error: null,
            }),
          });
        case "users":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "activities":
          // fragmentation probe via activities.email_thread_id LIKE 'legacy%'
          return makeChain({
            selectResult: () =>
              opts.fragmented
                ? { data: [{ opportunity_id: FRAGMENTED_OPP }], error: null }
                : { data: [], error: null },
          });
        case "opportunity_follow_up_drafts":
          return makeChain({
            selectResult: () => ({ data: [], error: null }),
            onInsert: (payload) => {
              opts.draftInserts.push(payload);
              return { data: { id: "draft-x" }, error: null };
            },
          });
        case "notifications":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        default:
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
      }
    };
  }

  it("surfaces a destructive decision as a dry-run candidate and never calls the guarded RPC", async () => {
    const draftInserts: unknown[] = [];
    supabaseFromMock.mockImplementation(
      destructiveHandlers({ fragmented: false, draftInserts })
    );

    // The destructive opp's inbound event 60 days ago in a beyond-qualified
    // stage feeds INBOUND_OPP's logic; reuse DESTRUCTIVE_OPP id. The events
    // handler keys on DESTRUCTIVE_OPP, but the opportunities row above uses it
    // only when not fragmented — align the event id.
    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.destructiveDryRun).toBe(1);
    expect(body.destructiveSkippedFragmented).toBe(0);
    expect(body.destructiveCandidates).toHaveLength(1);
    expect(body.destructiveCandidates[0].status).toBe("dry-run");
    expect(body.destructiveCandidates[0].action).toBe(
      "move_to_lost_operator_no_response"
    );

    // No opportunity mutation, no draft, no guarded RPC.
    expect(draftInserts).toHaveLength(0);
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });

  it("flags a destructive decision on a fragmented opportunity as skipped-fragmented", async () => {
    const draftInserts: unknown[] = [];
    // Reuse the destructive event for the fragmented opp id.
    supabaseFromMock.mockImplementation((table: string) => {
      const base = destructiveHandlers({ fragmented: true, draftInserts })(table);
      if (table === "opportunity_correspondence_events") {
        base.then = (resolve: any) => {
          const likeFilter = base.filters.find((f: any) => f[0] === "like");
          if (likeFilter) return resolve({ data: [], error: null });
          const inFilter = base.filters.find(
            (f: any) => f[0] === "in" && f[1] === "opportunity_id"
          );
          const ids = (inFilter?.[2] as string[]) ?? [];
          const events: unknown[] = [];
          if (ids.includes(FRAGMENTED_OPP)) {
            events.push({
              id: "evt-frag",
              opportunity_id: FRAGMENTED_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "inbound",
              party_role: "customer",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          return resolve({ data: events, error: null });
        };
      }
      return base;
    });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.fragmentedOpportunities).toBe(1);
    expect(body.destructiveDryRun).toBe(0);
    expect(body.destructiveSkippedFragmented).toBe(1);
    expect(body.destructiveCandidates[0].status).toBe("skipped-fragmented");

    expect(draftInserts).toHaveLength(0);
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe("/api/cron/lead-lifecycle — idempotency", () => {
  it("a second run with an open draft + unread notification creates 0 new rows", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "opportunity_correspondence_events") {
        const chain = makeChain({ selectResult: () => ({ data: [], error: null }) });
        chain.then = (resolve: any) => {
          const likeFilter = chain.filters.find((f: any) => f[0] === "like");
          if (likeFilter) return resolve({ data: [], error: null });
          const inFilter = chain.filters.find(
            (f: any) => f[0] === "in" && f[1] === "opportunity_id"
          );
          const ids = (inFilter?.[2] as string[]) ?? [];
          const events: unknown[] = [];
          if (ids.includes(FOLLOWUP_OPP)) {
            events.push({
              id: "evt-out",
              opportunity_id: FOLLOWUP_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "outbound",
              party_role: "ops",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          if (ids.includes(INBOUND_OPP)) {
            events.push({
              id: "evt-in",
              opportunity_id: INBOUND_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "inbound",
              party_role: "customer",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          return resolve({ data: events, error: null });
        };
        return chain;
      }
      switch (table) {
        case "lead_lifecycle_settings":
          // Eligibility probe (no .in filter) → return the eligible company id.
          // Settings fetch (.in company_id) → return [] so engine defaults apply
          // (autoArchiveEnabled + autoLostEnabled = true).
          return makeChain({
            selectResult: (filters) =>
              filters.some((f) => f[0] === "in" && f[1] === "company_id")
                ? { data: [], error: null }
                : { data: [{ company_id: COMPANY_ID }], error: null },
          });
        case "email_connections":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunities":
          return makeChain({
            selectResult: () => ({
              data: [
                {
                  id: FOLLOWUP_OPP,
                  company_id: COMPANY_ID,
                  title: "Roof job",
                  stage: "quoting",
                  archived_at: null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Pat",
                  updated_at: LONG_AGO,
                },
                {
                  id: INBOUND_OPP,
                  company_id: COMPANY_ID,
                  title: "Deck job",
                  stage: "qualifying",
                  archived_at: null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Sam",
                  updated_at: LONG_AGO,
                },
              ],
              error: null,
            }),
          });
        case "opportunity_lifecycle_state":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "companies":
          return makeChain({
            selectResult: () => ({
              data: [{ id: COMPANY_ID, admin_ids: [OPERATOR_ID] }],
              error: null,
            }),
          });
        case "users":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "activities":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunity_follow_up_drafts":
          // Idempotent state: an open template draft ALREADY exists →
          // findOpenTemplateDraft returns a row → no insert.
          return makeChain({
            selectResult: () => ({ data: [{ id: "existing-draft" }], error: null }),
            onInsert: (payload) => {
              draftInserts.push(payload);
              return { data: { id: "should-not-happen" }, error: null };
            },
          });
        case "notifications":
          // Idempotent state: an unread, unresolved operator-miss notification
          // ALREADY exists → findExistingOperatorMissNotification returns a row
          // → no insert.
          return makeChain({
            selectResult: () => ({ data: [{ id: "existing-notif" }], error: null }),
            onInsert: (payload) => {
              notificationInserts.push(payload);
              return { data: { id: "should-not-happen" }, error: null };
            },
          });
        case "email_threads":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        default:
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
      }
    });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.scanned).toBe(2);
    // Zero new rows created — both skipped as already-existing.
    expect(body.draftsCreated).toBe(0);
    expect(body.notificationsCreated).toBe(0);
    expect(body.draftsSkippedExisting).toBe(1);
    expect(body.notificationsSkippedExisting).toBe(1);
    expect(draftInserts).toHaveLength(0);
    expect(notificationInserts).toHaveLength(0);
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });

  it("two consecutive runs on an inbound-latest opp WITH an open template draft produce exactly one notification insert (supersede must not resolve the same-pass operator-miss)", async () => {
    // ── Regression for the duplicate-operator-miss-notification blocker ──
    //
    // The opp's latest meaningful event is INBOUND and it ALSO has a pre-existing
    // open template_follow_up draft. That combination is exactly the dangerous
    // overlap: `operator_follow_up_miss` fires (operator owes the reply) AND the
    // inbound-supersede gate (supersededDrafts > 0) is satisfied (an open draft
    // exists). If the cron lets the supersede run on this pass it resolves the
    // operator-miss notification just inserted this same iteration, the dedupe
    // guard (unread + unresolved only) then misses it, and the next run inserts a
    // fresh duplicate forever.
    //
    // We drive a STATEFUL in-memory notification store across two real runs and
    // assert: total inserts == 1, and the surviving notification stays
    // unread/unresolved (the operator can actually see it).
    type Notif = {
      id: string;
      dedupe_key: string;
      is_read: boolean;
      resolved_at: string | null;
    };
    const notifStore: Notif[] = [];
    const notifInsertLog: unknown[] = [];
    let supersedeNotifUpdates = 0;
    let notifSeq = 0;

    // The opp has an OPEN template draft (drives the supersede gate) for the
    // whole test — the supersede should never actually run because the decision
    // is operator_follow_up_miss.
    const openDraftRows = [{ id: "open-draft-1" }];

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "opportunity_correspondence_events") {
        const chain = makeChain({ selectResult: () => ({ data: [], error: null }) });
        chain.then = (resolve: any) => {
          const likeFilter = chain.filters.find((f: any) => f[0] === "like");
          if (likeFilter) return resolve({ data: [], error: null });
          const inFilter = chain.filters.find(
            (f: any) => f[0] === "in" && f[1] === "opportunity_id"
          );
          const ids = (inFilter?.[2] as string[]) ?? [];
          const events: unknown[] = [];
          if (ids.includes(INBOUND_OPP)) {
            events.push({
              id: "evt-in",
              opportunity_id: INBOUND_OPP,
              connection_id: null,
              provider_thread_id: null,
              direction: "inbound",
              party_role: "customer",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: null,
            });
          }
          return resolve({ data: events, error: null });
        };
        return chain;
      }
      switch (table) {
        case "lead_lifecycle_settings":
          return makeChain({
            selectResult: (filters) =>
              filters.some((f) => f[0] === "in" && f[1] === "company_id")
                ? { data: [], error: null }
                : { data: [{ company_id: COMPANY_ID }], error: null },
          });
        case "email_connections":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunities":
          return makeChain({
            selectResult: () => ({
              data: [
                {
                  id: INBOUND_OPP,
                  company_id: COMPANY_ID,
                  title: "Deck job",
                  stage: "qualifying",
                  archived_at: null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Sam",
                  updated_at: LONG_AGO,
                },
              ],
              error: null,
            }),
          });
        case "opportunity_lifecycle_state":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "companies":
          return makeChain({
            selectResult: () => ({
              data: [{ id: COMPANY_ID, admin_ids: [OPERATOR_ID] }],
              error: null,
            }),
          });
        case "users":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "activities":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunity_follow_up_drafts":
          // An open template draft already exists (drives the supersede gate).
          // No insert path is exercised on the operator-miss decision.
          return makeChain({
            selectResult: () => ({ data: openDraftRows, error: null }),
          });
        case "notifications": {
          // Stateful store. SELECT honours the unread + unresolved filters that
          // both the dedupe guard and the supersede precondition apply. INSERT
          // appends a live (unread/unresolved) row. UPDATE (only reached by the
          // supersede) flips matching rows to read/resolved — this MUST NOT
          // happen for the same-pass notification, so we count it.
          const chain = makeChain({
            onInsert: (payload) => {
              notifInsertLog.push(payload);
              const row: Notif = {
                id: `notif-${++notifSeq}`,
                dedupe_key: (payload as any).dedupe_key,
                is_read: false,
                resolved_at: null,
              };
              notifStore.push(row);
              return { data: { id: row.id }, error: null };
            },
            onUpdate: () => {
              // Supersede resolve path. Flip every live row (matches the
              // is_read=false / resolved_at IS NULL filter) to resolved.
              supersedeNotifUpdates += 1;
              for (const n of notifStore) {
                if (!n.is_read && n.resolved_at === null) {
                  n.is_read = true;
                  n.resolved_at = new Date().toISOString();
                }
              }
            },
          });
          // Reads return only unread + unresolved rows (the guard/precondition
          // filter), matching the action-service queries. The dedupe guard
          // (`findExistingOperatorMissNotification`) terminates in `.limit(1)`;
          // the supersede precondition select is awaited directly (thenable).
          // Both must observe the live store, so override both terminals.
          const liveRows = () =>
            notifStore
              .filter((n) => !n.is_read && n.resolved_at === null)
              .map((n) => ({ id: n.id }));
          chain.then = (resolve: any) =>
            resolve({ data: liveRows(), error: null });
          chain.limit = async () => ({ data: liveRows(), error: null });
          return chain;
        }
        case "email_threads":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        default:
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
      }
    });

    // ── Run 1 ──────────────────────────────────────────────────────────────
    const res1 = await GET(buildRequest("Bearer test-secret"));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.ok).toBe(true);
    expect(body1.notificationsCreated).toBe(1);
    // The supersede must NOT have run (decision is operator_follow_up_miss).
    expect(body1.draftsSuperseded).toBe(0);
    expect(supersedeNotifUpdates).toBe(0);
    // The freshly-created notification is still live (operator can see it).
    expect(notifStore).toHaveLength(1);
    expect(notifStore[0].is_read).toBe(false);
    expect(notifStore[0].resolved_at).toBeNull();

    // ── Run 2 ──────────────────────────────────────────────────────────────
    const res2 = await GET(buildRequest("Bearer test-secret"));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.ok).toBe(true);
    // Dedupe guard sees the still-live notification → no second insert.
    expect(body2.notificationsCreated).toBe(0);
    expect(body2.notificationsSkippedExisting).toBe(1);
    expect(body2.draftsSuperseded).toBe(0);

    // ── Cross-run invariants ────────────────────────────────────────────────
    // Exactly one notification insert total across both runs (the blocker
    // produced one per run).
    expect(notifInsertLog).toHaveLength(1);
    expect(notifStore).toHaveLength(1);
    // The supersede never resolved the operator-miss notification.
    expect(supersedeNotifUpdates).toBe(0);
    expect(notifStore[0].resolved_at).toBeNull();
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });
});

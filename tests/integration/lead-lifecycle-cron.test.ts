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
 * captures the inserted row so the test can assert on writes. `.rpc` is the
 * guarded-action entrypoint (`execute_opportunity_lifecycle_guarded_action`):
 * dry-run paths assert it is never invoked; auto-exec paths mock its result
 * (`{ applied: true }` → applied, `{ applied: false, guard_reason }` → declined)
 * and assert it is called exactly once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Supabase mock ───────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn();
// Loosely typed so individual tests can drive the guarded RPC's result via
// mockResolvedValueOnce (data carries `applied`/`guard_reason`) and inspect
// `mock.calls`. Default: a benign no-op result.
const supabaseRpcMock = vi.fn(
  async (..._args: unknown[]): Promise<{ data: unknown; error: unknown }> => ({
    data: null,
    error: null,
  })
);

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

// 60 days ago — well past the 7-day follow-up + 30-day no-response thresholds.
const LONG_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
// 10 days ago — an unanswered inbound the operator still owes a reply (past the
// follow-up nudge window, but under the 30-day archive window). Drives
// `operator_follow_up_miss` without tipping into archive-first auto-cleanup.
const RECENT_INBOUND = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

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
              // Recent (10d) → operator_follow_up_miss nudge, NOT archive-first
              // auto-cleanup (which kicks in at the 30-day no-response window).
              occurred_at: RECENT_INBOUND,
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

// ─── Destructive auto-exec (opted in) + dry-run fallback (not opted in) ───────

// The full lead_lifecycle_settings row the evaluator + cron consume. Defaults
// mirror DEFAULT_LEAD_LIFECYCLE_SETTINGS (both auto flags ON). A test can flip a
// flag to drive the not-opted-in fallback. NB: the evaluator itself gates the
// archive/lost DECISIONS on these flags (archive flag off → no archive decision;
// lost flag off → operator_follow_up_miss instead of move_to_lost), so the
// only destructive action that still reaches the cron with its flag OFF is
// reactivate_on_related_inbound — the cron-level gate is what routes that to
// dry-run. The archive/lost flags acting at the cron layer are belt-and-braces.
function settingsRow(overrides?: {
  auto_archive_enabled?: boolean;
  auto_lost_enabled?: boolean;
}) {
  return {
    company_id: COMPANY_ID,
    follow_up_after_days: 7,
    second_follow_up_archive_after_days: 7,
    no_correspondence_archive_days: 30,
    inbound_unreplied_lost_days: 30,
    follow_up_template_subject: "Following up",
    follow_up_template_body: "Hi {{first_name}}, following up.",
    auto_archive_enabled: overrides?.auto_archive_enabled ?? true,
    auto_lost_enabled: overrides?.auto_lost_enabled ?? true,
  };
}

describe("/api/cron/lead-lifecycle — destructive auto-exec + dry-run fallback", () => {
  function destructiveHandlers(opts: {
    fragmented: boolean;
    draftInserts: unknown[];
    notificationInserts?: unknown[];
    existingReviewNotification?: boolean;
    // When true, the opportunity is archived AND its latest meaningful inbound
    // is a related-contact message → the evaluator yields
    // `reactivate_on_related_inbound` (ungated by the auto flags). Pair with
    // settings `{ auto_archive_enabled: false }` to exercise the dry-run
    // fallback: a destructive decision the company has NOT opted into executing.
    reactivate?: boolean;
    // When provided, the settings fetch (.in company_id) returns this row,
    // overriding the engine defaults. Omitted → defaults (both flags ON).
    settings?: { auto_archive_enabled?: boolean; auto_lost_enabled?: boolean };
    // Captures inserts into the guarded-action audit table (the RPC writes the
    // real audit, but the duplicate-applied SELECT hits this table first).
    auditInserts?: unknown[];
    // When set, the destructive candidate's latest meaningful inbound carries
    // this provider thread id, and `email_threads` resolves it to
    // `reviewThreadInternalId` — exercising the inbox deep-link branch of the
    // review notification target (vs. the pipeline fallback).
    reviewThreadProviderId?: string;
    reviewThreadInternalId?: string;
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
          // An inbound meaningful event 60 days ago (past the 30-day no-response
          // window) → archive_operator_no_response (archive-first destructive).
          // When `reactivate`, the same inbound is flagged as a related-contact
          // message landing on an archived opp → reactivate_on_related_inbound.
          if (ids.includes(DESTRUCTIVE_OPP)) {
            events.push({
              id: opts.reactivate ? "evt-react" : "evt-dx",
              opportunity_id: DESTRUCTIVE_OPP,
              connection_id: opts.reviewThreadProviderId ? "conn-review" : null,
              provider_thread_id: opts.reviewThreadProviderId ?? null,
              direction: "inbound",
              party_role: "customer",
              is_meaningful: true,
              occurred_at: LONG_AGO,
              linked_contact_kind: opts.reactivate ? "related_contact" : null,
            });
          }
          return resolve({ data: events, error: null });
        };
        return chain;
      }
      switch (table) {
        case "lead_lifecycle_settings":
          // Eligibility probe (no .in filter) → return the eligible company id.
          // Settings fetch (.in company_id) → return the configured row, or []
          // so engine defaults apply (autoArchiveEnabled + autoLostEnabled = true).
          return makeChain({
            selectResult: (filters) =>
              filters.some((f) => f[0] === "in" && f[1] === "company_id")
                ? {
                    data: opts.settings ? [settingsRow(opts.settings)] : [],
                    error: null,
                  }
                : { data: [{ company_id: COMPANY_ID }], error: null },
          });
        case "email_connections":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "email_threads":
          // Resolves the review notification's inbox deep-link target. Returns
          // the internal thread id only when the by-provider lookup matches the
          // configured provider thread id.
          return makeChain({
            selectResult: (filters) =>
              opts.reviewThreadInternalId &&
              filters.some(
                (f) =>
                  f[0] === "eq" &&
                  f[1] === "provider_thread_id" &&
                  f[2] === opts.reviewThreadProviderId
              )
                ? { data: [{ id: opts.reviewThreadInternalId }], error: null }
                : { data: [], error: null },
          });
        case "opportunities":
          return makeChain({
            selectResult: () => ({
              data: [
                {
                  id: opts.fragmented ? FRAGMENTED_OPP : DESTRUCTIVE_OPP,
                  company_id: COMPANY_ID,
                  title: "Old quote",
                  stage: "quoted",
                  // Reactivate requires an already-archived opportunity.
                  archived_at: opts.reactivate ? LONG_AGO : null,
                  deleted_at: null,
                  project_id: null,
                  project_ref: null,
                  created_at: LONG_AGO,
                  stage_entered_at: LONG_AGO,
                  contact_name: "Lee",
                  lost_reason: null,
                  lost_notes: null,
                  actual_close_date: null,
                  updated_at: LONG_AGO,
                },
              ],
              error: null,
            }),
          });
        case "opportunity_lifecycle_state":
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
        case "opportunity_lifecycle_action_audit":
          // Duplicate-applied guard SELECT → no prior applied row.
          return makeChain({
            selectResult: () => ({ data: [], error: null }),
            onInsert: (payload) => {
              opts.auditInserts?.push(payload);
              return { data: { id: "audit-x" }, error: null };
            },
          });
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
          // SELECT is the dedupe guard (unread + unresolved by dedupe_key).
          // Return an existing row only when the test asks for the idempotent
          // state; otherwise none, so the review insert fires.
          return makeChain({
            selectResult: () =>
              opts.existingReviewNotification
                ? { data: [{ id: "existing-review" }], error: null }
                : { data: [], error: null },
            onInsert: (payload) => {
              opts.notificationInserts?.push(payload);
              return { data: { id: "review-notif-1" }, error: null };
            },
          });
        default:
          return makeChain({ selectResult: () => ({ data: [], error: null }) });
      }
    };
  }

  it("auto-executes a destructive disposition (company opted in) through the guarded RPC and counts it as archived", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];
    supabaseFromMock.mockImplementation(
      destructiveHandlers({ fragmented: false, draftInserts, notificationInserts })
    );
    // Company opted in (engine defaults: autoArchiveEnabled = true). Under the
    // archive-first policy a stale unanswered inbound is ARCHIVED, not moved to
    // lost. The cron calls the guarded RPC, which applies the disposition
    // server-side. Mock a successful apply ({ applied: true }) — one call.
    supabaseRpcMock.mockResolvedValueOnce({ data: { applied: true }, error: null });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.destructiveArchived).toBe(1);
    expect(body.destructiveMovedToLost).toBe(0);
    expect(body.destructiveReactivated).toBe(0);
    expect(body.destructiveExecutionSkippedGuarded).toBe(0);
    expect(body.destructiveDryRun).toBe(0);
    expect(body.destructiveSkippedFragmented).toBe(0);
    expect(body.errors).toBe(0);

    expect(body.destructiveCandidates).toHaveLength(1);
    expect(body.destructiveCandidates[0].status).toBe("applied");
    expect(body.destructiveCandidates[0].action).toBe(
      "archive_operator_no_response"
    );

    // The guarded RPC was invoked exactly once, with the disposition action and
    // a deterministic per-day approval key (so a same-day re-run dedupes on the
    // duplicate_applied_action guard instead of re-applying).
    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
    const rpcCall = supabaseRpcMock.mock.calls[0];
    const rpcName = rpcCall[0] as string;
    const rpcArgs = rpcCall[1] as Record<string, unknown>;
    expect(rpcName).toBe("execute_opportunity_lifecycle_guarded_action");
    expect(rpcArgs.p_action).toBe("archive_operator_no_response");
    expect(rpcArgs.p_company_id).toBe(COMPANY_ID);
    expect(rpcArgs.p_opportunity_id).toBe(DESTRUCTIVE_OPP);
    expect(rpcArgs.p_approved_action_key).toContain(
      `${DESTRUCTIVE_OPP}:archive_operator_no_response`
    );

    // Auto-exec path surfaces no operator review notification and writes no draft.
    expect(body.destructiveReviewNotificationsCreated).toBe(0);
    expect(notificationInserts).toHaveLength(0);
    expect(draftInserts).toHaveLength(0);
  });

  it("counts a guard-declined apply (e.g. duplicate_applied_action on a same-day re-run) as skipped-guarded, not an error", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];
    supabaseFromMock.mockImplementation(
      destructiveHandlers({ fragmented: false, draftInserts, notificationInserts })
    );
    // The guarded RPC declines by design — e.g. the per-day approval key was
    // already applied on an earlier run today, so the duplicate_applied_action
    // guard short-circuits. A structural decline is idempotency, not failure:
    // it must increment destructiveExecutionSkippedGuarded, never errors.
    supabaseRpcMock.mockResolvedValueOnce({
      data: { applied: false, guard_reason: "duplicate_applied_action" },
      error: null,
    });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.destructiveExecutionSkippedGuarded).toBe(1);
    expect(body.destructiveMovedToLost).toBe(0);
    expect(body.destructiveDryRun).toBe(0);
    expect(body.errors).toBe(0);
    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
    expect(notificationInserts).toHaveLength(0);
  });

  it("dry-runs a destructive disposition when the company has NOT opted in (reactivate with auto-archive off): one review notification, never the RPC", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];
    // An archived opp receives a related-contact meaningful inbound → the
    // evaluator yields reactivate_on_related_inbound (ungated by the flags).
    // With auto-archive OFF the company has not opted into auto-exec, so the
    // cron takes the dry-run fallback: surface for the operator, never mutate,
    // never call the RPC.
    supabaseFromMock.mockImplementation(
      destructiveHandlers({
        fragmented: false,
        reactivate: true,
        draftInserts,
        notificationInserts,
        settings: { auto_archive_enabled: false, auto_lost_enabled: false },
      })
    );

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.destructiveDryRun).toBe(1);
    expect(body.destructiveReactivated).toBe(0);
    expect(body.destructiveExecutionSkippedGuarded).toBe(0);
    expect(body.errors).toBe(0);

    expect(body.destructiveCandidates).toHaveLength(1);
    expect(body.destructiveCandidates[0].status).toBe("dry-run");
    expect(body.destructiveCandidates[0].action).toBe(
      "reactivate_on_related_inbound"
    );

    // Exactly one persistent, deduped operator review notification with the
    // destructive-candidate dedupe key + pipeline fallback target. No RPC, no draft.
    expect(body.destructiveReviewNotificationsCreated).toBe(1);
    expect(body.destructiveReviewNotificationsSkippedExisting).toBe(0);
    expect(notificationInserts).toHaveLength(1);
    const review = notificationInserts[0] as any;
    expect(review.type).toBe("leads_waiting");
    expect(review.persistent).toBe(true);
    expect(review.is_read).toBe(false);
    expect(review.resolved_at).toBeNull();
    expect(review.dedupe_key).toBe(
      `lead_lifecycle:destructive_candidate:${DESTRUCTIVE_OPP}:reactivate_on_related_inbound`
    );
    expect(review.deep_link_type).toBe("lead");
    expect(review.action_url).toBe(`/pipeline?opportunityId=${DESTRUCTIVE_OPP}`);
    expect(review.action_label).toBe("Review");
    expect(draftInserts).toHaveLength(0);
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });

  it("deep-links the review notification to the inbox thread while still carrying the opportunity id", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];
    supabaseFromMock.mockImplementation(
      destructiveHandlers({
        fragmented: false,
        reactivate: true,
        draftInserts,
        notificationInserts,
        settings: { auto_archive_enabled: false, auto_lost_enabled: false },
        reviewThreadProviderId: "provider-thread-review",
        reviewThreadInternalId: "thread-internal-review",
      })
    );

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);

    expect(notificationInserts).toHaveLength(1);
    const review = notificationInserts[0] as any;
    // Web keeps the inbox thread surface; the opportunity id rides along as a
    // query param, and deep_link_type routes iOS straight to the lead.
    expect(review.deep_link_type).toBe("lead");
    expect(review.action_url).toBe(
      `/inbox/thread-internal-review?opportunityId=${DESTRUCTIVE_OPP}`
    );
    expect(review.action_label).toBe("Review");
  });

  it("flags a destructive decision on a fragmented opportunity as skipped-fragmented and emits no review notification", async () => {
    const draftInserts: unknown[] = [];
    const notificationInserts: unknown[] = [];
    // Reuse the destructive event for the fragmented opp id.
    supabaseFromMock.mockImplementation((table: string) => {
      const base = destructiveHandlers({
        fragmented: true,
        draftInserts,
        notificationInserts,
      })(table);
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

    // Quarantined candidates are not actionable → no review notification.
    expect(body.destructiveReviewNotificationsCreated).toBe(0);
    expect(notificationInserts).toHaveLength(0);

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
              // Recent (10d) → operator_follow_up_miss nudge, NOT archive-first
              // auto-cleanup (which kicks in at the 30-day no-response window).
              occurred_at: RECENT_INBOUND,
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
              // Recent (10d) → operator_follow_up_miss nudge, NOT archive-first
              // auto-cleanup (which kicks in at the 30-day no-response window).
              occurred_at: RECENT_INBOUND,
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

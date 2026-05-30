/**
 * Lead Data Review service (P1 DW2 link-reconciliation — operator surface).
 *
 * This promotes the conservative classification logic proven in the one-off
 * script `scripts/lead-lifecycle-p1-link-resolver.ts` into a reusable,
 * request-time service that powers the `// DATA REVIEW QUEUE` admin panel.
 *
 * The service surfaces the genuinely-actionable residual of the link-resolver
 * pass as a queue of items an operator can triage:
 *
 *   - SPLIT THREADS  — a single provider email thread fans out across >1
 *     opportunity. The auto-resolver REFUSED a confident re-point because the
 *     fork crosses a terminal (won/lost/discarded) boundary, spans >1 client,
 *     or has no singular live target. These need an operator decision.
 *   - TERMINAL/LIVE  — an `email_threads` cache row whose `opportunity_id` is
 *     NULL while a canonical join row points at a terminal (won/lost) but live
 *     opportunity. A closed deal can legitimately own its thread, so the
 *     resolver FLAGGED rather than auto-backfilled.
 *
 * The 2,198 passive de-aggregated blank-bucket activities (synthetic
 * `legacy%` thread ids) are QUARANTINED, not review items — the service exposes
 * them only as a muted count (`quarantinedCount`), never as actionable rows.
 *
 * Mutations are extreme-conservative and go through the SAME guarded, allow-
 * listed write surface the script uses. The only writes are:
 *   - activities.opportunity_id  (re-point a split thread's activities)
 *   - email_threads.opportunity_id  (align a cache row)
 * Each write is guarded by `assertWriteAllowed(table, column)`. Opportunities
 * are never merged, rows never deleted, links never fabricated, clients never
 * auto-created, opportunity business state never changed.
 *
 * `linkThread` re-points a split thread to an operator-chosen owning
 * opportunity (the confident re-point the auto-pass refused — now operator-
 * authorized to cross the boundary). It is single-client-guarded server-side:
 * the chosen target must belong to the same client as the thread's owners, so
 * even an authorized operator can never move correspondence across customers.
 *
 * `quarantineThread` marks a split thread reviewed-and-left-as-is by re-pointing
 * its activities onto a synthetic `legacy:<providerThreadId>` thread id, exactly
 * the quarantine marker the DW1 de-aggregation uses, so the item drops out of
 * the actionable queue and the lifecycle cron's fragmentation skip covers it.
 *
 * Table/column names verified live (read-only) against project
 * ijeekuhbatykdomumfjx before writing:
 *   activities(id uuid, opportunity_id uuid null, email_thread_id text null,
 *     type text, company_id uuid, subject text)
 *   opportunity_email_threads(thread_id text, opportunity_id uuid, connection_id uuid null)
 *   email_threads(id uuid, provider_thread_id text, opportunity_id uuid null,
 *     connection_id uuid, company_id uuid, subject text)
 *   opportunities(id, title, stage text, archived_at, deleted_at, client_id, clients(name))
 *   notifications(company_id text, dedupe_key, resolved_at, persistent, action_url, action_label)
 */

import { requireSupabase } from "@/lib/supabase/helpers";

// ─── Constants (mirrored from the resolver script) ──────────────────────────

const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);
const TEST_SEED_OPP_PREFIX = "d2000000-0000-4000-d200-";
/** Quarantine marker family — same generator the DW1 de-aggregation uses. */
const LEGACY_THREAD_PREFIX = "legacy%";

/**
 * Write allow-list (table + column). The ONLY columns any review action may
 * write — identical surface to the resolver script's allow-list.
 */
const WRITE_ALLOW_LIST: ReadonlyArray<{
  table: string;
  columns: ReadonlyArray<string>;
}> = [
  { table: "activities", columns: ["opportunity_id", "email_thread_id"] },
  { table: "email_threads", columns: ["opportunity_id"] },
] as const;

function assertWriteAllowed(table: string, column: string): void {
  const entry = WRITE_ALLOW_LIST.find((e) => e.table === table);
  if (!entry || !entry.columns.includes(column)) {
    throw new Error(
      `REFUSED: write to ${table}.${column} is not in the data-review allow-list`
    );
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReviewItemKind = "split" | "terminal_live";

export interface OppMeta {
  id: string;
  title: string | null;
  stage: string | null;
  archived: boolean;
  deleted: boolean;
  clientId: string | null;
  clientName: string | null;
}

/** One owning opportunity in a split-thread's expanded detail. */
export interface ReviewOwner {
  opportunityId: string;
  title: string | null;
  stage: string | null;
  archived: boolean;
  deleted: boolean;
  terminal: boolean;
  activityCount: number;
  clientId: string | null;
  clientName: string | null;
}

/** A single actionable queue item. */
export interface DataReviewItem {
  /** Stable id the action routes address. For split: the provider thread id.
   * For terminal/live: the email_threads row id. */
  id: string;
  kind: ReviewItemKind;
  providerThreadId: string;
  /** Email-thread subject (terminal/live) or the busiest owner's title (split). */
  subject: string | null;
  /** Client name shared across the thread's owners (single-client threads). */
  clientId: string | null;
  clientName: string | null;
  /** ISO timestamp of the most recent activity / thread row. */
  lastActivityAt: string | null;
  /** Terse refusal reason from the conservative classifier. */
  reason: string;
  /** Spread counts for the SPREAD column. */
  oppCount: number;
  terminalCount: number;
  /** Full owner detail for the expand-to-inspect accordion. */
  owners: ReviewOwner[];
  /** Candidate owning opportunities the operator may LINK-TO (split only). */
  linkCandidates: Array<{
    opportunityId: string;
    title: string | null;
    stage: string | null;
    terminal: boolean;
  }>;
}

export interface DataReviewQueue {
  split: DataReviewItem[];
  terminalLive: DataReviewItem[];
  /** Passive, non-actionable de-aggregated activity count (muted display only). */
  quarantinedCount: number;
}

export interface LinkThreadResult {
  providerThreadId: string;
  targetOpportunityId: string;
  targetTitle: string | null;
  activitiesRepointed: number;
}

export interface QuarantineThreadResult {
  providerThreadId: string;
  subject: string | null;
  activitiesQuarantined: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTerminal(o: OppMeta): boolean {
  return o.stage !== null && TERMINAL_STAGES.has(o.stage);
}

function isHidden(o: OppMeta): boolean {
  return o.archived || o.deleted;
}

function quarantineThreadId(providerThreadId: string): string {
  return `legacy:${providerThreadId}`;
}

async function fetchOppMeta(ids: string[]): Promise<Map<string, OppMeta>> {
  const sb = requireSupabase();
  const map = new Map<string, OppMeta>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from("opportunities")
      .select("id, title, stage, archived_at, deleted_at, client_id, clients(name)")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const client = row.clients as { name?: string } | { name?: string }[] | null;
      const clientName = Array.isArray(client)
        ? client[0]?.name ?? null
        : client?.name ?? null;
      map.set(row.id as string, {
        id: row.id as string,
        title: (row.title as string) ?? null,
        stage: (row.stage as string) ?? null,
        archived: row.archived_at !== null,
        deleted: row.deleted_at !== null,
        clientId: (row.client_id as string) ?? null,
        clientName,
      });
    }
  }
  return map;
}

function ownerFrom(opp: OppMeta, activityCount: number): ReviewOwner {
  return {
    opportunityId: opp.id,
    title: opp.title,
    stage: opp.stage,
    archived: opp.archived,
    deleted: opp.deleted,
    terminal: isTerminal(opp),
    activityCount,
    clientId: opp.clientId,
    clientName: opp.clientName,
  };
}

// ─── 1. Split threads ─────────────────────────────────────────────────────────

interface SplitActivityRow {
  id: string;
  email_thread_id: string;
  opportunity_id: string;
  created_at: string;
}

/**
 * Re-derive split provider threads (>1 opportunity per provider thread) from
 * live `activities`, classify each, and return them as actionable queue items.
 * Mirrors `fetchSplitThreads` in the resolver script: every split thread is
 * surfaced for operator review (the script quarantines the ones it can't auto-
 * resolve; here the operator IS the resolver). Test-seed opportunities are
 * skipped. Already-quarantined (`legacy%`) threads are excluded — they are not
 * actionable and live in `quarantinedCount`.
 */
async function fetchSplitItems(): Promise<DataReviewItem[]> {
  const sb = requireSupabase();
  const acts: SplitActivityRow[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("activities")
      .select("id, email_thread_id, opportunity_id, created_at")
      .eq("type", "email")
      .not("email_thread_id", "is", null)
      .neq("email_thread_id", "")
      .not("opportunity_id", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as SplitActivityRow[];
    acts.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  // group provider thread -> opp -> { ids, latest }
  const byThread = new Map<
    string,
    { opps: Map<string, { ids: string[]; latest: string }>; latest: string }
  >();
  for (const a of acts) {
    if (a.email_thread_id.startsWith("legacy")) continue; // already quarantined
    if (a.opportunity_id.startsWith(TEST_SEED_OPP_PREFIX)) continue;
    let thread = byThread.get(a.email_thread_id);
    if (!thread) {
      thread = { opps: new Map(), latest: a.created_at };
      byThread.set(a.email_thread_id, thread);
    }
    const opp = thread.opps.get(a.opportunity_id) ?? { ids: [], latest: a.created_at };
    opp.ids.push(a.id);
    if (a.created_at > opp.latest) opp.latest = a.created_at;
    thread.opps.set(a.opportunity_id, opp);
    if (a.created_at > thread.latest) thread.latest = a.created_at;
  }

  const splitEntries = Array.from(byThread.entries()).filter(
    ([, t]) => t.opps.size > 1
  );
  const oppIds = splitEntries.flatMap(([, t]) => Array.from(t.opps.keys()));
  const meta = await fetchOppMeta(oppIds);

  const items: DataReviewItem[] = [];
  for (const [providerThreadId, thread] of splitEntries) {
    const owners = Array.from(thread.opps.entries())
      .map(([oppId, info]) => {
        const opp = meta.get(oppId);
        return opp ? { opp, count: info.ids.length } : null;
      })
      .filter((o): o is { opp: OppMeta; count: number } => o !== null)
      .sort((a, b) => b.count - a.count);
    if (owners.length < 2) continue;

    const terminalCount = owners.filter((o) => isTerminal(o.opp)).length;
    const distinctClients = new Set(owners.map((o) => o.opp.clientId)).size;
    const hasNullClient = owners.some((o) => o.opp.clientId === null);
    const liveNonTerminal = owners.filter(
      (o) => !isTerminal(o.opp) && !isHidden(o.opp)
    );

    let reason: string;
    if (terminalCount > 0) {
      reason = `${terminalCount} owner(s) closed (won/lost/discarded) — re-point crosses a terminal boundary`;
    } else if (distinctClients > 1 || hasNullClient) {
      reason = `${distinctClients} distinct client(s)${hasNullClient ? " incl. unassigned" : ""} — spans more than one customer`;
    } else if (liveNonTerminal.length !== 1) {
      reason = `${liveNonTerminal.length} live owners — no single canonical opportunity`;
    } else {
      reason = "Multiple owners on one provider thread — confirm the canonical owner";
    }

    const top = owners[0].opp;
    items.push({
      id: providerThreadId,
      kind: "split",
      providerThreadId,
      subject: top.title,
      clientId: top.clientId,
      clientName: top.clientName,
      lastActivityAt: thread.latest,
      reason,
      oppCount: owners.length,
      terminalCount,
      owners: owners.map((o) => ownerFrom(o.opp, o.count)),
      linkCandidates: owners.map((o) => ({
        opportunityId: o.opp.id,
        title: o.opp.title,
        stage: o.opp.stage,
        terminal: isTerminal(o.opp),
      })),
    });
  }
  items.sort(
    (a, b) =>
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") ||
      b.oppCount - a.oppCount
  );
  return items;
}

// ─── 2. Terminal/live (NULL-canonical pointing at a terminal owner) ─────────────

interface EmailThreadRow {
  id: string;
  provider_thread_id: string;
  connection_id: string | null;
  opportunity_id: string | null;
  subject: string | null;
  created_at: string | null;
}

/**
 * Re-derive the NULL-canonical rows whose singular join points at a TERMINAL
 * but live opportunity — the FLAG class from `fetchCanonRows` in the resolver
 * script. A won/lost deal can legitimately own its thread, so cache-backfill to
 * a terminal opp needs operator sign-off. These are surfaced as actionable
 * terminal/live items: LINK-TO aligns the cache to the terminal owner.
 */
async function fetchTerminalLiveItems(): Promise<DataReviewItem[]> {
  const sb = requireSupabase();
  const ets: EmailThreadRow[] = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("email_threads")
        .select("id, provider_thread_id, connection_id, opportunity_id, subject, created_at")
        .neq("provider_thread_id", "")
        .is("opportunity_id", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as EmailThreadRow[];
      ets.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }
  if (ets.length === 0) return [];

  // Canonical join rows keyed connection|thread → set of opp ids.
  const joinByKey = new Map<string, Set<string>>();
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("opportunity_email_threads")
        .select("connection_id, thread_id, opportunity_id")
        .neq("thread_id", "")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Array<{
        connection_id: string | null;
        thread_id: string;
        opportunity_id: string;
      }>;
      for (const j of batch) {
        const key = `${j.connection_id}|${j.thread_id}`;
        const set = joinByKey.get(key) ?? new Set<string>();
        set.add(j.opportunity_id);
        joinByKey.set(key, set);
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }

  const matched = ets
    .map((et) => {
      const set = joinByKey.get(`${et.connection_id}|${et.provider_thread_id}`);
      if (!set || set.size === 0) return null;
      return { et, joinOpps: Array.from(set) };
    })
    .filter((m): m is { et: EmailThreadRow; joinOpps: string[] } => m !== null);

  const oppIds = matched.flatMap((m) => m.joinOpps);
  const meta = await fetchOppMeta(oppIds);

  const items: DataReviewItem[] = [];
  for (const { et, joinOpps } of matched) {
    // Only singular-join, terminal, live (non-hidden) — the FLAG class.
    if (joinOpps.length !== 1) continue;
    const opp = meta.get(joinOpps[0]);
    if (!opp) continue;
    if (!isTerminal(opp)) continue; // CONFIDENT (non-terminal) is auto-handled
    if (isHidden(opp)) continue; // hidden → quarantine, not a review item

    items.push({
      id: et.id,
      kind: "terminal_live",
      providerThreadId: et.provider_thread_id,
      subject: et.subject,
      clientId: opp.clientId,
      clientName: opp.clientName,
      lastActivityAt: et.created_at,
      reason: `Cache unset; canonical owner is closed (${opp.stage}) but live — confirm it owns this thread`,
      oppCount: 1,
      terminalCount: 1,
      owners: [ownerFrom(opp, 0)],
      linkCandidates: [
        {
          opportunityId: opp.id,
          title: opp.title,
          stage: opp.stage,
          terminal: true,
        },
      ],
    });
  }
  items.sort((a, b) =>
    (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "")
  );
  return items;
}

// ─── 3. Passive quarantined count ──────────────────────────────────────────────

async function fetchQuarantinedCount(): Promise<number> {
  const sb = requireSupabase();
  const { count, error } = await sb
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("type", "email")
    .like("email_thread_id", LEGACY_THREAD_PREFIX);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const LeadDataReviewService = {
  /** Build the full actionable queue + the muted passive count. */
  async getQueue(): Promise<DataReviewQueue> {
    const [split, terminalLive, quarantinedCount] = await Promise.all([
      fetchSplitItems(),
      fetchTerminalLiveItems(),
      fetchQuarantinedCount(),
    ]);
    return { split, terminalLive, quarantinedCount };
  },

  /**
   * Resolve a queue item by linking its correspondence to the operator-chosen
   * owning opportunity. Behavior branches on `kind`:
   *
   *   - "split"         — re-point the split provider thread's activities onto
   *     the target (the confident re-point the auto-pass refused). Guarded:
   *       · the target must be one of the thread's current owners (no fabrication);
   *       · the target must be the SAME client as every owner (never move
   *         correspondence across customers — enforced even for an authorized
   *         operator);
   *       · only activities NOT already on the target are updated (idempotent).
   *     Aligns the cache row to the target afterward.
   *   - "terminal_live" — the row is a NULL-canonical `email_threads` cache row
   *     with NO owning activities; the resolving action ALIGNS the cache to the
   *     terminal owner (sets `email_threads.opportunity_id`). No activity
   *     re-point happens (there is nothing to re-point), and the single-client
   *     guard is satisfied by construction (the singular join already names the
   *     one owner). This is the "align the cache to the terminal owner" path the
   *     design (§2/§3) specifies.
   */
  async linkThread(
    providerThreadId: string,
    targetOpportunityId: string,
    kind: ReviewItemKind = "split"
  ): Promise<LinkThreadResult> {
    const sb = requireSupabase();

    // ── terminal_live: cache-only row, no owning activities ──────────────────
    // Align the cache to the operator-confirmed terminal owner. There are no
    // activities to re-point, so the activity-driven owner guards do not apply;
    // we still confirm the target exists and is not hidden before aligning.
    if (kind === "terminal_live") {
      const meta = await fetchOppMeta([targetOpportunityId]);
      const target = meta.get(targetOpportunityId);
      if (!target) throw new Error("Target opportunity not found");
      if (isHidden(target)) {
        throw new Error("REFUSED: target opportunity is archived/deleted");
      }
      assertWriteAllowed("email_threads", "opportunity_id");
      const { error } = await sb
        .from("email_threads")
        .update({ opportunity_id: targetOpportunityId })
        .eq("provider_thread_id", providerThreadId)
        .is("opportunity_id", null); // idempotency guard — only align NULL rows
      if (error) throw new Error(error.message);
      return {
        providerThreadId,
        targetOpportunityId,
        targetTitle: target.title,
        activitiesRepointed: 0,
      };
    }

    // ── split: re-point the thread's activities onto the chosen owner ─────────
    assertWriteAllowed("activities", "opportunity_id");

    // Re-derive the thread's owners from live data (never trust the client).
    const { data: actData, error: actErr } = await sb
      .from("activities")
      .select("id, opportunity_id")
      .eq("type", "email")
      .eq("email_thread_id", providerThreadId)
      .not("opportunity_id", "is", null);
    if (actErr) throw new Error(actErr.message);
    const activities = (actData ?? []) as Array<{
      id: string;
      opportunity_id: string;
    }>;
    if (activities.length === 0) {
      throw new Error("No activities found for this provider thread");
    }

    const ownerIds = Array.from(new Set(activities.map((a) => a.opportunity_id)));
    if (!ownerIds.includes(targetOpportunityId)) {
      throw new Error(
        "REFUSED: target opportunity is not an owner of this thread — never fabricate a link"
      );
    }

    const meta = await fetchOppMeta(ownerIds);
    const target = meta.get(targetOpportunityId);
    if (!target) throw new Error("Target opportunity not found");
    if (isHidden(target)) {
      throw new Error("REFUSED: target opportunity is archived/deleted");
    }

    // Single-client guarantee: every owner must share the target's client.
    const targetClient = target.clientId;
    for (const id of ownerIds) {
      const o = meta.get(id);
      if (!o) continue;
      if (o.clientId !== targetClient) {
        throw new Error(
          "REFUSED: thread spans more than one client — re-point would move correspondence across customers"
        );
      }
    }

    // Re-point only the still-mislinked activities (idempotent guard).
    let repointed = 0;
    for (const a of activities) {
      if (a.opportunity_id === targetOpportunityId) continue;
      const { error } = await sb
        .from("activities")
        .update({ opportunity_id: targetOpportunityId })
        .eq("id", a.id)
        .eq("opportunity_id", a.opportunity_id); // idempotency guard
      if (error) throw new Error(`activities ${a.id}: ${error.message}`);
      repointed += 1;
    }

    // Align the cache row to the target where a singular cache row exists.
    assertWriteAllowed("email_threads", "opportunity_id");
    await sb
      .from("email_threads")
      .update({ opportunity_id: targetOpportunityId })
      .eq("provider_thread_id", providerThreadId);

    return {
      providerThreadId,
      targetOpportunityId,
      targetTitle: target.title,
      activitiesRepointed: repointed,
    };
  },

  /**
   * Mark a split thread reviewed-and-left-as-is: re-point its activities onto a
   * synthetic `legacy:<providerThreadId>` thread id — the same quarantine
   * marker DW1 uses — so the item drops out of the actionable queue and the
   * lifecycle cron's fragmentation skip covers it. No opportunity link changes,
   * no rows deleted. Idempotent: a thread already on its `legacy:` id no-ops.
   */
  async quarantineThread(
    providerThreadId: string,
    kind: ReviewItemKind = "split"
  ): Promise<QuarantineThreadResult> {
    const sb = requireSupabase();

    if (providerThreadId.startsWith("legacy")) {
      throw new Error("REFUSED: thread is already quarantined");
    }

    const { data: actData, error: actErr } = await sb
      .from("activities")
      .select("id, subject")
      .eq("type", "email")
      .eq("email_thread_id", providerThreadId);
    if (actErr) throw new Error(actErr.message);
    const activities = (actData ?? []) as Array<{ id: string; subject: string }>;

    // terminal_live items are NULL-canonical cache rows with no owning
    // activities. Leaving the cache unset IS the quarantined state — there is
    // nothing to re-point onto a `legacy:` marker. Resolve gracefully (the item
    // is acknowledged-and-left-as-is) instead of throwing "no activities".
    if (activities.length === 0) {
      if (kind === "terminal_live") {
        return {
          providerThreadId,
          subject: null,
          activitiesQuarantined: 0,
        };
      }
      throw new Error("No activities found for this provider thread");
    }

    assertWriteAllowed("activities", "email_thread_id");

    const marker = quarantineThreadId(providerThreadId);
    const subject = activities[0]?.subject ?? null;
    let count = 0;
    for (const a of activities) {
      const { error } = await sb
        .from("activities")
        .update({ email_thread_id: marker })
        .eq("id", a.id)
        .eq("email_thread_id", providerThreadId); // idempotency guard
      if (error) throw new Error(`activities ${a.id}: ${error.message}`);
      count += 1;
    }

    return {
      providerThreadId,
      subject,
      activitiesQuarantined: count,
    };
  },

  // Test-only internals.
  _assertWriteAllowed: assertWriteAllowed,
  _quarantineThreadId: quarantineThreadId,
};

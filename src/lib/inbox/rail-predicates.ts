/**
 * OPS Web — Inbox Rail Predicates (single source of truth)
 *
 * The inbox collapsed from six tabs (everything / needs_reply / drafts /
 * commitments / scheduled / done) to **ALL + three ball-in-court rails +
 * ARCHIVED**. Snoozed and unsent drafts are now thread-row state surfaced
 * through header chips, not rails of their own.
 *
 *   ALL        — every thread the operator has access to (firehose).
 *   YOUR_MOVE  — ball in operator's court. Owes a reply, owes a commitment,
 *                Phase C is blocked, or the inbound is unread.
 *   WAITING    — ball in counterparty's court. Operator sent the last move
 *                and is waiting on the other side.
 *   ARCHIVED   — explicitly closed.
 *   SNOOZED    — internal-only; not a rail button. Fed to the header chip
 *                that lists snoozed threads, so the operator can recover
 *                them without flipping rails. Snoozed threads stay hidden
 *                from YOUR_MOVE/WAITING until `snoozed_until` passes.
 *
 * The predicate logic lives in this module so the server-side Supabase
 * filter (read path), the in-memory partition test, the caught-up state
 * logic (P3-2 consumer), and any analytics consumer share one definition.
 * Drift here is the bug Jackson called out — same words, two truths.
 */

// ─── Type union ──────────────────────────────────────────────────────────────

/**
 * Active rail filter. `ALL` / `YOUR_MOVE` / `WAITING` / `ARCHIVED` are the
 * four buttons the operator sees. `SNOOZED` is internal — the snoozed-list
 * popover queries it, but the rail nav never offers it as a selectable tab.
 */
export type RailFilter =
  | "ALL"
  | "YOUR_MOVE"
  | "WAITING"
  | "ARCHIVED"
  | "SNOOZED";

/** Rail buttons the UI renders, in display order. SNOOZED is intentionally absent. */
export const RAIL_NAV_OPTIONS: ReadonlyArray<Exclude<RailFilter, "SNOOZED">> = [
  "ALL",
  "YOUR_MOVE",
  "WAITING",
  "ARCHIVED",
] as const;

const ALL_RAILS: ReadonlyArray<RailFilter> = [
  "ALL",
  "YOUR_MOVE",
  "WAITING",
  "ARCHIVED",
  "SNOOZED",
] as const;

const RAIL_SET = new Set<string>(ALL_RAILS);

/** Type guard — accept only the known rail strings. */
export function isRailFilter(value: unknown): value is RailFilter {
  return typeof value === "string" && RAIL_SET.has(value);
}

/**
 * Tolerant parser for URL/query-string values. Returns the matched rail or
 * the supplied fallback (defaults to YOUR_MOVE — the default landing tab).
 * Recognizes the legacy six-tab strings so existing bookmarks/links degrade
 * gracefully:
 *   - everything     → ALL
 *   - needs_reply    → YOUR_MOVE
 *   - commitments    → YOUR_MOVE
 *   - drafts         → ALL  (drafts are no longer a rail; the firehose surfaces them)
 *   - scheduled      → ALL  (snooze is an action; the firehose surfaces snoozed threads)
 *   - done           → ARCHIVED
 */
export function parseRailFilter(
  raw: string | null | undefined,
  fallback: RailFilter = "YOUR_MOVE",
): RailFilter {
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (RAIL_SET.has(upper)) return upper as RailFilter;
  switch (raw) {
    case "everything":
      return "ALL";
    case "needs_reply":
    case "commitments":
      return "YOUR_MOVE";
    case "drafts":
    case "scheduled":
      return "ALL";
    case "done":
      return "ARCHIVED";
    default:
      return fallback;
  }
}

// ─── In-memory predicate (used by tests and the caught-up state logic) ──────

/**
 * Minimal thread shape the predicate cares about. Mirrors `email_threads`
 * column names so the same predicate can run in TS (in-memory) and SQL
 * (Supabase query builder) without a translation layer.
 */
export interface RailPredicateThread {
  archived_at: Date | string | null;
  snoozed_until: Date | string | null;
  has_unresolved_commitments: boolean;
  labels: ReadonlyArray<string>;
  latest_direction: "inbound" | "outbound" | null;
  unread_count: number;
  agent_blocking_question: unknown;
}

function toMillis(value: Date | string | null): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** Does this thread land in YOUR_MOVE? Pure function; ignores ALL/SNOOZED/ARCHIVED. */
export function isYourMove(thread: RailPredicateThread, now: number): boolean {
  if (toMillis(thread.archived_at) !== null) return false;
  const snoozedTs = toMillis(thread.snoozed_until);
  if (snoozedTs !== null && snoozedTs > now) return false;
  return (
    thread.has_unresolved_commitments ||
    thread.labels.includes("AWAITING_REPLY") ||
    (thread.latest_direction === "inbound" && thread.unread_count > 0) ||
    thread.agent_blocking_question != null
  );
}

/** Does this thread land in WAITING? Strict complement of YOUR_MOVE over the active pile. */
export function isWaiting(thread: RailPredicateThread, now: number): boolean {
  if (toMillis(thread.archived_at) !== null) return false;
  const snoozedTs = toMillis(thread.snoozed_until);
  if (snoozedTs !== null && snoozedTs > now) return false;
  return !isYourMove(thread, now);
}

/** Currently snoozed (future `snoozed_until`, not archived). */
export function isSnoozed(thread: RailPredicateThread, now: number): boolean {
  if (toMillis(thread.archived_at) !== null) return false;
  const snoozedTs = toMillis(thread.snoozed_until);
  return snoozedTs !== null && snoozedTs > now;
}

/** Archived (regardless of snooze state — archive wins). */
export function isArchived(thread: RailPredicateThread): boolean {
  return toMillis(thread.archived_at) !== null;
}

/** Categorise a thread into the rail it belongs in, excluding ALL. */
export function classifyRail(
  thread: RailPredicateThread,
  now: number,
): Exclude<RailFilter, "ALL"> {
  if (isArchived(thread)) return "ARCHIVED";
  if (isSnoozed(thread, now)) return "SNOOZED";
  return isYourMove(thread, now) ? "YOUR_MOVE" : "WAITING";
}

// ─── Supabase query-builder predicate (used by the read path) ───────────────

/**
 * The minimum query-builder surface our predicate touches. Declared
 * structurally so callers can pass any Supabase `from(...).select(...)`
 * chain without us reaching for the deep Supabase generic (which has
 * 4–7 type parameters that change across @supabase/postgrest-js versions
 * and would otherwise force callers to plumb a `Database` generic through
 * shared code that doesn't care about it).
 */
type RailFilterFn<Q> = (column: string, value: unknown) => Q;
type RailOrFn<Q> = (filters: string) => Q;
type RailContainsFn<Q> = (column: string, value: readonly string[]) => Q;
type RailEqFn<Q> = (column: string, value: unknown) => Q;

interface RailQueryBuilder<Q extends RailQueryBuilder<Q>> {
  is: RailFilterFn<Q>;
  not: (column: string, operator: string, value: unknown) => Q;
  or: RailOrFn<Q>;
  gt: RailFilterFn<Q>;
  contains: RailContainsFn<Q>;
  eq: RailEqFn<Q>;
}

/**
 * Apply the rail predicate to a Supabase query builder. Returns the
 * narrowed builder so the caller can chain `.order(...).limit(...)` etc.
 *
 * Implementation note: PostgREST has no native compound-boolean DSL, so
 * we build YOUR_MOVE / WAITING as one `.or(...)` string that the server
 * parses. Every term is grounded in an indexed column on `email_threads`.
 */
export function applyRailPredicate<Q extends RailQueryBuilder<Q>>(
  query: Q,
  rail: RailFilter,
  nowIso: string,
): Q {
  switch (rail) {
    case "ALL":
      return query;
    case "YOUR_MOVE":
      return query
        .is("archived_at", null)
        .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
        .or(
          `has_unresolved_commitments.eq.true,` +
            `labels.cs.{AWAITING_REPLY},` +
            `and(latest_direction.eq.inbound,unread_count.gt.0),` +
            `agent_blocking_question.not.is.null`,
        );
    case "WAITING":
      return query
        .is("archived_at", null)
        .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
        .eq("has_unresolved_commitments", false)
        .not("labels", "cs", "{AWAITING_REPLY}")
        .is("agent_blocking_question", null)
        .or(
          `latest_direction.is.null,latest_direction.eq.outbound,unread_count.eq.0`,
        );
    case "ARCHIVED":
      return query.not("archived_at", "is", null);
    case "SNOOZED":
      return query
        .is("archived_at", null)
        .not("snoozed_until", "is", null)
        .gt("snoozed_until", nowIso);
  }
}

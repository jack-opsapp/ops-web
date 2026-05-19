/**
 * OPS Web — Inbox Rail Predicates (single source of truth)
 *
 * The inbox left rail is organized by audience, not reply state:
 *
 *   CLIENTS          — client-linked, opportunity-linked, customer, and
 *                      platform-bid threads.
 *   EVERYTHING_ELSE  — non-client operational mail.
 *   ALL              — both CLIENTS and EVERYTHING_ELSE.
 *
 * Reply debt (AWAITING_REPLY / commitments / unread inbound / Phase C blocked)
 * is still computed here for row-level state, but it does not decide top-level
 * rail membership. ARCHIVED and SNOOZED remain internal utility filters used by
 * More actions and header chips, not primary rail buttons.
 *
 * The predicate logic lives in this module so the server-side Supabase
 * filter (read path), the in-memory partition test, the caught-up state
 * logic (P3-2 consumer), and any analytics consumer share one definition.
 * Drift here is the bug Jackson called out — same words, two truths.
 */

// ─── Type union ──────────────────────────────────────────────────────────────

/** Primary rail filters the operator sees, in display order. */
export type InboxPrimaryRail = "CLIENTS" | "EVERYTHING_ELSE" | "ALL";

/** Utility filters opened from secondary affordances, never rendered as primary rail buttons. */
export type InboxUtilityRail = "ARCHIVED" | "SNOOZED";

/** Active list filter. */
export type RailFilter =
  | InboxPrimaryRail
  | InboxUtilityRail;

/** Row-level thread state bucket. Not a top-level rail. */
export type ThreadStateBucket =
  | "YOUR_MOVE"
  | "WAITING"
  | "ALL"
  | "ARCHIVED"
  | "SNOOZED";

export const DEFAULT_RAIL_FILTER: InboxPrimaryRail = "CLIENTS";

/** Rail buttons the UI renders, in display order. Utility filters are intentionally absent. */
export const RAIL_NAV_OPTIONS: ReadonlyArray<InboxPrimaryRail> = [
  "CLIENTS",
  "EVERYTHING_ELSE",
  "ALL",
] as const;

const ALL_RAILS: ReadonlyArray<RailFilter> = [
  "CLIENTS",
  "EVERYTHING_ELSE",
  "ALL",
  "ARCHIVED",
  "SNOOZED",
] as const;

const RAIL_SET = new Set<string>(ALL_RAILS);

export const CLIENT_FACING_PRIMARY_CATEGORIES = [
  "CUSTOMER",
  "PLATFORM_BID",
] as const;

const CLIENT_FACING_PRIMARY_CATEGORY_SET = new Set<string>(
  CLIENT_FACING_PRIMARY_CATEGORIES,
);

/** Type guard — accept only the known rail strings. */
export function isRailFilter(value: unknown): value is RailFilter {
  return typeof value === "string" && RAIL_SET.has(value);
}

/**
 * Tolerant parser for URL/query-string values. Returns the matched rail or
 * the supplied fallback (defaults to CLIENTS — the default landing tab).
 * Recognizes legacy state rails so old bookmarks degrade to broad list views
 * instead of preserving reply/draft state as top-level IA:
 *   - everything                         → ALL
 *   - needs_reply / commitments / drafts → ALL
 *   - scheduled                          → ALL
 *   - done                               → ARCHIVED
 *   - YOUR_MOVE / WAITING                → ALL
 */
export function parseRailFilter(
  raw: string | null | undefined,
  fallback: RailFilter = DEFAULT_RAIL_FILTER,
): RailFilter {
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (RAIL_SET.has(upper)) return upper as RailFilter;
  switch (upper) {
    case "YOUR_MOVE":
    case "WAITING":
      return "ALL";
    default:
      break;
  }
  switch (raw) {
    case "everything":
      return "ALL";
    case "needs_reply":
    case "commitments":
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
  primary_category?: string | null;
  client_id?: string | null;
  opportunity_id?: string | null;
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

/** True when a thread belongs in the CLIENTS top-level bucket. */
export function isClientFacingThread(
  thread: Pick<
    RailPredicateThread,
    "primary_category" | "client_id" | "opportunity_id"
  >,
): boolean {
  if (thread.client_id) return true;
  if (thread.opportunity_id) return true;
  const category = thread.primary_category?.toUpperCase() ?? null;
  return category !== null && CLIENT_FACING_PRIMARY_CATEGORY_SET.has(category);
}

/** Classify a thread into the visible primary IA rail, excluding ALL. */
export function classifyRail(
  thread: Pick<
    RailPredicateThread,
    "primary_category" | "client_id" | "opportunity_id"
  >,
): Exclude<InboxPrimaryRail, "ALL"> {
  return isClientFacingThread(thread) ? "CLIENTS" : "EVERYTHING_ELSE";
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

/** Categorise a thread into its row-level state bucket, excluding ALL. */
export function classifyThreadState(
  thread: RailPredicateThread,
  now: number,
): Exclude<ThreadStateBucket, "ALL"> {
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
 * Implementation note: PostgREST has no native compound-boolean DSL, so the
 * CLIENTS inclusion branch and EVERYTHING_ELSE null-or-operational branch use
 * `.or(...)` strings the server parses. Every term is grounded in columns on
 * `email_threads`.
 */
export function applyRailPredicate<Q extends RailQueryBuilder<Q>>(
  query: Q,
  rail: RailFilter,
  nowIso: string,
): Q {
  switch (rail) {
    case "CLIENTS":
      return query
        .is("archived_at", null)
        .or(
          `client_id.not.is.null,` +
            `opportunity_id.not.is.null,` +
            `primary_category.in.(${CLIENT_FACING_PRIMARY_CATEGORIES.join(",")})`,
        );
    case "EVERYTHING_ELSE":
      return query
        .is("archived_at", null)
        .is("client_id", null)
        .is("opportunity_id", null)
        .or(
          `primary_category.is.null,` +
            `primary_category.not.in.(${CLIENT_FACING_PRIMARY_CATEGORIES.join(",")})`,
        );
    case "ALL":
      return query
        .is("archived_at", null);
    case "ARCHIVED":
      return query.not("archived_at", "is", null);
    case "SNOOZED":
      return query
        .is("archived_at", null)
        .not("snoozed_until", "is", null)
        .gt("snoozed_until", nowIso);
  }
}

/**
 * OPS Web — Pipeline Table data hook.
 *
 * Assembles the read-only pipeline table's rows: it fans out to the same server
 * hooks the pipeline board uses (`useOpportunities`, `useClients`,
 * `useTeamMembers`, `usePipelineStageConfigs`), builds the client- and
 * assignee-name lookups exactly as `pipeline/page.tsx` does, maps every active
 * opportunity through `mapOpportunityToTableRow`, then applies client-side
 * search + single-column sorting.
 *
 * Scope:
 *   - By default, active stages only. The `closedDeals` flag opts terminal
 *     stages (Won / Lost / Discarded) back in — when true the row set includes
 *     them so they can surface as their own groups in the grouped view. Deleted
 *     and archived opportunities are ALWAYS excluded regardless of the flag.
 *   - `totalCount` is the count of in-scope (non-deleted, non-archived, and —
 *     when `closedDeals` is false — active-stage) opportunities BEFORE the
 *     search filter, surfaced as the toolbar's single deal-count readout.
 *   - Sorting is single-column (`sorting[0]`), nulls last, string compares are
 *     case-insensitive and locale-aware. Multi-sort is intentionally not wired.
 */

import { useEffect, useMemo, useRef } from "react";
import { useClients } from "../use-clients";
import { useOpportunities } from "../use-opportunities";
import { useTeamMembers } from "../use-users";
import {
  stageConfigBySlug,
  usePipelineStageConfigs,
} from "./use-pipeline-stage-configs";
import {
  isFollowUpOverdue,
  mapOpportunityToTableRow,
} from "@/lib/utils/pipeline-table-adapter";
import { matchesAllTokens } from "@/lib/utils/search";
import {
  isActiveStage,
  matchesOpportunityAssigneeFilter,
  type OpportunityAssigneeFilter,
  type OpportunityStage,
} from "@/lib/types/pipeline";
import type {
  PipelineTableColumnId,
  PipelineTableRow,
  PipelineTableSort,
} from "@/lib/types/pipeline-table";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { getLeadAccess } from "@/lib/permissions/lead-access-policy";

/** Spec §3.4 scale ceiling — beyond this the client-side table needs windowed fetching. */
const PIPELINE_TABLE_SCALE_CEILING = 1500;

export interface UsePipelineTableDataArgs {
  search: string;
  sorting: PipelineTableSort[];
  /**
   * Include terminal-stage deals (Won / Lost / Discarded) in the row set. When
   * `false` (default) only active stages are returned; when `true` closed deals
   * are kept so they can surface — as their own stage groups in the grouped
   * view. Deleted/archived rows are always excluded either way.
   */
  closedDeals?: boolean;
  /**
   * Restrict to a single stage, or `"all"` (default) for every in-scope stage.
   * Shared with the focused board — the toolbar's stage filter now feeds both
   * surfaces (WEB OVERHAUL P6-2). Applied to the base scope, so `totalCount`
   * reflects it (the `// N deals` readout tracks the filter).
   */
  stageFilter?: OpportunityStage | "all";
  /**
   * Restrict to a single assignee (user id), or `"all"` (default). Shared with
   * the focused board; also part of the base scope (feeds `totalCount`).
   */
  assigneeFilter?: OpportunityAssigneeFilter;
}

export interface UsePipelineTableDataResult {
  rows: PipelineTableRow[];
  /** Count of in-scope rows before the search filter (the toolbar's `// N deals` readout). */
  totalCount: number;
  /**
   * The clock the rows were aged against — stable for the hook's mount. The
   * shell threads this into the table so the row-level rotting/overdue cues read
   * the exact same `now` the aging-aware default sort used (no drift between the
   * ordering and the colors).
   */
  now: Date;
  isLoading: boolean;
  isError: boolean;
}

/**
 * The sortable value for a row + column. Returns `string | number | null` so the
 * comparator can keep nulls last and compare like-with-like. Non-sortable or
 * unmapped columns return `null`.
 */
function sortValue(
  row: PipelineTableRow,
  field: PipelineTableColumnId
): string | number | null {
  switch (field) {
    case "deal":
      return row.title;
    case "stage":
      return row.stage;
    case "client":
      return row.clientName;
    case "value":
      return row.estimatedValue;
    case "age_in_stage":
      return row.ageInStageDays;
    case "last_activity":
      return row.lastActivityAt;
    case "next_follow_up":
      return row.nextFollowUpAt;
    case "expected_close":
      return row.expectedCloseDate;
    case "assignee":
      return row.assigneeName;
    case "source":
      return row.source;
    case "priority":
      return row.priority;
    case "correspondence":
      return row.correspondenceCount;
    case "select":
      return null;
    default:
      return null;
  }
}

/**
 * Compare two non-null sortable values for ascending order. String compares are
 * case-insensitive + locale-aware; numbers compare numerically. Null handling
 * is the caller's job (see {@link compareForSort}) so nulls can stay last
 * regardless of sort direction.
 */
function comparePresent(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

/**
 * Full comparator for one column + direction. Nulls always sort last (never
 * flipped by direction); present values compare via {@link comparePresent} and
 * have the direction sign applied.
 */
function compareForSort(
  a: string | number | null,
  b: string | number | null,
  direction: 1 | -1
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return comparePresent(a, b) * direction;
}

/**
 * Aging-aware default order, applied ONLY when the user has not picked a column
 * sort. Surfaces the deals most likely to be slipping, so the dying deal is at
 * the top before the operator goes looking:
 *
 *   1. Overdue follow-ups float to the top (active stages only — the adapter's
 *      `isFollowUpOverdue` already gates terminal stages, though the table feeds
 *      it active rows anyway).
 *   2. Within each group, oldest contact first — `lastActivityAt` ascending,
 *      nulls (never-contacted) last so a stale-but-touched deal outranks one with
 *      no recorded activity rather than the reverse.
 *
 * Returns a comparator closed over a fixed `now` so the order is deterministic
 * for the table's mount (and matches the row-level rotting/overdue cues, which
 * read the same clock).
 */
export function compareByAging(now: Date) {
  return (a: PipelineTableRow, b: PipelineTableRow): number => {
    const aOverdue = isFollowUpOverdue(a.nextFollowUpAt, a.stage, now);
    const bOverdue = isFollowUpOverdue(b.nextFollowUpAt, b.stage, now);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    // Oldest contact first; nulls (no activity) last.
    const aActivity = a.lastActivityAt;
    const bActivity = b.lastActivityAt;
    if (aActivity === null && bActivity === null) return 0;
    if (aActivity === null) return 1;
    if (bActivity === null) return -1;
    // ISO strings sort lexicographically in chronological order; ascending =
    // oldest first.
    return aActivity < bActivity ? -1 : aActivity > bActivity ? 1 : 0;
  };
}

export function usePipelineTableData({
  search,
  sorting,
  closedDeals = false,
  stageFilter = "all",
  assigneeFilter = "all",
}: UsePipelineTableDataArgs): UsePipelineTableDataResult {
  const {
    data: opportunities,
    isLoading: oppsLoading,
    isError: oppsError,
  } = useOpportunities();
  const {
    data: clientsData,
    isLoading: clientsLoading,
    isError: clientsError,
  } = useClients();
  const { data: teamData } = useTeamMembers();
  const {
    data: stageConfigs,
    isLoading: configsLoading,
    isError: configsError,
  } = usePipelineStageConfigs();
  const currentUserId = useAuthStore((state) => state.currentUser?.id ?? null);
  const permissionState = usePermissionStore();

  const scaleWarnedRef = useRef(false);

  // Single clock for the hook's mount: every row is aged against it, the
  // aging-aware default sort orders against it, and the shell threads it into
  // the table so the row-level cues match the ordering exactly. Empty deps =
  // captured once per mount (not re-read on every render).
  const now = useMemo(() => new Date(), []);

  // ── clientId → display name (mirrors pipeline/page.tsx) ──────────────────
  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clientsData?.clients ?? []) {
      map.set(client.id, client.name);
    }
    return map;
  }, [clientsData]);

  // ── assignee user id → "First Last" (mirrors pipeline/page.tsx teamMembers) ─
  const assigneeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of teamData?.users ?? []) {
      const name = `${user.firstName} ${user.lastName}`.trim();
      map.set(user.id, name);
    }
    return map;
  }, [teamData]);

  const stageConfigMap = useMemo(
    () => stageConfigBySlug(stageConfigs ?? []),
    [stageConfigs]
  );

  // ── In-scope, mapped rows (pre-search) ───────────────────────────────────
  // Deleted/archived are always excluded. Terminal stages (Won/Lost/Discarded)
  // are excluded unless `closedDeals` opts them in.
  const mappedRows = useMemo(() => {
    if (!opportunities) return [];
    const rows: PipelineTableRow[] = [];
    for (const opp of opportunities) {
      if (!getLeadAccess(permissionState, currentUserId, opp).canView) continue;
      if (opp.deletedAt || opp.archivedAt) continue;
      if (!closedDeals && !isActiveStage(opp.stage)) continue;
      // Shared toolbar filters (stage + assignee) narrow the base scope, exactly
      // as the focused board's `filteredOpportunities` does, so both surfaces stay
      // in lockstep and the count reflects the active filter.
      if (stageFilter !== "all" && opp.stage !== stageFilter) continue;
      if (!matchesOpportunityAssigneeFilter(opp, assigneeFilter, currentUserId))
        continue;
      rows.push(
        mapOpportunityToTableRow(opp, {
          clientNameMap,
          assigneeNameMap,
          stageConfigBySlug: stageConfigMap,
          now,
        })
      );
    }
    return rows;
  }, [
    opportunities,
    currentUserId,
    permissionState,
    closedDeals,
    stageFilter,
    assigneeFilter,
    clientNameMap,
    assigneeNameMap,
    stageConfigMap,
    now,
  ]);

  // Scale-ceiling breadcrumb (spec §3.4) — warn once per mount.
  useEffect(() => {
    if (
      mappedRows.length > PIPELINE_TABLE_SCALE_CEILING &&
      !scaleWarnedRef.current
    ) {
      scaleWarnedRef.current = true;
      console.warn(
        `[pipeline-table] ${mappedRows.length} active deals exceeds the ${PIPELINE_TABLE_SCALE_CEILING}-row client-side ceiling; windowed fetching is required at this scale.`
      );
    }
  }, [mappedRows.length]);

  // ── Search filter (token-AND over title / client / assignee / source) ────
  // Shared grammar with every other list surface (lib/utils/search): each
  // whitespace token must match at least one field, so "shera lantzmann"-style
  // multi-word queries work across fields instead of needing one contiguous
  // substring.
  const searchedRows = useMemo(() => {
    if (!search.trim()) return mappedRows;
    return mappedRows.filter((row) =>
      matchesAllTokens(
        [row.title, row.clientName, row.assigneeName, row.source]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        search
      )
    );
  }, [mappedRows, search]);

  // ── Sort ─────────────────────────────────────────────────────────────────
  // An explicit user column sort always wins. With no explicit sort, fall back
  // to the aging-aware default so the deals needing attention float to the top
  // (overdue follow-ups first, then oldest-contact). Both branches are pure +
  // memoized; the default branch is closed over the mount's `now`.
  const sortedRows = useMemo(() => {
    const primary = sorting[0];
    if (!primary) {
      return [...searchedRows].sort(compareByAging(now));
    }
    const direction: 1 | -1 = primary.direction === "desc" ? -1 : 1;
    return [...searchedRows].sort((rowA, rowB) =>
      compareForSort(
        sortValue(rowA, primary.field),
        sortValue(rowB, primary.field),
        direction
      )
    );
  }, [searchedRows, sorting, now]);

  return {
    rows: sortedRows,
    totalCount: mappedRows.length,
    now,
    isLoading: oppsLoading || clientsLoading || configsLoading,
    isError: oppsError || clientsError || configsError,
  };
}

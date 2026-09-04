"use client";

/**
 * Agent Queue — the approval desk.
 *
 * Every automation proposal lands here and nothing executes until a human
 * says so. That makes this a REGISTER, not a feed: the operator arrives with
 * dozens of proposals waiting and needs to scan, sort, and clear them — so it
 * wears the same frame as Projects, Clients, and Books (full-bleed TableShell
 * + Workbar + sticky-header RegisterTable) rather than a stack of cards that
 * fits three proposals on a laptop screen.
 *
 * One row per proposal, one click to open its detail underneath. The row-level
 * APPROVE commits the proposal as proposed; the detail's APPROVE commits your
 * edits (reassignment, redrafted email, adjusted line items) — which is why
 * both exist and only the detail one is edit-aware.
 *
 * Two views, because a review desk only ever has two states: NEEDS YOU
 * (`pending`) and HISTORY (everything already decided). Type and priority
 * filters are derived from the rows actually loaded, so a chip can never offer
 * a cut that returns nothing, and each row disappears below two distinct
 * values.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ActionDetail } from "@/components/agent/action-detail";
import { RejectDialog } from "@/components/agent/reject-dialog";
import {
  QueueFilterChips,
  type QueueFilterOption,
} from "@/components/agent/queue-filter-chips";
import {
  ACTION_TYPE_ICONS,
  PRIORITY_TAG,
  STATUS_TAG,
} from "@/components/agent/queue-row";
import { Button } from "@/components/ui/button";
import {
  RegisterEmpty,
  RegisterTable,
  Tag,
  TableMeta,
  TableMono,
  TablePrimary,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentControl } from "@/components/ui/segment-control";
import { TableShell, Workbar, WorkbarCount } from "@/components/ui/table-shell";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { HISTORY_STATUSES } from "@/lib/agent-queue/status-filter";
import {
  useApprovalQueue,
  useApproveAction,
  useBulkApprove,
  useBulkReject,
  useRejectAction,
} from "@/lib/hooks";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { interpolate } from "@/lib/i18n/interpolate";
import { getUserFullName } from "@/lib/types/models";
import { cn } from "@/lib/utils/cn";
import { ChevronDown, ChevronRight, Check } from "lucide-react";

import type {
  AgentAction,
  AgentActionPriority,
  AgentActionType,
} from "@/lib/types/approval-queue";
import type { TeamMemberOption } from "@/components/agent/action-detail";

type View = "needsYou" | "history";
type TypeFilter = "all" | AgentActionType;
type PriorityFilter = "all" | AgentActionPriority;
type SortColumn = "type" | "priority" | "confidence" | "age" | "status";
type SortState = { columnId: SortColumn; direction: "asc" | "desc" };
type Translate = (key: string) => string;

/**
 * Proposals that carry their own irreversible commit ceremony (a filed day
 * closeout, a sealed collections draft) are never swept up by a bulk approve —
 * they are approved one at a time, from their own detail.
 */
const BULK_EXCLUDED: ReadonlySet<AgentActionType> = new Set<AgentActionType>([
  "file_day_closeout",
  "approve_collections_draft",
  "approve_dispatch_confirmation_task",
]);

const HISTORY_FILTER = { statuses: [...HISTORY_STATUSES] };
const PENDING_FILTER = { status: "pending" as const };

/** Urgency order for the priority sort — the reading order of the queue. */
const PRIORITY_RANK: Record<AgentActionPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** NEEDS YOU opens on urgency; HISTORY opens on the most recent verdict. */
const DEFAULT_SORT: Record<View, SortState> = {
  needsYou: { columnId: "priority", direction: "desc" },
  history: { columnId: "age", direction: "desc" },
};

/** The moment a row is dated by: proposed (pending) or decided (history). */
function rowTime(row: AgentAction, view: View): number {
  if (view === "history") {
    return (row.reviewedAt ?? row.updatedAt ?? row.createdAt).getTime();
  }
  return row.createdAt.getTime();
}

/** Compact tactical age — "42m", "20h", "8d". Never a sentence. */
function compactAge(ms: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ─── Sub-states ───────────────────────────────────────────────────────────────

function QueueSkeleton() {
  return (
    <div className="space-y-[2px] p-3" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-[32px] animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function QueueError({
  message,
  onRetry,
  t,
}: {
  message?: string;
  onRetry: () => void;
  t: Translate;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-10">
      <span className="font-mono text-micro uppercase tracking-[0.16em] text-rose">
        <span aria-hidden className="text-text-mute">
          {"// "}
        </span>
        {t("error.title")}
      </span>
      {message && (
        <span className="font-mono text-micro text-text-3">{message}</span>
      )}
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t("error.retry")}
      </Button>
    </div>
  );
}

/**
 * Row action — the 28px compact control tier (DESIGN.md §9 workbar tier), which
 * is what a dense register row can carry. Explicit pixel sizing: the numeric
 * Tailwind spacing scale is overridden on an 8px unit here, so `h-7` would be
 * 56px, not 28.
 */
function RowAction({
  children,
  onClick,
  tone = "neutral",
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "neutral" | "quiet";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[28px] shrink-0 items-center rounded-chip border px-[10px]",
        "font-mono text-micro uppercase leading-none tracking-[0.12em]",
        "transition-colors duration-150 ease-smooth",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        tone === "neutral"
          ? "border-border bg-surface-input text-text-2 hover:border-border-medium hover:text-text"
          : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text-2"
      )}
    >
      {children}
    </button>
  );
}

/** Square 16px check box — the row-select and select-all affordance. */
function SelectBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "flex h-icon-16 w-icon-16 items-center justify-center rounded-bar border transition-colors duration-150 ease-smooth",
        checked
          ? "border-border-medium bg-text-2"
          : "border-border hover:border-border-medium"
      )}
    >
      {checked && <Check className="h-icon-16 w-icon-16 text-background" />}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentQueuePage() {
  const { t } = useDictionary("agent-queue");

  usePageTitle(t("title"));

  const [view, setView] = useState<View>("needsYou");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT.needsYou);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

  // `isPending` (no data yet) rather than `isLoading` (no data AND a fetch in
  // flight): while the permission and company stores hydrate the query is
  // merely disabled, and that must read as loading — never as an empty queue.
  const { data, isPending, isError, error, refetch } = useApprovalQueue(
    view === "needsYou" ? PENDING_FILTER : HISTORY_FILTER
  );
  const actions = useMemo<AgentAction[]>(() => data ?? [], [data]);

  const { data: teamData } = useTeamMembers();
  const teamMemberOptions: TeamMemberOption[] = useMemo(
    () =>
      (teamData?.users ?? []).map(
        (
          m: Parameters<typeof getUserFullName>[0] & {
            id: string;
            role?: string | null;
          }
        ) => ({
          id: m.id,
          name: getUserFullName(m),
          role: m.role ?? "unassigned",
        })
      ),
    [teamData?.users]
  );

  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();
  const bulkApproveMutation = useBulkApprove();
  const bulkRejectMutation = useBulkReject();

  const typeLabel = useCallback(
    (type: AgentActionType) => t(`type.${type}`),
    [t]
  );

  // ── Derived filters ─────────────────────────────────────────────────────────
  // Chips come from the rows on screen, never a hardcoded catalogue, so a
  // filter can only ever offer a cut that returns something.

  const typeOptions: QueueFilterOption<AgentActionType>[] = useMemo(() => {
    const counts = new Map<AgentActionType, number>();
    for (const a of actions) {
      counts.set(a.actionType, (counts.get(a.actionType) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => typeLabel(a[0]).localeCompare(typeLabel(b[0])))
      .map(([type, count]) => ({ id: type, label: typeLabel(type), count }));
  }, [actions, typeLabel]);

  const priorityOptions: QueueFilterOption<AgentActionPriority>[] =
    useMemo(() => {
      const counts = new Map<AgentActionPriority, number>();
      for (const a of actions) {
        counts.set(a.priority, (counts.get(a.priority) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => PRIORITY_RANK[a[0]] - PRIORITY_RANK[b[0]])
        .map(([priority, count]) => ({
          id: priority,
          label: t(`priority.${priority}`),
          count,
        }));
    }, [actions, t]);

  // A filter that matched a moment ago can vanish when the query refreshes
  // (the last row of that type got approved). Fall back to ALL rather than
  // showing an empty table behind an active chip.
  useEffect(() => {
    if (
      typeFilter !== "all" &&
      !actions.some((a) => a.actionType === typeFilter)
    ) {
      setTypeFilter("all");
    }
    if (
      priorityFilter !== "all" &&
      !actions.some((a) => a.priority === priorityFilter)
    ) {
      setPriorityFilter("all");
    }
  }, [actions, typeFilter, priorityFilter]);

  // Drop expansions whose row is gone, so a refetch can't leave a detail open
  // for a proposal that is no longer in the view.
  useEffect(() => {
    setExpandedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(actions.map((a) => a.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [actions]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = actions.filter((a) => {
      if (typeFilter !== "all" && a.actionType !== typeFilter) return false;
      if (priorityFilter !== "all" && a.priority !== priorityFilter)
        return false;
      if (!needle) return true;
      return (
        a.contextSummary.toLowerCase().includes(needle) ||
        typeLabel(a.actionType).toLowerCase().includes(needle)
      );
    });

    const dir = sort.direction === "asc" ? 1 : -1;
    const compare = (a: AgentAction, b: AgentAction): number => {
      switch (sort.columnId) {
        case "type":
          return typeLabel(a.actionType).localeCompare(typeLabel(b.actionType));
        case "priority":
          // desc = most urgent first, so the rank order is inverted against the
          // numeric convention on purpose.
          return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        case "confidence":
          return a.confidence - b.confidence;
        case "status":
          return t(`filter.${a.status}`).localeCompare(t(`filter.${b.status}`));
        case "age":
        default:
          return rowTime(a, view) - rowTime(b, view);
      }
    };

    // Ties fall back to newest-first so equal-rank rows keep a stable, useful
    // order instead of the query's arbitrary one.
    return [...filtered].sort(
      (a, b) => compare(a, b) * dir || rowTime(b, view) - rowTime(a, view)
    );
  }, [actions, search, typeFilter, priorityFilter, sort, view, typeLabel, t]);

  const bulkEligible = useMemo(
    () =>
      visible.filter(
        (a) => a.status === "pending" && !BULK_EXCLUDED.has(a.actionType)
      ),
    [visible]
  );
  const allSelected =
    bulkEligible.length > 0 && bulkEligible.every((a) => selectedIds.has(a.id));

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleViewChange = useCallback((next: View) => {
    setView(next);
    setSort(DEFAULT_SORT[next]);
    setTypeFilter("all");
    setPriorityFilter("all");
    setSelectedIds(new Set());
    setExpandedIds(new Set());
  }, []);

  const handleSortChange = useCallback((columnId: string) => {
    setSort((prev) =>
      prev.columnId === columnId
        ? {
            columnId: prev.columnId,
            direction: prev.direction === "asc" ? "desc" : "asc",
          }
        : { columnId: columnId as SortColumn, direction: "desc" }
    );
  }, []);

  const toggleExpanded = useCallback((row: AgentAction) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(
      allSelected ? new Set() : new Set(bulkEligible.map((a) => a.id))
    );
  }, [allSelected, bulkEligible]);

  const handleApprove = useCallback(
    (id: string, editedData?: Record<string, unknown>) => {
      approveMutation.mutate(
        { actionId: id, editedActionData: editedData },
        {
          onSuccess: () => {
            toast.success(t("toast.approved"));
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
          onError: () => toast.error(t("toast.error")),
        }
      );
    },
    [approveMutation, t]
  );

  const handleRejectConfirm = useCallback(
    (notes?: string) => {
      if (rejectTarget) {
        rejectMutation.mutate(
          { actionId: rejectTarget, notes },
          {
            onSuccess: () => {
              toast.success(t("toast.rejected"));
              setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(rejectTarget);
                return next;
              });
            },
            onError: () => toast.error(t("toast.error")),
          }
        );
      }
      setRejectTarget(null);
    },
    [rejectTarget, rejectMutation, t]
  );

  const handleBulkApprove = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    bulkApproveMutation.mutate(ids, {
      onSuccess: (result) => {
        toast.success(`${result.approved} ${t("toast.bulkApproved")}`);
        setSelectedIds(new Set());
      },
      onError: () => toast.error(t("toast.error")),
    });
  }, [selectedIds, bulkApproveMutation, t]);

  const handleBulkRejectConfirm = useCallback(
    (notes?: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length > 0) {
        bulkRejectMutation.mutate(
          { actionIds: ids, notes },
          {
            onSuccess: (result) => {
              toast.success(`${result.rejected} ${t("toast.bulkRejected")}`);
              setSelectedIds(new Set());
            },
            onError: () => toast.error(t("toast.error")),
          }
        );
      }
      setBulkRejectOpen(false);
    },
    [selectedIds, bulkRejectMutation, t]
  );

  // ── Columns ─────────────────────────────────────────────────────────────────

  const columns: RegisterTableColumn<AgentAction>[] = useMemo(() => {
    const cols: RegisterTableColumn<AgentAction>[] = [
      {
        id: "expand",
        header: "",
        className: "w-[28px]",
        cell: (row) => {
          const open = expandedIds.has(row.id);
          const Chevron = open ? ChevronDown : ChevronRight;
          return (
            <Chevron className="h-icon-16 w-icon-16 text-text-3" aria-hidden />
          );
        },
      },
      {
        id: "select",
        className: "w-[28px]",
        header: (
          <button
            type="button"
            onClick={handleSelectAll}
            aria-pressed={allSelected}
            aria-label={t(
              allSelected ? "action.deselectAll" : "action.selectAll"
            )}
            title={t(allSelected ? "action.deselectAll" : "action.selectAll")}
            disabled={bulkEligible.length === 0}
            className="flex items-center disabled:pointer-events-none disabled:opacity-40"
          >
            <SelectBox checked={allSelected} />
          </button>
        ),
        cell: (row) => {
          if (row.status !== "pending" || BULK_EXCLUDED.has(row.actionType)) {
            return null;
          }
          const checked = selectedIds.has(row.id);
          return (
            <button
              type="button"
              // The row owns expand/collapse; selecting must not open a detail.
              onClick={(e) => {
                e.stopPropagation();
                handleSelect(row.id);
              }}
              aria-label={t("action.selectAll")}
              aria-pressed={checked}
              className="flex items-center"
            >
              <SelectBox checked={checked} />
            </button>
          );
        },
      },
      {
        id: "type",
        header: t("column.type"),
        sortable: true,
        className: "w-[190px]",
        cell: (row) => {
          const Icon = ACTION_TYPE_ICONS[row.actionType] ?? undefined;
          return (
            <span className="flex items-center gap-2">
              {Icon && (
                <Icon className="h-icon-16 w-icon-16 shrink-0 text-text-3" />
              )}
              <TablePrimary className="max-w-[150px]">
                {typeLabel(row.actionType)}
              </TablePrimary>
            </span>
          );
        },
      },
      {
        id: "summary",
        header: t("column.proposal"),
        cell: (row) => (
          <TableMeta className="max-w-none">{row.contextSummary}</TableMeta>
        ),
      },
      {
        id: "priority",
        header: t("column.priority"),
        sortable: true,
        className: "w-[100px]",
        cell: (row) => {
          const variant = PRIORITY_TAG[row.priority];
          return variant ? (
            <Tag variant={variant}>{t(`priority.${row.priority}`)}</Tag>
          ) : (
            <TableMono>—</TableMono>
          );
        },
      },
      {
        id: "confidence",
        header: t("column.confidence"),
        sortable: true,
        align: "right",
        className: "w-[76px]",
        cell: (row) => (
          <TableMono>{Math.round(row.confidence * 100)}%</TableMono>
        ),
      },
      {
        id: "age",
        header: t("column.age"),
        sortable: true,
        align: "right",
        className: "w-[64px]",
        cell: (row) => <TableMono>{compactAge(rowTime(row, view))}</TableMono>,
      },
    ];

    if (view === "history") {
      cols.push({
        id: "status",
        header: t("column.status"),
        sortable: true,
        className: "w-[110px]",
        cell: (row) =>
          row.status === "pending" ? null : (
            <Tag variant={STATUS_TAG[row.status]}>
              {t(`filter.${row.status}`)}
            </Tag>
          ),
      });
    } else {
      cols.push({
        id: "actions",
        header: "",
        align: "right",
        className: "w-[150px]",
        cell: (row) =>
          row.status === "pending" && !BULK_EXCLUDED.has(row.actionType) ? (
            <span
              className="flex items-center justify-end gap-1"
              // Acting on a row must not also open its detail.
              onClick={(e) => e.stopPropagation()}
            >
              <RowAction onClick={() => handleApprove(row.id)}>
                {t("action.approve")}
              </RowAction>
              <RowAction tone="quiet" onClick={() => setRejectTarget(row.id)}>
                {t("action.reject")}
              </RowAction>
            </span>
          ) : null,
      });
    }

    return cols;
  }, [
    view,
    expandedIds,
    selectedIds,
    allSelected,
    bulkEligible.length,
    handleSelect,
    handleSelectAll,
    handleApprove,
    typeLabel,
    t,
  ]);

  const selectedCount = selectedIds.size;
  const showEmpty = !isPending && !isError && visible.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TableShell
        toolbar={
          // Canonical Workbar grammar: search leftmost · filters after · count
          // in meta. Row 2 carries the view segment.
          <Workbar
            search={
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search.placeholder")}
                wrapperClassName="w-[240px] max-w-full"
                aria-label={t("search.placeholder")}
              />
            }
            filters={
              <QueueFilterChips<AgentActionType, AgentActionPriority>
                typeValue={typeFilter}
                typeOptions={typeOptions}
                allTypesLabel={t("filter.allTypes")}
                onTypeChange={setTypeFilter}
                priorityValue={priorityFilter}
                priorityOptions={priorityOptions}
                allPrioritiesLabel={t("filter.allPriorities")}
                onPriorityChange={setPriorityFilter}
              />
            }
            meta={
              <WorkbarCount>
                {visible.length === 1
                  ? t("count.rowsOne")
                  : interpolate(t("count.rows"), { count: visible.length })}
              </WorkbarCount>
            }
            tabStrip={
              <SegmentControl<View>
                options={[
                  {
                    value: "needsYou",
                    label: t("segment.needsYou"),
                    count:
                      view === "needsYou" && !isPending && !isError
                        ? actions.length
                        : undefined,
                  },
                  { value: "history", label: t("segment.history") },
                ]}
                value={view}
                onChange={handleViewChange}
              />
            }
          />
        }
        isEmpty={isPending || isError || showEmpty}
        emptyState={
          isPending ? (
            <QueueSkeleton />
          ) : isError ? (
            <QueueError
              message={error instanceof Error ? error.message : undefined}
              onRetry={() => void refetch()}
              t={t}
            />
          ) : view === "needsYou" ? (
            <RegisterEmpty
              noun={t("empty.pendingNoun")}
              hint={t("empty.pendingHint")}
            />
          ) : (
            <RegisterEmpty noun={t("empty.historyNoun")} />
          )
        }
      >
        <RegisterTable
          columns={columns}
          rows={visible}
          getRowId={(r) => r.id}
          onRowClick={toggleExpanded}
          isRowActive={(r) => expandedIds.has(r.id)}
          expandedRowIds={expandedIds}
          renderExpanded={(row) => (
            <ActionDetail
              action={row}
              onApprove={handleApprove}
              onReject={(id) => setRejectTarget(id)}
              t={t}
              teamMembers={
                row.actionType === "create_task" ? teamMemberOptions : undefined
              }
            />
          )}
          sort={sort}
          onSortChange={handleSortChange}
          minWidth={900}
          ariaLabel={t("title")}
          inShell
        />
      </TableShell>

      {/* ── Batch bar — only while a selection exists ── */}
      {selectedCount > 0 && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-2">
            <span aria-hidden className="text-text-mute">
              {"["}
            </span>
            {interpolate(t("batch.selectedCount"), { count: selectedCount })}
            <span aria-hidden className="text-text-mute">
              {"]"}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              {t("batch.clear")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkRejectOpen(true)}
              disabled={bulkRejectMutation.isPending}
            >
              {interpolate(t("batch.rejectCount"), { count: selectedCount })}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleBulkApprove}
              loading={bulkApproveMutation.isPending}
            >
              {interpolate(t("batch.approveCount"), { count: selectedCount })}
            </Button>
          </div>
        </footer>
      )}

      <RejectDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleRejectConfirm}
        t={t}
      />
      <RejectDialog
        open={bulkRejectOpen}
        onClose={() => setBulkRejectOpen(false)}
        onConfirm={handleBulkRejectConfirm}
        t={t}
      />
    </div>
  );
}

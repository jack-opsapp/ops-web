"use client";

/**
 * Agent Queue — the approval desk.
 *
 * Every automation proposal lands here and nothing executes until a human
 * says so, which makes this a review surface, not a dashboard: one glass
 * panel, one workbar, one scrolling list. The TopBar already renders the
 * page title, so the panel carries no heading of its own.
 *
 * Two views, because a review desk only ever has two states — NEEDS YOU
 * (status `pending`) and HISTORY (every other status). Priority is not a
 * filter: it is low-cardinality, rare, and already legible as a tag on the
 * card. The type filter is derived from the rows actually loaded, so a chip
 * never offers a type with nothing behind it, and the row disappears
 * entirely below two distinct types.
 *
 * The batch bar lives inside the panel and only while a selection exists —
 * a canvas-fixed bar would steal viewport height at rest and float free of
 * the rows it acts on.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FilterChips, type FilterChipOption } from "@/components/ui/filter-chip";
import { RegisterEmpty } from "@/components/ui/register-table";
import { SegmentControl } from "@/components/ui/segment-control";
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

import { ActionCard, type TeamMemberOption } from "@/components/agent/action-card";
import { RejectDialog } from "@/components/agent/reject-dialog";

import type { AgentAction, AgentActionType } from "@/lib/types/approval-queue";

type View = "needsYou" | "history";
type TypeFilter = "all" | AgentActionType;
type Translate = (key: string) => string;

/**
 * Proposals that carry their own irreversible commit ceremony (a filed day
 * closeout, a sealed collections draft) are never swept up by a bulk
 * approve — they are approved one at a time, from the card.
 */
const BULK_EXCLUDED: ReadonlySet<AgentActionType> = new Set<AgentActionType>([
  "file_day_closeout",
  "approve_collections_draft",
]);

const HISTORY_FILTER = { statuses: [...HISTORY_STATUSES] };
const PENDING_FILTER = { status: "pending" as const };

// ─── Sub-states ───────────────────────────────────────────────────────────────

function QueueSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[72px] animate-pulse rounded-lg bg-fill-neutral-dim motion-reduce:animate-none"
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentQueuePage() {
  const { t } = useDictionary("agent-queue");
  const shouldReduceMotion = useReducedMotion();

  usePageTitle(t("title"));

  const [view, setView] = useState<View>("needsYou");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useApprovalQueue(
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

  // ── Derived type filter ─────────────────────────────────────────────────────
  // Chips come from the rows on screen, never a hardcoded catalogue, so the
  // filter can only ever offer a cut that returns something.

  const typeCounts = useMemo(() => {
    const counts = new Map<AgentActionType, number>();
    for (const a of actions) {
      counts.set(a.actionType, (counts.get(a.actionType) ?? 0) + 1);
    }
    return counts;
  }, [actions]);

  const typeOptions: FilterChipOption<TypeFilter>[] = useMemo(() => {
    if (typeCounts.size < 2) return [];
    return [
      { value: "all" as const, label: `${t("filter.allTypes")} ${actions.length}` },
      ...Array.from(typeCounts.entries()).map(([type, count]) => ({
        value: type,
        label: `${t(`type.${type}`)} ${count}`,
      })),
    ];
  }, [typeCounts, actions.length, t]);

  // A type that filtered fine a moment ago can vanish when the query
  // refreshes (the last row of that type got approved). Fall back to ALL
  // rather than showing an empty list behind an active chip.
  useEffect(() => {
    if (typeFilter !== "all" && !typeCounts.has(typeFilter)) {
      setTypeFilter("all");
    }
  }, [typeFilter, typeCounts]);

  const visible = useMemo(
    () =>
      typeFilter === "all"
        ? actions
        : actions.filter((a) => a.actionType === typeFilter),
    [actions, typeFilter]
  );

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
    setTypeFilter("all");
    setSelectedIds(new Set());
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

  const selectedCount = selectedIds.size;
  const showEmpty = !isLoading && !isError && visible.length === 0;
  const showList = !isLoading && !isError && visible.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="glass-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
        {/* ── Workbar ──────────────────────────────────────────────────── */}
        <header className="flex h-[44px] shrink-0 items-center justify-between gap-3 border-b border-border px-3">
          <SegmentControl<View>
            options={[
              {
                value: "needsYou",
                label: t("segment.needsYou"),
                count:
                  view === "needsYou" && !isLoading && !isError
                    ? actions.length
                    : undefined,
              },
              { value: "history", label: t("segment.history") },
            ]}
            value={view}
            onChange={handleViewChange}
          />

          <div className="flex min-w-0 items-center gap-3">
            {typeOptions.length > 0 && (
              <FilterChips<TypeFilter>
                options={typeOptions}
                value={typeFilter}
                onChange={setTypeFilter}
                className="min-w-0 flex-nowrap overflow-x-auto scrollbar-hide"
              />
            )}
            {bulkEligible.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAll}
                aria-pressed={allSelected}
                aria-label={t(
                  allSelected ? "action.deselectAll" : "action.selectAll"
                )}
                title={t(
                  allSelected ? "action.deselectAll" : "action.selectAll"
                )}
                className="flex h-[28px] w-[28px] shrink-0 items-center justify-center"
              >
                <span
                  className={cn(
                    "flex h-icon-16 w-icon-16 items-center justify-center rounded-bar border transition-colors duration-150 ease-smooth",
                    allSelected
                      ? "border-border-medium bg-text-2"
                      : "border-border hover:border-border-medium"
                  )}
                >
                  {allSelected && (
                    <Check className="h-icon-16 w-icon-16 text-background" />
                  )}
                </span>
              </button>
            )}
          </div>
        </header>

        {/* ── List — the only scroll owner ─────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {isLoading && <QueueSkeleton />}

          {isError && (
            <QueueError
              message={error instanceof Error ? error.message : undefined}
              onRetry={() => void refetch()}
              t={t}
            />
          )}

          {showEmpty &&
            (view === "needsYou" ? (
              <RegisterEmpty
                noun={t("empty.pendingNoun")}
                hint={t("empty.pendingHint")}
              />
            ) : (
              <RegisterEmpty noun={t("empty.historyNoun")} />
            ))}

          {showList && (
            <div className="space-y-2">
              <AnimatePresence mode={shouldReduceMotion ? "sync" : "popLayout"}>
                {visible.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    selected={selectedIds.has(action.id)}
                    onSelect={handleSelect}
                    onApprove={handleApprove}
                    onReject={(id) => setRejectTarget(id)}
                    t={t}
                    teamMembers={
                      action.actionType === "create_task"
                        ? teamMemberOptions
                        : undefined
                    }
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ── Batch bar — inside the panel, only while a selection exists ── */}
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
      </section>

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

"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { Filter, CheckSquare, Square, Inbox } from "lucide-react";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";

import {
  useApprovalQueue,
  useApprovalQueueStats,
  useApproveAction,
  useRejectAction,
  useBulkApprove,
  useBulkReject,
} from "@/lib/hooks";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName } from "@/lib/types/models";

import { QueueStatsRibbon } from "@/components/agent/queue-stats";
import { ActionCard, type TeamMemberOption } from "@/components/agent/action-card";
import { RejectDialog } from "@/components/agent/reject-dialog";

import type {
  AgentActionStatus,
  AgentActionType,
  AgentActionPriority,
} from "@/lib/types/approval-queue";

// ─── Filter Options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<AgentActionStatus | "all"> = [
  "all", "pending", "approved", "executed", "rejected", "expired", "failed", "cancelled",
];

const TYPE_OPTIONS: Array<AgentActionType | "all"> = [
  "all", "create_project", "create_task", "create_invoice", "send_email",
];

const PRIORITY_OPTIONS: Array<AgentActionPriority | "all"> = [
  "all", "urgent", "high", "normal", "low",
];

// ─── Filter State ─────────────────────────────────────────────────────────────

interface Filters {
  status: AgentActionStatus | undefined;
  actionType: AgentActionType | undefined;
  priority: AgentActionPriority | undefined;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentQueuePage() {
  const { t } = useDictionary("agent-queue");
  const { currentUser } = useAuthStore();
  const shouldReduceMotion = useReducedMotion();

  usePageTitle(t("title"));
  useEffect(() => trackScreenView("agent_queue"), []);

  const [filters, setFilters] = useState<Filters>({
    status: "pending",
    actionType: undefined,
    priority: undefined,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

  const { data: actions = [], isLoading } = useApprovalQueue({
    status: filters.status,
    actionType: filters.actionType,
    priority: filters.priority,
  });
  const { data: stats, isLoading: statsLoading } = useApprovalQueueStats();
  const { data: teamData } = useTeamMembers();

  // Map team members for the action card assignment picker
  const teamMemberOptions: TeamMemberOption[] = useMemo(
    () =>
      (teamData?.users ?? []).map((m) => ({
        id: m.id,
        name: getUserFullName(m),
        role: m.role ?? "unassigned",
      })),
    [teamData?.users]
  );

  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();
  const bulkApproveMutation = useBulkApprove();
  const bulkRejectMutation = useBulkReject();

  const pendingActions = useMemo(
    () => actions.filter((a) => a.status === "pending"),
    [actions]
  );

  const allSelected =
    pendingActions.length > 0 &&
    pendingActions.every((a) => selectedIds.has(a.id));

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingActions.map((a) => a.id)));
    }
  }, [allSelected, pendingActions]);

  const handleApprove = useCallback(
    (id: string, editedData?: Record<string, unknown>) => {
      approveMutation.mutate(
        { actionId: id, editedActionData: editedData },
        {
          onSuccess: () => {
            toast.success(t("toast.approved"));
            setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
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
              setSelectedIds((prev) => { const next = new Set(prev); next.delete(rejectTarget); return next; });
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
      if (ids.length === 0) return;
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
      setBulkRejectOpen(false);
    },
    [selectedIds, bulkRejectMutation, t]
  );

  // ── Filter Pill (56dp tap area via padding) ─────────────────────────────────

  const FilterPill = ({
    label,
    active,
    onClick,
  }: {
    label: string;
    active: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "min-h-[36px] px-3 rounded-[5px] font-mohave text-[12px] uppercase transition-colors whitespace-nowrap flex items-center",
        active
          ? "bg-[rgba(111, 148, 176,0.15)] text-[#6F94B0]"
          : "bg-[rgba(255,255,255,0.03)] text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.06)]"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="font-mohave text-[28px] text-text uppercase leading-tight">
          {t("title")}
        </h1>
        <p className="font-mono text-[13px] text-text-3 mt-0.5">
          [{t("subtitle")}]
        </p>
      </div>

      {/* ── Stats Ribbon ───────────────────────────────────────────────── */}
      <QueueStatsRibbon stats={stats} isLoading={statsLoading} t={t} />

      {/* ── Filter Bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1">
        <Filter className="w-[14px] h-[14px] text-text-3 shrink-0 mx-2" />

        {STATUS_OPTIONS.map((s) => (
          <FilterPill
            key={`s-${s}`}
            label={t(s === "all" ? "filter.all" : `filter.${s}`)}
            active={s === "all" ? filters.status === undefined : filters.status === s}
            onClick={() => setFilters((f) => ({ ...f, status: s === "all" ? undefined : s }))}
          />
        ))}

        <div className="w-px h-8 bg-[rgba(255,255,255,0.08)] mx-1" />

        {TYPE_OPTIONS.map((s) => (
          <FilterPill
            key={`t-${s}`}
            label={t(s === "all" ? "filter.all" : `type.${s}`)}
            active={s === "all" ? filters.actionType === undefined : filters.actionType === s}
            onClick={() => setFilters((f) => ({ ...f, actionType: s === "all" ? undefined : s }))}
          />
        ))}

        <div className="w-px h-8 bg-[rgba(255,255,255,0.08)] mx-1" />

        {PRIORITY_OPTIONS.map((s) => (
          <FilterPill
            key={`p-${s}`}
            label={t(s === "all" ? "filter.all" : `priority.${s}`)}
            active={s === "all" ? filters.priority === undefined : filters.priority === s}
            onClick={() => setFilters((f) => ({ ...f, priority: s === "all" ? undefined : s }))}
          />
        ))}
      </div>

      {/* ── Select All Toggle ──────────────────────────────────────────── */}
      {pendingActions.length > 0 && (
        <div className="flex items-center">
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 text-text-3 hover:text-text-2 transition-colors min-h-[36px] px-2"
          >
            {allSelected ? (
              <CheckSquare className="w-[16px] h-[16px]" />
            ) : (
              <Square className="w-[16px] h-[16px]" />
            )}
            <span className="font-mono text-[12px]">
              {allSelected ? t("action.deselectAll") : t("action.selectAll")}
            </span>
          </button>
        </div>
      )}

      {/* ── Action List ────────────────────────────────────────────────── */}
      <div className={cn(
        "flex-1 overflow-y-auto scrollbar-hide space-y-2",
        selectedIds.size > 0 ? "pb-[80px]" : "pb-4"
      )}>
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[72px] rounded-[8px] bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] animate-pulse"
              />
            ))}
          </div>
        )}

        {!isLoading && actions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4">
            <div className="w-[48px] h-[48px] rounded-[8px] bg-[rgba(255,255,255,0.04)] flex items-center justify-center">
              <Inbox className="w-[24px] h-[24px] text-text-mute" />
            </div>
            <div className="text-center">
              <p className="font-mohave text-body text-text-2 uppercase">
                {t("empty.title")}
              </p>
              <p className="font-mono text-[13px] text-text-3 mt-1 max-w-[360px]">
                [{t("empty.description")}]
              </p>
            </div>
          </div>
        )}

        <AnimatePresence mode={shouldReduceMotion ? "sync" : "popLayout"}>
          {actions.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              selected={selectedIds.has(action.id)}
              onSelect={handleSelect}
              onApprove={handleApprove}
              onReject={(id) => setRejectTarget(id)}
              t={t}
              teamMembers={action.actionType === "create_task" ? teamMemberOptions : undefined}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Sticky Batch Action Bar (z-1500 floating-ui) ───────────────── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[1500] border-t border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] backdrop-blur-[24px] saturate-[1.3]">
          <div className="flex items-center justify-between gap-4 px-6 py-3 max-w-screen-xl mx-auto">
            <span className="font-mono text-[13px] text-text-2">
              [{selectedIds.size} {t("batch.selected")}]
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkApprove}
                disabled={bulkApproveMutation.isPending}
                className="min-h-[36px] px-6 rounded-[5px] bg-[rgba(111, 148, 176,0.15)] text-[#6F94B0] font-mohave text-body-sm uppercase hover:bg-[rgba(111, 148, 176,0.25)] transition-colors disabled:opacity-50"
              >
                {t("action.bulkApprove")}
              </button>
              <button
                onClick={() => setBulkRejectOpen(true)}
                disabled={bulkRejectMutation.isPending}
                className="min-h-[36px] px-6 rounded-[5px] bg-[rgba(147,50,26,0.10)] text-[#93321A] font-mohave text-body-sm uppercase hover:bg-[rgba(147,50,26,0.20)] transition-colors disabled:opacity-50"
              >
                {t("action.bulkReject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Dialogs ─────────────────────────────────────────────── */}
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

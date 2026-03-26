"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Mail, X, Loader2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { trackScreenView } from "@/lib/analytics/analytics";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useOpportunities,
  useClients,
  useTeamMembers,
  useMoveOpportunityStage,
  useUpdateOpportunity,
  useCreateOpportunity,
  useCreateActivity,
  useArchiveOpportunity,
  useUnarchiveOpportunity,
  useGmailConnections,
} from "@/lib/hooks";
import {
  type Opportunity,
  OpportunityStage,
  OpportunitySource,
  ActivityType,
  getStageDisplayName,
  isActiveStage,
  nextOpportunityStage,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";
import {
  actionPromptVariants,
  actionPromptVariantsReduced,
} from "@/lib/utils/motion";

import { PipelineBoard } from "./_components/pipeline-board";
import { PipelineMobile } from "./_components/pipeline-mobile";
import { PipelineMetricsBar } from "./_components/pipeline-metrics-bar";
import { PipelineFilterRow } from "./_components/pipeline-filter-row";
import { DealDetailSheet } from "./_components/deal-detail-sheet";
import { StageTransitionDialog } from "./_components/stage-transition-dialog";
import { useWindowStore } from "@/stores/window-store";
import { InboxLeadsQueue } from "@/components/ops/inbox-leads-queue";
import { EmailReviewPanel } from "@/components/ops/email-review-panel";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------
function PipelineSkeleton() {
  const { t } = useDictionary("pipeline");
  const stages = PIPELINE_STAGES_DEFAULT;

  return (
    <div className="flex flex-col h-full space-y-2 min-w-0">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-kosugi text-caption-sm text-text-tertiary">
            {t("loading")}
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] rounded-[4px]">
          <div className="flex items-center gap-[16px] px-3 py-[8px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                <div className="h-[18px] w-[60px] bg-background-elevated rounded animate-pulse" />
                <div className="h-[10px] w-[40px] bg-background-elevated rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Board skeleton */}
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-2 min-w-min">
          {stages.slice(0, 6).map((stage) => (
            <div
              key={stage.slug}
              className="flex flex-col w-[280px] shrink-0"
            >
              <div
                className="border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0"
                style={{ borderTopColor: stage.color }}
              >
                <div className="flex items-center gap-1">
                  <h3
                    className="font-mohave text-body font-medium uppercase tracking-wider"
                    style={{ color: stage.color }}
                  >
                    {stage.name}
                  </h3>
                  <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
                    --
                  </span>
                </div>
              </div>
              <div className="flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] bg-[rgba(10,10,10,0.5)]">
                {[1, 2].map((j) => (
                  <div
                    key={j}
                    className="bg-[rgba(13,13,13,0.6)] border border-[rgba(255,255,255,0.2)] rounded-[5px] p-1.5 space-y-1.5 animate-pulse"
                  >
                    <div className="h-[14px] w-3/4 bg-background-elevated rounded" />
                    <div className="h-[10px] w-1/2 bg-background-elevated rounded" />
                    <div className="h-[10px] w-1/3 bg-background-elevated rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responsive breakpoint hook
// ---------------------------------------------------------------------------
function useIsMobile(breakpoint = 900): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}

// ---------------------------------------------------------------------------
// Pipeline Page - Main Orchestrator
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  usePageTitle("Pipeline");
  const { t } = useDictionary("pipeline");
  const router = useRouter();
  const isMobile = useIsMobile();

  // ── Reduced motion ────────────────────────────────────────────────────
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const toastVariants = prefersReducedMotion
    ? actionPromptVariantsReduced
    : actionPromptVariants;

  // ── Filter / search state ─────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">(
    "all"
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string | "all">("all");

  // ── Card expand state (single card accordion) ─────────────────────────
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // ── Lead creation via floating window ────────────────────────────────
  const openWindow = useWindowStore((s) => s.openWindow);

  // ── Inbox leads / email review ────────────────────────────────────────
  const [showInboxLeads, setShowInboxLeads] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  // ── Gmail banner ──────────────────────────────────────────────────────
  const [gmailBannerDismissed, setGmailBannerDismissed] = useState(false);

  // ── Detail sheet ──────────────────────────────────────────────────────
  const [selectedOpportunity, setSelectedOpportunity] =
    useState<Opportunity | null>(null);

  // ── Stage transition dialog ───────────────────────────────────────────
  const [transitionType, setTransitionType] = useState<"won" | "lost" | null>(
    null
  );
  const [transitionOpportunity, setTransitionOpportunity] =
    useState<Opportunity | null>(null);
  const [pendingStageMove, setPendingStageMove] = useState<{
    id: string;
    stage: OpportunityStage;
  } | null>(null);

  // ── Archive undo state ────────────────────────────────────────────────
  const [archiveUndoState, setArchiveUndoState] = useState<{
    id: string;
    timer: NodeJS.Timeout;
  } | null>(null);

  // ── Track screen view ─────────────────────────────────────────────────
  useEffect(() => {
    trackScreenView("pipeline");
  }, []);

  // ── Handle ?action=new from FAB navigation ────────────────────────────
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("action") === "new") {
      openWindow({ id: "create-lead", title: "New Lead", type: "create-lead" });
    }
  }, [searchParams, openWindow]);

  // ── Auth ──────────────────────────────────────────────────────────────
  const { company, currentUser } = useAuthStore();
  const can = usePermissionStore((s) => s.can);

  // ── Setup gate ────────────────────────────────────────────────────────
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  const gatedOpenCreate = useCallback(() => {
    if (!setupComplete) {
      setShowSetupModal(true);
      return;
    }
    openWindow({ id: "create-lead", title: "New Lead", type: "create-lead" });
  }, [setupComplete, openWindow]);

  // ── Data fetching ─────────────────────────────────────────────────────
  const { data: opportunities, isLoading: oppsLoading } = useOpportunities();
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: teamData } = useTeamMembers();
  const { data: gmailConnections = [] } = useGmailConnections();

  const { data: reviewCount = 0 } = useQuery({
    queryKey: ["emailReviewCount", company?.id],
    queryFn: async () => {
      const resp = await fetch(
        `/api/integrations/gmail/review-items?companyId=${encodeURIComponent(company!.id)}`
      );
      if (!resp.ok) return 0;
      const json = (await resp.json()) as { ok: boolean; items: unknown[] };
      return Array.isArray(json.items) ? json.items.length : 0;
    },
    enabled: !!company?.id,
    refetchInterval: 30000,
  });

  const isLoading = oppsLoading || clientsLoading;

  // ── Mutations ─────────────────────────────────────────────────────────
  const moveStage = useMoveOpportunityStage();
  const updateOpportunity = useUpdateOpportunity();
  const createOpportunity = useCreateOpportunity();
  const createActivity = useCreateActivity();
  const archiveMutation = useArchiveOpportunity();
  const unarchiveMutation = useUnarchiveOpportunity();

  // ── Client name map ───────────────────────────────────────────────────
  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (clientsData?.clients) {
      for (const client of clientsData.clients) {
        map.set(client.id, client.name);
      }
    }
    return map;
  }, [clientsData]);

  // ── Team members for filter dropdown ──────────────────────────────────
  const teamMembers = useMemo(() => {
    if (!teamData?.users) return [];
    return teamData.users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
    }));
  }, [teamData]);

  // ── Active (non-deleted, non-archived) opportunities ──────────────────
  const activeOpportunities = useMemo(() => {
    if (!opportunities) return [];
    return opportunities.filter(
      (o) => !o.deletedAt && !o.archivedAt
    );
  }, [opportunities]);

  // ── Filtered opportunities ────────────────────────────────────────────
  const filteredOpportunities = useMemo(() => {
    let result = activeOpportunities;

    // Stage filter
    if (stageFilter !== "all") {
      result = result.filter((o) => o.stage === stageFilter);
    }

    // Assignee filter
    if (assigneeFilter !== "all") {
      result = result.filter((o) => o.assignedTo === assigneeFilter);
    }

    // Search query
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter((opp) => {
        const clientName = opp.clientId
          ? (clientNameMap.get(opp.clientId) ?? "")
          : "";
        const contactName = opp.contactName ?? "";
        const title = opp.title ?? "";
        return (
          clientName.toLowerCase().includes(query) ||
          contactName.toLowerCase().includes(query) ||
          title.toLowerCase().includes(query)
        );
      });
    }

    return result;
  }, [activeOpportunities, stageFilter, assigneeFilter, searchQuery, clientNameMap]);

  // ── Board opportunities (active stages only — Won/Lost live in metrics bar)
  const boardOpportunities = useMemo(() => {
    return filteredOpportunities.filter((o) => isActiveStage(o.stage));
  }, [filteredOpportunities]);

  // ── Handlers ──────────────────────────────────────────────────────────

  /** Toggle card expand — only one at a time */
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedCardId((prev) => (prev === id ? null : id));
  }, []);

  /** One-tap call logging */
  const handleLogCall = useCallback(
    (opportunityId: string) => {
      createActivity.mutate({
        companyId: company?.id ?? "",
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.Call,
        subject: "Phone call",
        content: null,
        outcome: null,
        direction: "outbound",
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      });
      toast.success(t("card.callLogged"));
    },
    [createActivity, company?.id, currentUser?.id, t]
  );

  /** One-tap text logging */
  const handleLogText = useCallback(
    (opportunityId: string) => {
      createActivity.mutate({
        companyId: company?.id ?? "",
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.TextMessage,
        subject: "Text message",
        content: null,
        outcome: null,
        direction: "outbound",
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      });
      toast.success(t("card.textLogged"));
    },
    [createActivity, company?.id, currentUser?.id, t]
  );

  /** Add note to an opportunity */
  const handleAddNote = useCallback(
    (opportunityId: string, note: string) => {
      createActivity.mutate({
        companyId: company?.id ?? "",
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.Note,
        subject: t("detail.noteSubject"),
        content: note,
        outcome: null,
        direction: null,
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      });
      toast.success(t("card.noteAdded"));
    },
    [createActivity, company?.id, currentUser?.id, t]
  );

  /** Archive with undo */
  const handleArchive = useCallback(
    (opportunityId: string) => {
      archiveMutation.mutate(opportunityId);
      // Clear any existing undo timer
      if (archiveUndoState?.timer) clearTimeout(archiveUndoState.timer);
      const timer = setTimeout(() => setArchiveUndoState(null), 5000);
      setArchiveUndoState({ id: opportunityId, timer });
    },
    [archiveMutation, archiveUndoState]
  );

  /** Undo archive */
  const handleUndoArchive = useCallback(() => {
    if (archiveUndoState) {
      clearTimeout(archiveUndoState.timer);
      unarchiveMutation.mutate(archiveUndoState.id);
      setArchiveUndoState(null);
    }
  }, [archiveUndoState, unarchiveMutation]);

  /** Handle stage move from drag-and-drop or advance button */
  const handleMoveStage = useCallback(
    (id: string, newStage: OpportunityStage) => {
      if (!can("pipeline.manage")) return;
      const opp = activeOpportunities.find((o) => o.id === id);
      if (!opp) return;

      // Won / Lost need confirmation dialogs
      if (newStage === OpportunityStage.Won) {
        setTransitionOpportunity(opp);
        setTransitionType("won");
        setPendingStageMove({ id, stage: newStage });
        return;
      }

      if (newStage === OpportunityStage.Lost) {
        setTransitionOpportunity(opp);
        setTransitionType("lost");
        setPendingStageMove({ id, stage: newStage });
        return;
      }

      // Normal stage move
      moveStage.mutate(
        { id, stage: newStage, userId: currentUser?.id },
        {
          onSuccess: () => {
            toast.success(
              `${t("toast.movedTo")} ${getStageDisplayName(newStage)}`,
              { description: opp.title }
            );
          },
          onError: (error) => {
            toast.error(t("toast.failedMove"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          },
        }
      );
    },
    [activeOpportunities, moveStage, currentUser, can, t]
  );

  /** Mark won — opens transition dialog */
  const handleMarkWon = useCallback(
    (opportunity: Opportunity) => {
      handleMoveStage(opportunity.id, OpportunityStage.Won);
    },
    [handleMoveStage]
  );

  /** Mark lost — opens transition dialog */
  const handleMarkLost = useCallback(
    (opportunity: Opportunity) => {
      handleMoveStage(opportunity.id, OpportunityStage.Lost);
    },
    [handleMoveStage]
  );

  /** Discard — direct stage move, no confirmation dialog needed */
  const handleDiscard = useCallback(
    (opportunityId: string) => {
      handleMoveStage(opportunityId, OpportunityStage.Discarded);
    },
    [handleMoveStage]
  );

  /** Confirm Won/Lost transition */
  const handleTransitionConfirm = useCallback(
    (data: {
      actualValue?: number;
      lostReason?: string;
      lostNotes?: string;
    }) => {
      if (!can("pipeline.manage")) return;
      if (!pendingStageMove || !transitionOpportunity) return;

      const { id, stage } = pendingStageMove;

      moveStage.mutate(
        { id, stage, userId: currentUser?.id },
        {
          onSuccess: () => {
            const updateData: Record<string, unknown> = {};
            if (data.actualValue !== undefined) {
              updateData.actualValue = data.actualValue;
            }
            if (data.lostReason) {
              updateData.lostReason = data.lostReason;
            }
            if (data.lostNotes) {
              updateData.lostNotes = data.lostNotes;
            }

            if (Object.keys(updateData).length > 0) {
              updateOpportunity.mutate({ id, data: updateData });
            }

            const toastMsg =
              stage === OpportunityStage.Won
                ? t("toast.dealMarkedWon")
                : t("toast.dealMarkedLost");
            toast.success(toastMsg, {
              description: transitionOpportunity.title,
            });
          },
          onError: (error) => {
            toast.error(t("toast.failedUpdate"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          },
        }
      );

      setTransitionType(null);
      setTransitionOpportunity(null);
      setPendingStageMove(null);
    },
    [
      pendingStageMove,
      transitionOpportunity,
      moveStage,
      updateOpportunity,
      currentUser,
      can,
      t,
    ]
  );

  /** Cancel Won/Lost transition */
  const handleTransitionCancel = useCallback(() => {
    setTransitionType(null);
    setTransitionOpportunity(null);
    setPendingStageMove(null);
  }, []);

  /** Open detail sheet for an opportunity */
  const handleSelectOpportunity = useCallback((opp: Opportunity) => {
    setSelectedOpportunity(opp);
  }, []);

  /** Handle quick advance: move to next stage */
  const handleAdvanceStage = useCallback(
    (opportunity: Opportunity) => {
      const next = nextOpportunityStage(opportunity.stage);
      if (!next) return;
      handleMoveStage(opportunity.id, next);
    },
    [handleMoveStage]
  );

  /** Create lead from email — shared between inbox and review panel */
  const createLeadFromEmail = useCallback(
    (prefill: { title: string; notes?: string; sourceEmail?: string }) => {
      if (!company) return;
      createOpportunity.mutate(
        {
          companyId: company.id,
          clientId: null,
          title: prefill.title,
          description: prefill.notes || null,
          contactName: null,
          contactEmail: prefill.sourceEmail || null,
          contactPhone: null,
          stage: OpportunityStage.NewLead,
          source: OpportunitySource.Email,
          assignedTo: currentUser?.id ?? null,
          priority: null,
          estimatedValue: null,
          actualValue: null,
          winProbability: 10,
          expectedCloseDate: null,
          actualCloseDate: null,
          projectId: null,
          lostReason: null,
          lostNotes: null,
          quoteDeliveryMethod: null,
          address: null,
          tags: [],
        },
        {
          onSuccess: () => {
            toast.success(t("toast.leadFromEmail"), {
              description: prefill.title,
            });
          },
        }
      );
    },
    [company, currentUser, createOpportunity, t]
  );

  /** Placeholder: assign (opened via detail sheet for now) */
  const handleAssign = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) setSelectedOpportunity(opp);
    },
    [activeOpportunities]
  );

  /** Placeholder: schedule follow-up (opened via detail sheet for now) */
  const handleScheduleFollowUp = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) setSelectedOpportunity(opp);
    },
    [activeOpportunities]
  );

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading) {
    return <PipelineSkeleton />;
  }

  const canManage = can("pipeline.manage");

  // ── Shared board/mobile props ─────────────────────────────────────────
  const sharedBoardProps = {
    opportunities: boardOpportunities,
    clients: clientNameMap,
    expandedCardId,
    onToggleExpand: handleToggleExpand,
    onMoveStage: handleMoveStage,
    onLogCall: handleLogCall,
    onLogText: handleLogText,
    onAddNote: handleAddNote,
    onArchive: handleArchive,
    onDiscard: handleDiscard,
    onMarkWon: handleMarkWon,
    onMarkLost: handleMarkLost,
    onOpenDetail: handleSelectOpportunity,
    onAssign: handleAssign,
    onScheduleFollowUp: handleScheduleFollowUp,
    onAddLead: gatedOpenCreate,
    canManage,
  } as const;

  return (
    <div className="space-y-2 h-full flex flex-col min-w-0">
      {/* Metrics bar — uses unfiltered data for big-picture stats */}
      <PipelineMetricsBar
        opportunities={activeOpportunities}
        clients={clientNameMap}
        onOpenDetail={handleSelectOpportunity}
        isLoading={false}
      />

      {/* Filter row */}
      <PipelineFilterRow
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        stageFilter={stageFilter}
        onStageFilterChange={setStageFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        teamMembers={teamMembers}
        onAddLead={gatedOpenCreate}
        canManage={canManage}
      />

      {/* Gmail connect prompt */}
      {gmailConnections.length === 0 && !gmailBannerDismissed && (
        <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 rounded-[4px] bg-[rgba(65,115,148,0.08)] border border-[rgba(89,119,148,0.2)] animate-fade-in">
          <div className="w-[32px] h-[32px] rounded bg-[rgba(89,119,148,0.15)] flex items-center justify-center shrink-0">
            <Mail className="w-[16px] h-[16px] text-[#597794]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mohave text-body text-text-primary">
              {t("gmail.connectBanner")}
            </p>
            <p className="font-kosugi text-[11px] text-text-disabled">
              {t("gmail.connectDesc")}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              className="gap-[6px]"
              onClick={() => {
                const params = new URLSearchParams({
                  companyId: company?.id ?? "",
                  type: "company",
                });
                window.location.href = `/api/integrations/gmail?${params}`;
              }}
            >
              <Mail className="w-[14px] h-[14px]" />
              {t("gmail.connect")}
            </Button>
            <button
              onClick={() => setGmailBannerDismissed(true)}
              className="p-[6px] text-text-disabled hover:text-text-tertiary transition-colors"
              title={t("gmail.dismiss")}
            >
              <X className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>
      )}

      {/* Email review badge */}
      {reviewCount > 0 && (
        <div className="shrink-0">
          <button
            onClick={() => setReviewPanelOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-[4px] bg-[rgba(89,119,148,0.12)] text-[#8BB8D4] text-xs font-medium hover:bg-[rgba(89,119,148,0.20)] transition-colors cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5" />
            Review Emails
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#597794] text-[9px] font-bold text-white">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          </button>
        </div>
      )}

      {/* Inbox leads toggle */}
      {showInboxLeads && (
        <div className="shrink-0">
          <InboxLeadsQueue
            onCreateLead={(prefill) => {
              setShowInboxLeads(false);
              createLeadFromEmail(prefill);
            }}
            className="max-w-[600px]"
          />
        </div>
      )}

      {/* Mutation loading indicator */}
      {moveStage.isPending && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-[4px] bg-[rgba(89,119,148,0.12)] border border-[rgba(89,119,148,0.25)]">
          <Loader2 className="w-[14px] h-[14px] text-[#597794] animate-spin" />
          <span className="font-kosugi text-[11px] text-[#597794]">
            {t("column.updating")}
          </span>
        </div>
      )}

      {/* Pipeline Board / Mobile */}
      <div className="flex-1 min-h-0 min-w-0">
        {isMobile ? (
          <PipelineMobile {...sharedBoardProps} />
        ) : (
          <div className="h-full min-w-0">
            <PipelineBoard {...sharedBoardProps} />
          </div>
        )}
      </div>

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        opportunity={selectedOpportunity}
        open={selectedOpportunity !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOpportunity(null);
        }}
        onAdvanceStage={
          selectedOpportunity && isActiveStage(selectedOpportunity.stage)
            ? () => {
                handleAdvanceStage(selectedOpportunity);
                setSelectedOpportunity(null);
              }
            : undefined
        }
        onMarkWon={
          selectedOpportunity && isActiveStage(selectedOpportunity.stage)
            ? () => {
                handleMoveStage(
                  selectedOpportunity.id,
                  OpportunityStage.Won
                );
                setSelectedOpportunity(null);
              }
            : undefined
        }
        onMarkLost={
          selectedOpportunity && isActiveStage(selectedOpportunity.stage)
            ? () => {
                handleMoveStage(
                  selectedOpportunity.id,
                  OpportunityStage.Lost
                );
                setSelectedOpportunity(null);
              }
            : undefined
        }
      />

      {/* Stage Transition Dialog (Won/Lost prompts) */}
      <StageTransitionDialog
        type={transitionType}
        opportunity={transitionOpportunity}
        onConfirm={handleTransitionConfirm}
        onCancel={handleTransitionCancel}
      />

      {/* Email Review Panel */}
      <EmailReviewPanel
        open={reviewPanelOpen}
        onClose={() => setReviewPanelOpen(false)}
        onViewClient={(clientId) => {
          setReviewPanelOpen(false);
          router.push(`/clients/${clientId}`);
        }}
        onCreateLead={(prefill) => {
          setReviewPanelOpen(false);
          createLeadFromEmail(prefill);
        }}
      />

      {/* Setup interception modal */}
      <SetupInterceptionModal
        isOpen={showSetupModal}
        onComplete={() => {
          setShowSetupModal(false);
          openWindow({ id: "create-lead", title: "New Lead", type: "create-lead" });
        }}
        onDismiss={() => {
          setShowSetupModal(false);
        }}
        missingSteps={missingSteps}
        triggerAction="leads"
      />

      {/* Archive undo toast */}
      <AnimatePresence>
        {archiveUndoState && (
          <motion.div
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 py-2 flex items-center gap-2"
          >
            <span className="font-mohave text-body-sm text-text-secondary">
              {t("actions.archived")}
            </span>
            <span className="text-[rgba(255,255,255,0.12)]">|</span>
            <button
              onClick={handleUndoArchive}
              className="font-mohave text-body-sm text-[#597794] hover:text-[#6d8fad] transition-colors cursor-pointer"
            >
              {t("actions.undoArchive")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

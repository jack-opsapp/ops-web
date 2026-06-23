"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Mail, X, Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useUndoStore } from "@/stores/undo-store";
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
  useAttachClientToOpportunity,
  useCreateOpportunity,
  useCreateClient,
  useCreateActivity,
  useArchiveOpportunity,
  useUnarchiveOpportunity,
  useDeleteOpportunity,
  useGmailConnections,
  usePipelineMetrics,
} from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
import {
  type Opportunity,
  OpportunityStage,
  OpportunitySource,
  ActivityType,
  getStageDisplayName,
  isActiveStage,
  nextOpportunityStage,
  previousOpportunityStage,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";
// motion variants removed — archive undo toast replaced by universal undo

import type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { PipelineMobile } from "./_components/pipeline-mobile";
import { StageTransitionDialog } from "./_components/stage-transition-dialog";
import { useStageTransition } from "./_components/use-stage-transition";
import { useWindowStore } from "@/stores/window-store";
import { InboxLeadsQueue } from "@/components/ops/inbox-leads-queue";
import { EmailReviewPanel } from "@/components/ops/email-review-panel";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { calculateBatchStaleness } from "./_components/pipeline-staleness";
import { PipelineDndProvider } from "./_components/pipeline-dnd-provider";
import { PipelineDetailPanel } from "./_components/pipeline-detail-panel";
import { PipelineFocusedDragOverlay } from "./_components/pipeline-focused-drag-overlay";
import { PipelineFocusedShell } from "./_components/pipeline-focused-shell";
import { PipelineFocusedToolbar } from "./_components/pipeline-focused-toolbar";
import { PipelineFilterRow } from "./_components/pipeline-filter-row";
import { usePipelineModeShortcut } from "./_components/pipeline-mode-shortcuts";
import {
  resolvePipelineDragEnd,
  type PipelineDropData,
} from "./_components/pipeline-dnd-resolution";
import { usePipelineModeStore } from "./_components/pipeline-mode-store";
import { PipelineModeSwitcher } from "./_components/pipeline-mode-switcher";
import { PipelineTableShell } from "./_components/table/pipeline-table-shell";
import { usePipelineTableViewFlag } from "@/lib/hooks/pipeline-table/use-pipeline-table-flag";

function formatPipelineTemplate(
  template: string,
  values: Record<string, string | number>
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------
function PipelineSkeleton() {
  const { t } = useDictionary("pipeline");
  const stages = PIPELINE_STAGES_DEFAULT;

  return (
    <div className="flex h-full min-w-0 flex-col space-y-2">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-mono text-caption-sm text-text-3">
            {t("loading")}
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="rounded-chip border border-border-subtle bg-fill-neutral-dim backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]">
          <div className="flex items-center gap-[16px] px-3 py-[8px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                <div className="h-[18px] w-[60px] animate-pulse motion-reduce:animate-none rounded bg-fill-neutral-dim" />
                <div className="h-[10px] w-[40px] animate-pulse motion-reduce:animate-none rounded bg-fill-neutral-dim" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Board skeleton */}
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex min-w-min gap-2">
          {stages.slice(0, 6).map((stage) => (
            <div key={stage.slug} className="flex w-[280px] shrink-0 flex-col">
              <div
                className="glass-surface rounded-t-sm border border-b-0 border-t-2 border-border bg-glass px-1.5 py-1"
                style={{ borderTopColor: stage.color }}
              >
                <div className="flex items-center gap-1">
                  <h3
                    className="font-cakemono text-body font-light uppercase tracking-wider"
                    style={{ color: stage.color }}
                  >
                    {stage.name}
                  </h3>
                  <span className="rounded-bar bg-fill-neutral-dim px-[6px] py-[2px] font-mono text-micro text-text-mute">
                    --
                  </span>
                </div>
              </div>
              <div className="min-h-[200px] flex-1 space-y-1 rounded-b border border-t-0 border-border bg-glass p-1">
                {[1, 2].map((j) => (
                  <div
                    key={j}
                    className="glass-surface animate-pulse motion-reduce:animate-none space-y-1.5 rounded border border-border-medium bg-glass p-1.5"
                  >
                    <div className="h-[14px] w-3/4 rounded bg-fill-neutral-dim" />
                    <div className="h-[10px] w-1/2 rounded bg-fill-neutral-dim" />
                    <div className="h-[10px] w-1/3 rounded bg-fill-neutral-dim" />
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
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const tableFlag = usePipelineTableViewFlag();
  const mode = usePipelineModeStore((state) => state.mode);
  // Defensive: `table` is only reachable with the flag on. If the flag is off
  // (or flips off) while a persisted `table` value lingers, fall back to
  // focused so the surface never renders a gated mode.
  const effectiveMode = mode === "table" && tableFlag ? "table" : "focused";
  const detailPanelOpportunityId = usePipelineModeStore(
    (state) => state.detailPanelOpportunityId
  );
  const closeDetailPanel = usePipelineModeStore(
    (state) => state.closeDetailPanel
  );
  const previousModeRef = useRef(mode);
  const openedUrlOpportunityRef = useRef<string | null>(null);
  const pipelineScopeRef = useRef<HTMLDivElement>(null);
  const [originatingOpportunityId, setOriginatingOpportunityId] = useState<
    string | null
  >(null);

  // ── Filter / search state ─────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">(
    "all"
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string | "all">("all");
  const filtersActive =
    searchQuery.trim().length > 0 ||
    stageFilter !== "all" ||
    assigneeFilter !== "all";

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setStageFilter("all");
    setAssigneeFilter("all");
  }, []);

  // ── Card expand state (single card accordion) ─────────────────────────
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // ── Lead creation via floating window ────────────────────────────────
  const openWindow = useWindowStore((s) => s.openWindow);
  const openClientWindow = useWindowStore((s) => s.openClientWindow);

  // ── Inbox leads / email review ────────────────────────────────────────
  const [showInboxLeads, setShowInboxLeads] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  // ── Gmail banner ──────────────────────────────────────────────────────
  const [gmailBannerDismissed, setGmailBannerDismissed] = useState(false);

  // ── Drag state ────────────────────────────────────────────────────────
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [focusedDragAnnouncement, setFocusedDragAnnouncement] = useState("");
  usePipelineModeShortcut(activeDragId !== null);

  // ── Undo store ────────────────────────────────────────────────────────
  const pushUndo = useUndoStore((s) => s.pushUndo);

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

  // ── Metrics header data ────────────────────────────────────────────
  const { data: pipelineMetrics = [], isLoading: pipelineMetricsLoading } =
    usePipelineMetrics();

  // ── Data fetching ─────────────────────────────────────────────────────
  const {
    data: opportunities,
    isLoading: oppsLoading,
    isError: oppsError,
    error: opportunitiesError,
    refetch: refetchOpportunities,
  } = useOpportunities();
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
  const attachClient = useAttachClientToOpportunity();
  const createOpportunity = useCreateOpportunity();
  const createClientMutation = useCreateClient();
  const createActivity = useCreateActivity();
  const archiveMutation = useArchiveOpportunity();
  const unarchiveMutation = useUnarchiveOpportunity();
  const deleteMutation = useDeleteOpportunity();

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
    return opportunities.filter((o) => !o.deletedAt && !o.archivedAt);
  }, [opportunities]);

  useEffect(() => {
    const opportunityId = searchParams.get("opportunityId");
    if (!opportunityId || openedUrlOpportunityRef.current === opportunityId) {
      return;
    }
    const target = activeOpportunities.find((opp) => opp.id === opportunityId);
    if (!target) return;

    openedUrlOpportunityRef.current = opportunityId;
    setSearchQuery("");
    setStageFilter("all");
    setAssigneeFilter("all");
    setOriginatingOpportunityId(opportunityId);
    usePipelineModeStore.getState().openDetailPanel(opportunityId);
  }, [activeOpportunities, searchParams]);

  // ── Stage transitions (shared with the table surface) ─────────────────
  // The single correctness-critical path for changing a stage: active moves go
  // direct (toast + undo); Won/Lost open the terminal dialog rendered below.
  const {
    requestStageChange,
    requestConvertAlreadyWon,
    dialogType,
    dialogOpportunity,
    preflight,
    preflightLoading,
    confirmTransition,
    onAddressChange,
    cancelTransition,
  } = useStageTransition({ opportunities: activeOpportunities });

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
  }, [
    activeOpportunities,
    stageFilter,
    assigneeFilter,
    searchQuery,
    clientNameMap,
  ]);

  const focusedStalenessMap = useMemo(
    () => calculateBatchStaleness(filteredOpportunities),
    [filteredOpportunities]
  );

  const detailPanelOpportunity = useMemo(() => {
    if (!detailPanelOpportunityId) return null;
    return (
      filteredOpportunities.find(
        (opportunity) => opportunity.id === detailPanelOpportunityId
      ) ?? null
    );
  }, [detailPanelOpportunityId, filteredOpportunities]);

  useEffect(() => {
    if (detailPanelOpportunityId && !detailPanelOpportunity) {
      closeDetailPanel();
    }
  }, [closeDetailPanel, detailPanelOpportunity, detailPanelOpportunityId]);

  useEffect(() => {
    if (previousModeRef.current !== mode) {
      if (detailPanelOpportunityId) closeDetailPanel();
      previousModeRef.current = mode;
    }
  }, [closeDetailPanel, detailPanelOpportunityId, mode]);

  useEffect(() => {
    if (!detailPanelOpportunityId) {
      setOriginatingOpportunityId(null);
    }
  }, [detailPanelOpportunityId]);

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
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      const label = (opp?.contactName ?? opp?.title ?? "Deal") + " → Archived";
      archiveMutation.mutate(opportunityId);
      pushUndo({
        label,
        inverseFn: async () => {
          await unarchiveMutation.mutateAsync(opportunityId);
        },
      });
    },
    [archiveMutation, unarchiveMutation, activeOpportunities, pushUndo]
  );

  /**
   * Handle stage move from drag-and-drop, advance/retreat, the stage menu, or
   * the table's stage cell. Routes through the shared transition hook so the
   * permission gate, same-stage no-op, Won/Lost → dialog routing, toast, and
   * undo are identical across the focused and table surfaces.
   */
  const handleMoveStage = requestStageChange;

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

  /** Convert an already-won, unconverted deal — opens the Won dialog directly */
  const handleConvertAlreadyWon = useCallback(
    (opportunity: Opportunity) => {
      requestConvertAlreadyWon(opportunity.id);
    },
    [requestConvertAlreadyWon]
  );

  /** Discard — direct stage move, no confirmation dialog needed */
  const handleDiscard = useCallback(
    (opportunityId: string) => {
      handleMoveStage(opportunityId, OpportunityStage.Discarded);
    },
    [handleMoveStage]
  );

  const setFocusedDragLiveMessage = useCallback((message: string) => {
    setFocusedDragAnnouncement((current) =>
      current === message ? current : message
    );
  }, []);

  const handlePipelineDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveDragId(id);

      setFocusedDragLiveMessage(t("focused.dragLive.started"));
    },
    [setFocusedDragLiveMessage, t]
  );

  const handlePipelineDragOver = useCallback(
    (event: DragOverEvent) => {
      if (effectiveMode !== "focused") return;

      const data = event.over?.data.current as PipelineDropData | undefined;
      if (
        data?.mode === "focused" &&
        data.focusedDropIntent === "archive-target"
      ) {
        setFocusedDragLiveMessage(t("actions.archive"));
        return;
      }

      if (
        data?.mode === "focused" &&
        data.focusedDropIntent === "discard-target"
      ) {
        setFocusedDragLiveMessage(t("actions.discard"));
        return;
      }

      if (data?.mode !== "focused" || !data.stage) {
        setFocusedDragLiveMessage("");
        return;
      }

      setFocusedDragLiveMessage(
        formatPipelineTemplate(t("focused.dragLive.target"), {
          stage: getStageDisplayName(data.stage),
        })
      );
    },
    [effectiveMode, setFocusedDragLiveMessage, t]
  );

  const handlePipelineDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;
      const draggedId = String(event.active.id);
      const data = over?.data.current as PipelineDropData | undefined;
      const drop = resolvePipelineDragEnd({
        mode: effectiveMode,
        draggedId,
        selectedCardIds: new Set<string>(),
        dropData: data,
      });

      if (drop.type === "focused-action") {
        if (drop.action === "archive") {
          handleArchive(drop.opportunityId);
          setFocusedDragLiveMessage(t("actions.archived"));
        } else {
          handleDiscard(drop.opportunityId);
          setFocusedDragLiveMessage(t("actions.discard"));
        }
      } else if (drop.type === "focused-stage") {
        const opportunity = filteredOpportunities.find(
          (o) => o.id === draggedId
        );

        if (drop.isTerminal && opportunity) {
          if (drop.stage === OpportunityStage.Won) {
            handleMarkWon(opportunity);
          } else if (drop.stage === OpportunityStage.Lost) {
            handleMarkLost(opportunity);
          }
        } else {
          handleMoveStage(drop.opportunityId, drop.stage);
        }

        setFocusedDragLiveMessage(
          formatPipelineTemplate(t("focused.dragLive.dropped"), {
            stage: getStageDisplayName(drop.stage),
          })
        );
      } else {
        setFocusedDragLiveMessage(t("focused.dragLive.cancelled"));
      }

      setActiveDragId(null);
    },
    [
      filteredOpportunities,
      handleArchive,
      handleDiscard,
      handleMarkLost,
      handleMarkWon,
      handleMoveStage,
      effectiveMode,
      setFocusedDragLiveMessage,
      t,
    ]
  );

  const handlePipelineDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      setActiveDragId(null);
      setFocusedDragLiveMessage(t("focused.dragLive.cancelled"));
    },
    [setFocusedDragLiveMessage, t]
  );

  /** Open detail panel for an opportunity */
  const handleOpenDetail = useCallback((opp: Opportunity) => {
    setOriginatingOpportunityId(opp.id);
    usePipelineModeStore.getState().openDetailPanel(opp.id);
  }, []);

  const handleTitleSave = useCallback(
    (opportunity: Opportunity, title: string) => {
      if (!can("pipeline.manage")) return;
      updateOpportunity.mutate(
        { id: opportunity.id, data: { title } },
        {
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
    },
    [can, t, updateOpportunity]
  );

  const handleLinkClient = useCallback(
    (opportunity: Opportunity, clientId: string) => {
      if (!can("pipeline.manage")) return;
      attachClient.mutate(
        { opportunityId: opportunity.id, clientId },
        {
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
    },
    [attachClient, can, t]
  );

  const handleCreateAndLinkClient = useCallback(
    async (opportunity: Opportunity, clientName: string) => {
      if (!can("pipeline.manage") || !company?.id) return;

      try {
        const client = await createClientMutation.mutateAsync({
          name: clientName,
          email: opportunity.contactEmail,
          phoneNumber: opportunity.contactPhone,
          address: opportunity.address,
          companyId: company.id,
        });

        await attachClient.mutateAsync({
          opportunityId: opportunity.id,
          clientId: client.id,
        });
      } catch (error) {
        toast.error(t("toast.failedUpdate"), {
          description:
            error instanceof Error ? error.message : t("toast.errorOccurred"),
        });
      }
    },
    [attachClient, can, company?.id, createClientMutation, t]
  );

  const handleAddressSave = useCallback(
    (
      opportunity: Opportunity,
      selection: { address: string; latitude: number; longitude: number }
    ) => {
      if (!can("pipeline.manage")) return;
      updateOpportunity.mutate(
        {
          id: opportunity.id,
          data: {
            address: selection.address,
            latitude: selection.latitude,
            longitude: selection.longitude,
          },
        },
        {
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
    },
    [can, t, updateOpportunity]
  );

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
          latitude: null,
          longitude: null,
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

  /** Placeholder: assign (opens detail panel) */
  const handleAssign = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) handleOpenDetail(opp);
    },
    [activeOpportunities, handleOpenDetail]
  );

  /** Placeholder: schedule follow-up (opens detail panel) */
  const handleScheduleFollowUp = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) handleOpenDetail(opp);
    },
    [activeOpportunities, handleOpenDetail]
  );

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading && (isMobile || effectiveMode !== "focused")) {
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
    onConvert: handleConvertAlreadyWon,
    onOpenDetail: handleOpenDetail,
    onAssign: handleAssign,
    onScheduleFollowUp: handleScheduleFollowUp,
    onAddLead: gatedOpenCreate,
    canManage,
  } as const;

  const focusedActiveOpportunity =
    effectiveMode === "focused" && activeDragId
      ? (filteredOpportunities.find(
          (opportunity) => opportunity.id === activeDragId
        ) ?? null)
      : null;
  const focusedActiveClientName = focusedActiveOpportunity
    ? (clientNameMap.get(focusedActiveOpportunity.clientId ?? "") ??
      focusedActiveOpportunity.contactName ??
      t("card.unknown"))
    : "";
  const focusedActiveStaleness = focusedActiveOpportunity
    ? (focusedStalenessMap.get(focusedActiveOpportunity.id) ?? 1)
    : 1;
  const isFocusedDesktop = !isMobile && effectiveMode === "focused";

  // Crossfade timing — opacity-only, single design-system easing. Reduced
  // motion collapses the duration to 0 for an instant swap.
  const modeCrossfadeTransition = {
    duration: reducedMotion ? 0 : 0.2,
    ease: EASE_SMOOTH,
  };

  return (
    <div
      ref={pipelineScopeRef}
      className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {/* ── Canvas — fills entire viewport, renders behind HUD ── */}
      <div className="absolute inset-0 overflow-hidden">
        {isMobile ? (
          <PipelineMobile {...sharedBoardProps} />
        ) : (
          // Crossfade between focused and table surfaces. Opacity-only — no
          // layout or card morph. `mode="wait"` fades the outgoing surface out
          // before the incoming one fades in, so the two never overlap.
          <AnimatePresence mode="wait" initial={false}>
            {effectiveMode === "table" ? (
              <motion.div
                key="table"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={modeCrossfadeTransition}
                data-pipeline-mode-surface="table"
                className="absolute inset-0"
              >
                <PipelineTableShell />
              </motion.div>
            ) : (
              <motion.div
                key="focused"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={modeCrossfadeTransition}
                className="absolute inset-0"
              >
                <PipelineDndProvider
                  mode={effectiveMode}
                  activeDragId={activeDragId}
                  onDragStart={handlePipelineDragStart}
                  onDragOver={handlePipelineDragOver}
                  onDragEnd={handlePipelineDragEnd}
                  onDragCancel={handlePipelineDragCancel}
                >
                  <div
                    data-pipeline-mode-surface="focused"
                    className="absolute inset-0"
                  >
                    <PipelineFocusedShell
                      opportunities={filteredOpportunities}
                      clients={clientsData?.clients ?? []}
                      clientNameMap={clientNameMap}
                      canManage={canManage}
                      filtersActive={filtersActive}
                      opportunitiesLoading={oppsLoading}
                      clientsLoading={clientsLoading}
                      isOpportunitiesError={oppsError}
                      opportunitiesError={opportunitiesError}
                      dragAnnouncement={focusedDragAnnouncement}
                      onRetryOpportunities={() => {
                        void refetchOpportunities();
                      }}
                      onAddLead={gatedOpenCreate}
                      onClearFilters={handleClearFilters}
                      onLogCall={handleLogCall}
                      onLogText={handleLogText}
                      onAddNote={handleAddNote}
                      onArchive={handleArchive}
                      onDiscard={handleDiscard}
                      onMarkWon={handleMarkWon}
                      onMarkLost={handleMarkLost}
                      onConvert={handleConvertAlreadyWon}
                      onAdvanceStage={handleAdvanceStage}
                      onMoveStage={handleMoveStage}
                      onAssign={handleAssign}
                      onScheduleFollowUp={handleScheduleFollowUp}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onTitleSave={handleTitleSave}
                      onLinkClient={handleLinkClient}
                      onCreateAndLinkClient={handleCreateAndLinkClient}
                      onAddressSave={handleAddressSave}
                    />
                  </div>
                  <PipelineFocusedDragOverlay
                    activeOpportunity={focusedActiveOpportunity}
                    clientName={focusedActiveClientName}
                    stalenessOpacity={focusedActiveStaleness}
                  />
                </PipelineDndProvider>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* ── Page HUD — metrics, toolbar, banners float on top of canvas ── */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[2]">
        <div className="pointer-events-auto">
          <MetricsHeader
            variant="full"
            tabId="pipeline"
            title="Pipeline"
            metrics={pipelineMetrics}
            isLoading={pipelineMetricsLoading}
            slashLabels
          />
        </div>
        {/* Mode switcher — focused | table (flag-gated; hidden entirely off) */}
        {tableFlag && !isMobile && (
          <div className="pointer-events-auto flex justify-end px-3 pt-1">
            <PipelineModeSwitcher />
          </div>
        )}
        {/* Banners */}
        <div
          className={cn(
            "pointer-events-auto flex flex-col gap-1 px-3",
            isFocusedDesktop &&
              "fixed bottom-[54px] left-[84px] z-[9997] w-[min(560px,calc(100vw-108px))] px-0"
          )}
        >
          {gmailConnections.length === 0 && !gmailBannerDismissed && (
            <div
              className="glass-dense flex animate-fade-in items-center gap-2 rounded-panel border px-2 py-1.5 [&::before]:rounded-panel"
              style={{
                background: "var(--surface-glass-dense)",
                backdropFilter: "blur(28px) saturate(1.3)",
                WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                borderColor: "var(--glass-border)",
              }}
            >
              <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[5px] border border-border bg-surface-active">
                <Mail className="h-[16px] w-[16px] text-text-2" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mohave text-body text-text">
                  {t("gmail.connectBanner")}
                </p>
                <p className="font-mono text-micro text-text-mute">
                  {t("gmail.connectDesc")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  className="gap-[6px]"
                  onClick={() => {
                    if (!currentUser?.id) {
                      console.error(
                        "[pipeline] No current user — cannot initiate OAuth"
                      );
                      return;
                    }
                    const params = new URLSearchParams({
                      companyId: company?.id ?? "",
                      userId: currentUser.id,
                      type: "company",
                    });
                    window.location.href = `/api/integrations/gmail?${params}`;
                  }}
                >
                  <Mail className="h-[14px] w-[14px]" />
                  {t("gmail.connect")}
                </Button>
                <button
                  onClick={() => setGmailBannerDismissed(true)}
                  className="p-[6px] text-text-mute transition-colors hover:text-text-3"
                  title={t("gmail.dismiss")}
                >
                  <X className="h-[14px] w-[14px]" />
                </button>
              </div>
            </div>
          )}
          {showInboxLeads && (
            <InboxLeadsQueue
              onCreateLead={(prefill) => {
                setShowInboxLeads(false);
                createLeadFromEmail(prefill);
              }}
              className="max-w-[600px]"
            />
          )}
          {moveStage.isPending && (
            <div className="flex items-center gap-1.5 rounded-chip border border-border bg-surface-active px-2 py-1">
              <Loader2 className="h-[14px] w-[14px] animate-spin text-text-3" />
              <span className="font-mono text-micro text-text-2">
                {t("column.updating")}
              </span>
            </div>
          )}
        </div>
      </div>

      {!isMobile && effectiveMode === "focused" && (
        <div
          className="pointer-events-none fixed bottom-[12px] left-[84px] right-[12px] z-[9998] flex justify-start"
        >
          <div
            className="glass-dense scrollbar-hide pointer-events-auto inline-flex max-w-full items-center gap-[3px] overflow-x-auto rounded-[10px] border px-[3px] py-[3px] [&::before]:rounded-[10px]"
            style={{
              background: "var(--surface-glass-dense)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              borderColor: "var(--glass-border)",
              borderRadius: "10px",
            }}
          >
            <PipelineFocusedToolbar
              reviewCount={reviewCount}
              onReviewEmails={() => setReviewPanelOpen(true)}
            />
            <div className="mx-[3px] h-[16px] w-px shrink-0 bg-border-subtle" />
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
              variant="toolbar"
            />
          </div>
        </div>
      )}

      {!isMobile && effectiveMode === "focused" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-12 bg-gradient-to-t from-background via-background/60 to-transparent" />
      )}

      {/* Stage Transition Dialog (Won/Lost prompts) */}
      <StageTransitionDialog
        type={dialogType}
        opportunity={dialogOpportunity}
        preflight={preflight}
        preflightLoading={preflightLoading}
        onConfirm={confirmTransition}
        onAddressChange={onAddressChange}
        onCancel={cancelTransition}
      />

      {/* Email Review Panel */}
      <EmailReviewPanel
        open={reviewPanelOpen}
        onClose={() => setReviewPanelOpen(false)}
        onViewClient={(clientId) => {
          setReviewPanelOpen(false);
          openClientWindow({ clientId, mode: "viewing" });
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
          openWindow({
            id: "create-lead",
            title: "New Lead",
            type: "create-lead",
          });
        }}
        onDismiss={() => {
          setShowSetupModal(false);
        }}
        missingSteps={missingSteps}
        triggerAction="leads"
      />

      {/* Archive undo toast removed — universal undo in TopBar */}
    </div>
  );
}

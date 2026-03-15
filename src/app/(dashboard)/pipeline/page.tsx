"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Plus,
  X,
  ListFilter,
  TrendingUp,
  Target,
  Loader2,
  DollarSign,
  Mail,
} from "lucide-react";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useOpportunities,
  useClients,
  useMoveOpportunityStage,
  useUpdateOpportunity,
  useCreateOpportunity,
  useGmailConnections,
} from "@/lib/hooks";
import {
  type Opportunity,
  OpportunityStage,
  OpportunitySource,
  getStageDisplayName,
  getStageColor,
  isActiveStage,
  getAllStages,
  formatCurrency,
  nextOpportunityStage,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";

import { PipelineBoard } from "./_components/pipeline-board";
import { DealDetailSheet } from "./_components/deal-detail-sheet";
import { StageTransitionDialog } from "./_components/stage-transition-dialog";
import { QuickAddForm } from "./_components/quick-add-form";
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
    <div className="flex flex-col h-full space-y-2 min-w-0 overflow-x-hidden">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-kosugi text-caption-sm text-text-tertiary">
            {t("loading")}
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-1 flex items-center gap-1.5">
              <div className="w-[32px] h-[32px] rounded bg-background-elevated animate-pulse" />
              <div className="space-y-1">
                <div className="h-[10px] w-[60px] bg-background-elevated rounded animate-pulse" />
                <div className="h-[14px] w-[40px] bg-background-elevated rounded animate-pulse" />
              </div>
            </Card>
          ))}
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
// Pipeline Page - Main Orchestrator
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  usePageTitle("Pipeline");
  const { t } = useDictionary("pipeline");
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showInboxLeads, setShowInboxLeads] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [gmailBannerDismissed, setGmailBannerDismissed] = useState(false);

  // Detail sheet
  const [selectedOpportunity, setSelectedOpportunity] =
    useState<Opportunity | null>(null);

  // Stage transition dialog
  const [transitionType, setTransitionType] = useState<"won" | "lost" | null>(
    null
  );
  const [transitionOpportunity, setTransitionOpportunity] =
    useState<Opportunity | null>(null);
  const [pendingStageMove, setPendingStageMove] = useState<{
    id: string;
    stage: OpportunityStage;
  } | null>(null);

  // Track screen view
  useEffect(() => { trackScreenView("pipeline"); }, []);

  // Handle ?action=new from FAB navigation
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setShowQuickAdd(true);
    }
  }, [searchParams]);

  // ── Auth ───────────────────────────────────────────────────────────────
  const { company, currentUser } = useAuthStore();
  const can = usePermissionStore((s) => s.can);

  // ── Setup gate ──────────────────────────────────────────────────────
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  const gatedOpenCreate = useCallback(() => {
    if (!setupComplete) {
      setShowSetupModal(true);
      return;
    }
    setShowQuickAdd(true);
  }, [setupComplete]);

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: opportunities, isLoading: oppsLoading } = useOpportunities();
  const { data: clientsData, isLoading: clientsLoading } = useClients();
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
    refetchInterval: 30000, // refresh every 30s
  });

  const isLoading = oppsLoading || clientsLoading;

  // ── Mutations ──────────────────────────────────────────────────────────
  const moveStage = useMoveOpportunityStage();
  const updateOpportunity = useUpdateOpportunity();
  const createOpportunity = useCreateOpportunity();

  // ── Client map ─────────────────────────────────────────────────────────
  const clientMap = useMemo(() => {
    const map = new Map<string, Client>();
    if (clientsData?.clients) {
      for (const client of clientsData.clients) {
        map.set(client.id, client);
      }
    }
    return map;
  }, [clientsData]);

  // ── Active (non-deleted) opportunities ─────────────────────────────────
  const activeOpportunities = useMemo(() => {
    if (!opportunities) return [];
    return opportunities.filter((o) => !o.deletedAt);
  }, [opportunities]);

  // ── Metrics ────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const active = activeOpportunities.filter((o) => isActiveStage(o.stage));
    const won = activeOpportunities.filter(
      (o) => o.stage === OpportunityStage.Won
    );
    const lost = activeOpportunities.filter(
      (o) => o.stage === OpportunityStage.Lost
    );

    const pipelineValue = active.reduce(
      (sum, o) => sum + (o.estimatedValue ?? 0),
      0
    );
    const activeDeals = active.length;
    const wonDeals = won.length;
    const lostDeals = lost.length;
    const conversionRate =
      wonDeals + lostDeals > 0
        ? Math.round((wonDeals / (wonDeals + lostDeals)) * 100)
        : 0;

    return { pipelineValue, activeDeals, wonDeals, conversionRate };
  }, [activeOpportunities]);

  // ── Stage counts for bottom bar ────────────────────────────────────────
  const stageCounts = useMemo(() => {
    const counts = new Map<OpportunityStage, number>();
    for (const stage of getAllStages()) {
      counts.set(stage, 0);
    }
    // Apply same filters as the board to keep counts in sync
    const query = searchQuery.toLowerCase().trim();
    for (const opp of activeOpportunities) {
      // Stage filter
      if (stageFilter && opp.stage !== stageFilter) continue;
      // Search filter
      if (query) {
        const clientName = opp.clientId
          ? (clientMap.get(opp.clientId)?.name ?? "")
          : "";
        const contactName = opp.contactName ?? "";
        const title = opp.title ?? "";
        const matches =
          clientName.toLowerCase().includes(query) ||
          contactName.toLowerCase().includes(query) ||
          title.toLowerCase().includes(query);
        if (!matches) continue;
      }
      counts.set(opp.stage, (counts.get(opp.stage) ?? 0) + 1);
    }
    return counts;
  }, [activeOpportunities, searchQuery, stageFilter, clientMap]);

  // ── Handlers ───────────────────────────────────────────────────────────

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
            toast.success(`${t("toast.movedTo")} ${getStageDisplayName(newStage)}`, {
              description: opp.title,
            });
          },
          onError: (error) => {
            toast.error(t("toast.failedMove"), {
              description:
                error instanceof Error ? error.message : t("toast.errorOccurred"),
            });
          },
        }
      );
    },
    [activeOpportunities, moveStage, currentUser]
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

      // Move stage
      moveStage.mutate(
        { id, stage, userId: currentUser?.id },
        {
          onSuccess: () => {
            // Update opportunity with additional data
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
              stage === OpportunityStage.Won ? t("toast.dealMarkedWon") : t("toast.dealMarkedLost");
            toast.success(toastMsg, {
              description: transitionOpportunity.title,
            });
          },
          onError: (error) => {
            toast.error(t("toast.failedUpdate"), {
              description:
                error instanceof Error ? error.message : t("toast.errorOccurred"),
            });
          },
        }
      );

      // Clean up dialog state
      setTransitionType(null);
      setTransitionOpportunity(null);
      setPendingStageMove(null);
    },
    [pendingStageMove, transitionOpportunity, moveStage, updateOpportunity, currentUser]
  );

  /** Cancel Won/Lost transition */
  const handleTransitionCancel = useCallback(() => {
    setTransitionType(null);
    setTransitionOpportunity(null);
    setPendingStageMove(null);
  }, []);

  /** Handle quick add form submission */
  const handleQuickAdd = useCallback(
    (data: {
      title: string;
      contactName: string;
      estimatedValue?: number;
    }) => {
      if (!can("pipeline.manage")) return;
      if (!company) return;

      createOpportunity.mutate(
        {
          companyId: company.id,
          clientId: null,
          title: data.title,
          description: null,
          contactName: data.contactName,
          contactEmail: null,
          contactPhone: null,
          stage: OpportunityStage.NewLead,
          source: null,
          assignedTo: currentUser?.id ?? null,
          priority: null,
          estimatedValue: data.estimatedValue ?? null,
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
            toast.success(t("toast.newLeadCreated"), {
              description: data.title,
            });
            setShowQuickAdd(false);
          },
          onError: (error) => {
            toast.error(t("toast.failedCreateLead"), {
              description:
                error instanceof Error ? error.message : t("toast.errorOccurred"),
            });
          },
        }
      );
    },
    [company, currentUser, createOpportunity]
  );

  /** Open detail sheet for an opportunity */
  const handleSelectOpportunity = useCallback((opp: Opportunity) => {
    setSelectedOpportunity(opp);
  }, []);

  // ── All stages for filter dropdown ─────────────────────────────────────
  const allStages = getAllStages();

  // ── Loading state ──────────────────────────────────────────────────────
  if (isLoading) {
    return <PipelineSkeleton />;
  }

  const totalDeals = activeOpportunities.length;

  return (
    <div className="flex flex-col h-full space-y-2 min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-kosugi text-caption-sm text-text-tertiary">
                {t("subtitle")}
              </p>
              <span className="font-mono text-[11px] text-text-disabled">
                {totalDeals} deal{totalDeals !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <div className="max-w-[250px]">
              <Input
                placeholder={t("search.placeholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                prefixIcon={<Search className="w-[16px] h-[16px]" />}
                suffixIcon={
                  searchQuery ? (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-text-disabled hover:text-text-tertiary cursor-pointer"
                    >
                      <X className="w-[14px] h-[14px]" />
                    </button>
                  ) : undefined
                }
              />
            </div>
            <Button
              variant={showFilters ? "default" : "secondary"}
              size="sm"
              className="gap-[6px]"
              onClick={() => setShowFilters(!showFilters)}
            >
              <ListFilter className="w-[14px] h-[14px]" />
              {t("filter")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="gap-[6px]"
              onClick={() => setShowInboxLeads(!showInboxLeads)}
            >
              <Mail className="w-[14px] h-[14px]" />
              {t("inbox")}
            </Button>
            {reviewCount > 0 && (
              <button
                onClick={() => setReviewPanelOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#417394]/15 text-[#8BB8D4] text-xs font-medium hover:bg-[#417394]/25 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                Review Emails
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#417394] text-[9px] font-bold text-white">
                  {reviewCount > 99 ? "99+" : reviewCount}
                </span>
              </button>
            )}
            {can("pipeline.manage") && (
              <Button
                variant="default"
                size="sm"
                className="gap-[6px]"
                onClick={() => setShowQuickAdd(true)}
              >
                <Plus className="w-[14px] h-[14px]" />
                {t("newLead")}
              </Button>
            )}
          </div>
        </div>

        {/* Metrics bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {/* Pipeline Value */}
          <Card className="p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center shrink-0">
              <DollarSign className="w-[16px] h-[16px] text-ops-accent" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                {t("metrics.pipelineValue")}
              </span>
              <span className="font-mono text-data text-ops-accent">
                {formatCurrency(metrics.pipelineValue)}
              </span>
            </div>
          </Card>

          {/* Active Deals */}
          <Card className="p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-amber-muted flex items-center justify-center shrink-0">
              <Target className="w-[16px] h-[16px] text-ops-amber" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                {t("metrics.activeDeals")}
              </span>
              <span className="font-mono text-data text-ops-amber">
                {metrics.activeDeals}
              </span>
            </div>
          </Card>

          {/* Won */}
          <Card className="p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-status-success/15 flex items-center justify-center shrink-0">
              <TrendingUp className="w-[16px] h-[16px] text-status-success" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                {t("metrics.won")}
              </span>
              <span className="font-mono text-data text-status-success">
                {metrics.wonDeals}
              </span>
            </div>
          </Card>

          {/* Conversion Rate */}
          <Card className="p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0">
              <TrendingUp className="w-[16px] h-[16px] text-text-secondary" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                {t("metrics.conversion")}
              </span>
              <span className="font-mono text-data text-text-primary">
                {metrics.conversionRate}%
              </span>
            </div>
          </Card>
        </div>

        {/* Expanded filter panel */}
        {showFilters && (
          <Card className="p-1.5 animate-slide-up">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  {t("filter.stage")}
                </span>
                <select
                  value={stageFilter ?? ""}
                  onChange={(e) =>
                    setStageFilter(
                      e.target.value
                        ? (e.target.value as OpportunityStage)
                        : null
                    )
                  }
                  className={cn(
                    "bg-background-input text-text-primary font-mohave text-body-sm",
                    "px-1.5 py-[6px] rounded border border-border",
                    "focus:border-ops-accent focus:outline-none",
                    "cursor-pointer"
                  )}
                >
                  <option value="">{t("filter.allStages")}</option>
                  {allStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {getStageDisplayName(stage)}
                    </option>
                  ))}
                </select>
              </div>

              {(stageFilter || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-[4px] text-ops-error"
                  onClick={() => {
                    setStageFilter(null);
                    setSearchQuery("");
                  }}
                >
                  <X className="w-[12px] h-[12px]" />
                  {t("filter.clear")}
                </Button>
              )}

              {stageFilter && (
                <Badge variant="info" className="gap-[4px]">
                  {t("filter.stage")}: {getStageDisplayName(stageFilter)}
                  <button
                    onClick={() => setStageFilter(null)}
                    className="hover:text-white cursor-pointer"
                  >
                    <X className="w-[10px] h-[10px]" />
                  </button>
                </Badge>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Gmail connect prompt */}
      {gmailConnections.length === 0 && !gmailBannerDismissed && (
        <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[rgba(65,115,148,0.08)] border border-ops-accent/20 animate-fade-in">
          <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center shrink-0">
            <Mail className="w-[16px] h-[16px] text-ops-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mohave text-body text-text-primary">{t("gmail.connectBanner")}</p>
            <p className="font-kosugi text-[11px] text-text-disabled">
              {t("gmail.connectDesc")}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              className="gap-[6px]"
              onClick={() => {
                const params = new URLSearchParams({ companyId: company?.id ?? "", type: "company" });
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

      {/* Mutation loading indicator */}
      {moveStage.isPending && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded bg-ops-accent-muted border border-ops-accent/30">
          <Loader2 className="w-[14px] h-[14px] text-ops-accent animate-spin" />
          <span className="font-kosugi text-[11px] text-ops-accent">
            {t("column.updating")}
          </span>
        </div>
      )}

      {/* Quick Add Form (inline overlay at top) */}
      {showQuickAdd && (
        <div className="shrink-0">
          <div className="max-w-[280px]">
            <QuickAddForm
              onSubmit={handleQuickAdd}
              onCancel={() => setShowQuickAdd(false)}
            />
          </div>
        </div>
      )}

      {/* Pipeline Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-1 min-w-0">
        <PipelineBoard
          opportunities={activeOpportunities}
          clientMap={clientMap}
          searchQuery={searchQuery}
          stageFilter={stageFilter}
          onMoveStage={handleMoveStage}
          onAdvanceStage={handleAdvanceStage}
          onSelectOpportunity={handleSelectOpportunity}
          onAddLead={() => setShowQuickAdd(true)}
        />
      </div>

      {/* Bottom summary bar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-2 py-1 rounded bg-background-panel border border-border min-w-0">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {getAllStages().map((stage) => (
            <div key={stage} className="flex items-center gap-[6px]">
              <span
                className="w-[6px] h-[6px] rounded-full shrink-0"
                style={{ backgroundColor: getStageColor(stage) }}
              />
              <span className="font-mono text-[10px] text-text-disabled whitespace-nowrap">
                {getStageDisplayName(stage)}: {stageCounts.get(stage) ?? 0}
              </span>
            </div>
          ))}
        </div>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase shrink-0">
          {t("bottomBar")}
        </span>
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

      {/* Inbox Leads */}
      {showInboxLeads && (
        <div className="shrink-0">
          <InboxLeadsQueue
            onCreateLead={(prefill) => {
              setShowInboxLeads(false);
              if (company) {
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
              }
            }}
            className="max-w-[600px]"
          />
        </div>
      )}

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
          if (company) {
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
          }
        }}
      />

      {/* Setup interception modal */}
      <SetupInterceptionModal
        isOpen={showSetupModal}
        onComplete={() => {
          setShowSetupModal(false);
          setShowQuickAdd(true);
        }}
        onDismiss={() => {
          setShowSetupModal(false);
        }}
        missingSteps={missingSteps}
        triggerAction="leads"
      />
    </div>
  );
}

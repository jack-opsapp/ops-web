"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
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
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useOpportunities,
  useClients,
  useMoveOpportunityStage,
  useUpdateOpportunity,
  useCreateOpportunity,
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

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------
function PipelineSkeleton() {
  const stages = PIPELINE_STAGES_DEFAULT;

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-kosugi text-caption-sm text-text-tertiary">
            Loading pipeline...
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="flex-1 p-1 flex items-center gap-1.5">
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
  // ── State ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showInboxLeads, setShowInboxLeads] = useState(false);

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

  // ── Auth ───────────────────────────────────────────────────────────────
  const { company, currentUser } = useAuthStore();

  // ── Page actions ───────────────────────────────────────────────────────
  const setActions = usePageActionsStore((s) => s.setActions);
  const clearActions = usePageActionsStore((s) => s.clearActions);

  useEffect(() => {
    setActions([
      {
        label: "New Lead",
        icon: Plus,
        onClick: () => setShowQuickAdd(true),
        shortcut: "\u2318\u21E7L",
      },
    ]);
    return () => clearActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions, clearActions]);

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: opportunities, isLoading: oppsLoading } = useOpportunities();
  const { data: clientsData, isLoading: clientsLoading } = useClients();

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
            toast.success(`Moved to ${getStageDisplayName(newStage)}`, {
              description: opp.title,
            });
          },
          onError: (error) => {
            toast.error("Failed to move deal", {
              description:
                error instanceof Error ? error.message : "An error occurred",
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

            const action =
              stage === OpportunityStage.Won ? "marked as Won" : "marked as Lost";
            toast.success(`Deal ${action}`, {
              description: transitionOpportunity.title,
            });
          },
          onError: (error) => {
            toast.error("Failed to update deal", {
              description:
                error instanceof Error ? error.message : "An error occurred",
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
          address: null,
          tags: [],
        },
        {
          onSuccess: () => {
            toast.success("New lead created", {
              description: data.title,
            });
            setShowQuickAdd(false);
          },
          onError: (error) => {
            toast.error("Failed to create lead", {
              description:
                error instanceof Error ? error.message : "An error occurred",
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
    <div className="flex flex-col h-full space-y-2">
      {/* Header */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-kosugi text-caption-sm text-text-tertiary">
                Drag deals between stages
              </p>
              <span className="font-mono text-[11px] text-text-disabled">
                {totalDeals} deal{totalDeals !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="max-w-[250px]">
              <Input
                placeholder="Search deals..."
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
              Filter
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="gap-[6px]"
              onClick={() => setShowInboxLeads(!showInboxLeads)}
            >
              <Mail className="w-[14px] h-[14px]" />
              Inbox
            </Button>
            <Button
              variant="default"
              size="sm"
              className="gap-[6px]"
              onClick={() => setShowQuickAdd(true)}
            >
              <Plus className="w-[14px] h-[14px]" />
              New Lead
            </Button>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="flex items-center gap-2">
          {/* Pipeline Value */}
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center shrink-0">
              <DollarSign className="w-[16px] h-[16px] text-ops-accent" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Pipeline Value
              </span>
              <span className="font-mono text-data text-ops-accent">
                {formatCurrency(metrics.pipelineValue)}
              </span>
            </div>
          </Card>

          {/* Active Deals */}
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-amber-muted flex items-center justify-center shrink-0">
              <Target className="w-[16px] h-[16px] text-ops-amber" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Active Deals
              </span>
              <span className="font-mono text-data text-ops-amber">
                {metrics.activeDeals}
              </span>
            </div>
          </Card>

          {/* Won */}
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-status-success/15 flex items-center justify-center shrink-0">
              <TrendingUp className="w-[16px] h-[16px] text-status-success" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Won
              </span>
              <span className="font-mono text-data text-status-success">
                {metrics.wonDeals}
              </span>
            </div>
          </Card>

          {/* Conversion Rate */}
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0">
              <TrendingUp className="w-[16px] h-[16px] text-text-secondary" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Conversion
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
                  Stage
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
                  <option value="">All Stages</option>
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
                  Clear Filters
                </Button>
              )}

              {stageFilter && (
                <Badge variant="info" className="gap-[4px]">
                  Stage: {getStageDisplayName(stageFilter)}
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

      {/* Mutation loading indicator */}
      {moveStage.isPending && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded bg-ops-accent-muted border border-ops-accent/30">
          <Loader2 className="w-[14px] h-[14px] text-ops-accent animate-spin" />
          <span className="font-kosugi text-[11px] text-ops-accent">
            Updating pipeline...
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
      <div className="flex-1 overflow-x-auto pb-2">
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
      <div className="shrink-0 flex items-center justify-between px-2 py-1 rounded bg-background-panel border border-border">
        <div className="flex items-center gap-3">
          {getAllStages().map((stage) => (
            <div key={stage} className="flex items-center gap-[6px]">
              <span
                className="w-[6px] h-[6px] rounded-full"
                style={{ backgroundColor: getStageColor(stage) }}
              />
              <span className="font-mono text-[10px] text-text-disabled">
                {getStageDisplayName(stage)}: {stageCounts.get(stage) ?? 0}
              </span>
            </div>
          ))}
        </div>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase">
          Drag cards between columns to update stage
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
                    address: null,
                    tags: [],
                  },
                  {
                    onSuccess: () => {
                      toast.success("Lead created from email", {
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
    </div>
  );
}

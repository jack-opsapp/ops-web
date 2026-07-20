"use client";

import { useState, useMemo, useCallback, type ReactNode } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  type PipelineStageDefault,
  OpportunityStage,
  PIPELINE_STAGES_DEFAULT,
  getAllStages,
  isTerminalStage,
  nextOpportunityStage,
  previousOpportunityStage,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import {
  pipelineTabVariants,
  pipelineTabVariantsReduced,
} from "@/lib/utils/motion";
import { PipelineStageTabBar } from "./pipeline-stage-tab-bar";
import { PipelineCard } from "./pipeline-card";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineMobileProps {
  opportunities: Opportunity[];
  clients: Map<string, string>;
  expandedCardId: string | null;
  onToggleExpand: (id: string) => void;
  onMoveStage: (opportunityId: string, newStage: OpportunityStage) => void;
  onLogCall: (opportunityId: string) => void;
  onLogText: (opportunityId: string) => void;
  onAddNote: (opportunityId: string, note: string) => void;
  onArchive: (opportunityId: string) => void;
  onDiscard: (opportunityId: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onConvert: (opportunity: Opportunity) => void;
  onOpenDetail: (opportunity: Opportunity) => void;
  onAssign: (opportunityId: string) => void;
  onScheduleFollowUp: (opportunityId: string) => void;
  onAddLead: () => void;
  leadAccessById?: ReadonlyMap<string, LeadAccess>;
  /**
   * Page-level banners (email connect, inbox leads queue, move-pending chip).
   * Rendered IN FLOW below the stage tab bar — never floated over the cards,
   * so a banner can never intercept a card tap (audit P1-4).
   */
  banner?: ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_STAGES = getAllStages();

const SWIPE_OFFSET_THRESHOLD = 80;
const SWIPE_VELOCITY_THRESHOLD = 300;
const SWIPE_HINT_OFFSET = 40;

/** Look up the stage config from PIPELINE_STAGES_DEFAULT by slug */
function findStageConfig(stage: OpportunityStage): PipelineStageDefault {
  return (
    PIPELINE_STAGES_DEFAULT.find((s) => s.slug === stage) ??
    PIPELINE_STAGES_DEFAULT[0]
  );
}

// ---------------------------------------------------------------------------
// SwipeableCard — wraps PipelineCard with drag-to-advance/retreat
// ---------------------------------------------------------------------------

interface SwipeableCardProps {
  opportunity: Opportunity;
  clientName: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAdvance: () => void;
  onRetreat: () => void;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onConvert?: () => void;
  onOpenDetail: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  canManage: boolean;
  canAssign: boolean;
  canConvert: boolean;
  stageConfig: PipelineStageDefault;
  reducedMotion: boolean;
  t: (key: string) => string;
}

function SwipeableCard({
  opportunity,
  clientName,
  isExpanded,
  onToggleExpand,
  onAdvance,
  onRetreat,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onConvert,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  canManage,
  canAssign,
  canConvert,
  stageConfig,
  reducedMotion,
  t,
}: SwipeableCardProps) {
  const terminal = isTerminalStage(opportunity.stage);
  const rawNext = nextOpportunityStage(opportunity.stage);
  // Advancing into Won is a conversion — treat Won as no-next when the operator
  // can't convert, so neither the swipe-advance nor its hint strip engages.
  const next = rawNext === OpportunityStage.Won && !canConvert ? null : rawNext;
  const prev = previousOpportunityStage(opportunity.stage);

  const dragX = useMotionValue(0);

  // Advance strip opacity: visible when dragging right past hint threshold
  const advanceOpacity = useTransform(
    dragX,
    [0, SWIPE_HINT_OFFSET, SWIPE_OFFSET_THRESHOLD],
    [0, 0.6, 1]
  );

  // Retreat strip opacity: visible when dragging left past hint threshold
  const retreatOpacity = useTransform(
    dragX,
    [0, -SWIPE_HINT_OFFSET, -SWIPE_OFFSET_THRESHOLD],
    [0, 0.6, 1]
  );

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (terminal || !canManage) return;

      const { offset, velocity } = info;

      // Advance (swipe right)
      if (
        next &&
        (offset.x > SWIPE_OFFSET_THRESHOLD ||
          velocity.x > SWIPE_VELOCITY_THRESHOLD)
      ) {
        onAdvance();
        return;
      }

      // Retreat (swipe left)
      if (
        prev &&
        (offset.x < -SWIPE_OFFSET_THRESHOLD ||
          velocity.x < -SWIPE_VELOCITY_THRESHOLD)
      ) {
        onRetreat();
        return;
      }
    },
    [terminal, canManage, next, prev, onAdvance, onRetreat]
  );

  const swipeEnabled = !terminal && !reducedMotion && canManage;

  return (
    <div className="relative">
      {/* Advance hint strip (behind card, right swipe) */}
      {swipeEnabled && next && (
        <motion.div
          className="absolute inset-0 flex items-center justify-end rounded-chip border border-olive-line bg-olive-soft px-[12px]"
          style={{ opacity: advanceOpacity }}
        >
          <span className="font-mono text-micro text-olive">
            {t("mobile.swipeAdvance").replace(
              "{stage}",
              getStageDisplayName(next)
            )}
          </span>
        </motion.div>
      )}

      {/* Retreat hint strip (behind card, left swipe) */}
      {swipeEnabled && prev && (
        <motion.div
          className="absolute inset-0 flex items-center justify-start rounded-chip border border-rose-line bg-rose-soft px-[12px]"
          style={{ opacity: retreatOpacity }}
        >
          <span className="font-mono text-micro text-rose">
            {t("mobile.swipeRetreat").replace(
              "{stage}",
              getStageDisplayName(prev)
            )}
          </span>
        </motion.div>
      )}

      {/* Draggable card wrapper */}
      <motion.div
        drag={swipeEnabled ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        dragSnapToOrigin
        style={{ x: dragX }}
        onDragEnd={handleDragEnd}
        className="relative"
      >
        <PipelineCard
          opportunity={opportunity}
          clientName={clientName}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onAdvance={onAdvance}
          onRetreat={onRetreat}
          onLogCall={onLogCall}
          onLogText={onLogText}
          onAddNote={onAddNote}
          onArchive={onArchive}
          onDiscard={onDiscard}
          onMarkWon={onMarkWon}
          onMarkLost={onMarkLost}
          onConvert={onConvert}
          onOpenDetail={onOpenDetail}
          onAssign={onAssign}
          onScheduleFollowUp={onScheduleFollowUp}
          canManage={canManage}
          canAssign={canAssign}
          canConvert={canConvert}
          stageConfig={stageConfig}
        />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineMobile
// ---------------------------------------------------------------------------

export function PipelineMobile({
  opportunities,
  clients,
  expandedCardId,
  onToggleExpand,
  onMoveStage,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onConvert,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  onAddLead: _onAddLead,
  leadAccessById,
  banner,
}: PipelineMobileProps) {
  const { t } = useDictionary("pipeline");
  const prefersReducedMotion = useReducedMotion();

  const [activeStage, setActiveStage] = useState<OpportunityStage>(
    OpportunityStage.NewLead
  );

  // ── Stage counts for the tab bar ───────────────────────────────────
  const stageCounts = useMemo(() => {
    const counts = {} as Record<OpportunityStage, number>;
    for (const stage of ALL_STAGES) {
      counts[stage] = 0;
    }
    for (const opp of opportunities) {
      if (counts[opp.stage] !== undefined) {
        counts[opp.stage]++;
      }
    }
    return counts;
  }, [opportunities]);

  // ── Filter opportunities for active stage ──────────────────────────
  const stageOpportunities = useMemo(
    () => opportunities.filter((opp) => opp.stage === activeStage),
    [opportunities, activeStage]
  );

  // ── Resolve client name ────────────────────────────────────────────
  const resolveClientName = useCallback(
    (opp: Opportunity): string => {
      if (opp.clientId) {
        return (
          clients.get(opp.clientId) ?? opp.contactName ?? t("card.unknown")
        );
      }
      return opp.contactName ?? t("newLead");
    },
    [clients, t]
  );

  // ── Handle stage advance/retreat via swipe ─────────────────────────
  const handleAdvance = useCallback(
    (opp: Opportunity) => {
      const next = nextOpportunityStage(opp.stage);
      if (next) onMoveStage(opp.id, next);
    },
    [onMoveStage]
  );

  const handleRetreat = useCallback(
    (opp: Opportunity) => {
      const prev = previousOpportunityStage(opp.stage);
      if (prev) onMoveStage(opp.id, prev);
    },
    [onMoveStage]
  );

  // ── Pick animation variants ────────────────────────────────────────
  const tabVariants = prefersReducedMotion
    ? pipelineTabVariantsReduced
    : pipelineTabVariants;

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border-subtle">
        <PipelineStageTabBar
          stages={ALL_STAGES}
          counts={stageCounts}
          activeStage={activeStage}
          onStageChange={setActiveStage}
        />
      </div>

      {/* Banners — in flow, full width, below the tab bar. They push the card
          list down instead of floating over it. */}
      {banner ? (
        <div
          data-testid="pipeline-mobile-banner"
          className="flex shrink-0 flex-col gap-1 px-[8px] pt-[8px] empty:hidden"
        >
          {banner}
        </div>
      ) : null}

      {/* Card list */}
      <div className="scrollbar-hide flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStage}
            variants={tabVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="flex flex-col gap-[6px] p-[8px]"
          >
            {stageOpportunities.length === 0 ? (
              /* ── Empty state ───────────────────────────────────── */
              <div className="flex flex-col items-center justify-center gap-[8px] py-[64px]">
                <span className="font-mohave text-body text-text-mute">
                  {t("empty.noDeals")}
                </span>
                <span className="font-mono text-micro text-text-mute">
                  {t("empty.swipeHint")}
                </span>
              </div>
            ) : (
              /* ── Card list ────────────────────────────────────── */
              stageOpportunities.map((opp) => {
                const stageConfig = findStageConfig(opp.stage);
                const access = leadAccessById?.get(opp.id) ?? {
                  canView: true,
                  canEdit: false,
                  canAssign: false,
                  canUnassign: false,
                  canConvert: false,
                };

                return (
                  <SwipeableCard
                    key={opp.id}
                    opportunity={opp}
                    clientName={resolveClientName(opp)}
                    isExpanded={expandedCardId === opp.id}
                    onToggleExpand={() => onToggleExpand(opp.id)}
                    onAdvance={() => handleAdvance(opp)}
                    onRetreat={() => handleRetreat(opp)}
                    onLogCall={() => onLogCall(opp.id)}
                    onLogText={() => onLogText(opp.id)}
                    onAddNote={(note) => onAddNote(opp.id, note)}
                    onArchive={() => onArchive(opp.id)}
                    onDiscard={() => onDiscard(opp.id)}
                    onMarkWon={() => onMarkWon(opp)}
                    onMarkLost={() => onMarkLost(opp)}
                    onConvert={
                      opp.stage === OpportunityStage.Won && !opp.projectId
                        ? () => onConvert(opp)
                        : undefined
                    }
                    onOpenDetail={() => onOpenDetail(opp)}
                    onAssign={() => onAssign(opp.id)}
                    onScheduleFollowUp={() => onScheduleFollowUp(opp.id)}
                    canManage={access.canEdit}
                    canAssign={access.canAssign}
                    canConvert={access.canConvert}
                    stageConfig={stageConfig}
                    reducedMotion={!!prefersReducedMotion}
                    t={t}
                  />
                );
              })
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

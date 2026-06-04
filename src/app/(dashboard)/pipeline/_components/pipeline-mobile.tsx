"use client";

import { useState, useMemo, useCallback } from "react";
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
  canManage: boolean;
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
  stageConfig,
  reducedMotion,
  t,
}: SwipeableCardProps) {
  const terminal = isTerminalStage(opportunity.stage);
  const next = nextOpportunityStage(opportunity.stage);
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
          className="absolute inset-0 flex items-center justify-end px-[12px] rounded-[4px] bg-[rgba(157,181,130,0.15)] border border-[rgba(157,181,130,0.3)]"
          style={{ opacity: advanceOpacity }}
        >
          <span className="font-mono text-micro text-[#9DB582]">
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
          className="absolute inset-0 flex items-center justify-start px-[12px] rounded-[4px] bg-[rgba(181,130,137,0.15)] border border-[rgba(181,130,137,0.3)]"
          style={{ opacity: retreatOpacity }}
        >
          <span className="font-mono text-micro text-[#B58289]">
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
  canManage,
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
        return clients.get(opp.clientId) ?? opp.contactName ?? t("card.unknown");
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
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-[rgba(255,255,255,0.06)]">
        <PipelineStageTabBar
          stages={ALL_STAGES}
          counts={stageCounts}
          activeStage={activeStage}
          onStageChange={setActiveStage}
        />
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStage}
            variants={tabVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="p-[8px] flex flex-col gap-[6px]"
          >
            {stageOpportunities.length === 0 ? (
              /* ── Empty state ───────────────────────────────────── */
              <div className="flex flex-col items-center justify-center py-[64px] gap-[8px]">
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
                    canManage={canManage}
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

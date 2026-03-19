"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  type PipelineStageDefault,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  PIPELINE_STAGES_DEFAULT,
  getStageDisplayName,
  formatCurrency,
} from "@/lib/types/pipeline";
import {
  pipelineColumnStagger,
  pipelineColumnStaggerReduced,
  pipelineCardEntryVariants,
  pipelineCardEntryVariantsReduced,
} from "@/lib/utils/motion";
import { PipelineCard } from "./pipeline-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineColumnProps {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  clients: Map<string, string>;
  expandedCardId: string | null;
  onToggleExpand: (id: string) => void;
  onAdvance: (opportunity: Opportunity) => void;
  onRetreat: (opportunity: Opportunity) => void;
  onLogCall: (opportunityId: string) => void;
  onLogText: (opportunityId: string) => void;
  onAddNote: (opportunityId: string, note: string) => void;
  onArchive: (opportunityId: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onOpenDetail: (opportunity: Opportunity) => void;
  onAssign: (opportunityId: string) => void;
  onScheduleFollowUp: (opportunityId: string) => void;
  onAddLead?: () => void;
  canManage: boolean;
  activeId: string | null;
  isTerminal: boolean;
}

// ---------------------------------------------------------------------------
// DraggableCard — wraps PipelineCard with dnd-kit useDraggable
// ---------------------------------------------------------------------------
function DraggableCard({
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
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  canManage,
  stageConfig,
}: {
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
  onMarkWon: () => void;
  onMarkLost: () => void;
  onOpenDetail: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  canManage: boolean;
  stageConfig: PipelineStageDefault;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: opportunity.id,
    data: { opportunity },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
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
        onMarkWon={onMarkWon}
        onMarkLost={onMarkLost}
        onOpenDetail={onOpenDetail}
        onAssign={onAssign}
        onScheduleFollowUp={onScheduleFollowUp}
        canManage={canManage}
        isDragging={isDragging}
        stageConfig={stageConfig}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineColumn
// ---------------------------------------------------------------------------
export function PipelineColumn({
  stage,
  opportunities,
  clients,
  expandedCardId,
  onToggleExpand,
  onAdvance,
  onRetreat,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  onAddLead,
  canManage,
  activeId,
  isTerminal,
}: PipelineColumnProps) {
  const { t } = useDictionary("pipeline");
  const prefersReducedMotion = useReducedMotion();

  // ── Droppable ──────────────────────────────────────────────────────────
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  // ── Derived values ─────────────────────────────────────────────────────
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];
  const stageName = getStageDisplayName(stage);

  const columnValue = useMemo(
    () => opportunities.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0),
    [opportunities]
  );

  const stageConfig = useMemo(
    () =>
      PIPELINE_STAGES_DEFAULT.find((s) => s.slug === stage) ??
      PIPELINE_STAGES_DEFAULT[0],
    [stage]
  );

  // ── Motion variants ────────────────────────────────────────────────────
  const containerVariants = prefersReducedMotion
    ? pipelineColumnStaggerReduced
    : pipelineColumnStagger;

  const cardVariants = prefersReducedMotion
    ? pipelineCardEntryVariantsReduced
    : pipelineCardEntryVariants;

  // ── Client name resolver ───────────────────────────────────────────────
  const resolveClientName = (opp: Opportunity): string => {
    if (opp.clientId) {
      return clients.get(opp.clientId) ?? opp.contactName ?? t("card.unknown");
    }
    return opp.contactName ?? t("card.unknown");
  };

  // ── Show add lead button only on NewLead stage with permission ─────────
  const showAddLead =
    stage === OpportunityStage.NewLead && !!onAddLead && canManage;

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">

      {/* ── Column header ──────────────────────────────────────────────── */}
      <div
        className="border-t-[3px] bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] rounded-t-[4px] px-[10px] py-[8px]"
        style={{ borderTopColor: stageColor }}
      >
        <div className="flex items-center justify-between">
          <span className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest">
            {stageName}
          </span>

          {showAddLead && (
            <button
              type="button"
              onClick={onAddLead}
              className="p-[2px] rounded-[2px] text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-all duration-150 cursor-pointer"
              title={t("column.addNewLead")}
            >
              <Plus className="w-[14px] h-[14px]" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-[6px] mt-[2px]">
          <span className="font-mohave text-body-lg text-text-primary">
            {opportunities.length}
          </span>
          {columnValue > 0 && (
            <>
              <span className="font-mohave text-body-lg text-text-disabled">
                /
              </span>
              <span className="font-mohave text-body-lg text-text-primary">
                {formatCurrency(columnValue)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Card container (droppable zone) ────────────────────────────── */}
      {opportunities.length > 0 ? (
        <motion.div
          ref={setNodeRef}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={cn(
            "flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-[6px] p-[6px]",
            isOver && "bg-[rgba(89,119,148,0.08)]"
          )}
        >
          {opportunities.map((opp) => (
            <motion.div key={opp.id} variants={cardVariants}>
              <DraggableCard
                opportunity={opp}
                clientName={resolveClientName(opp)}
                isExpanded={expandedCardId === opp.id}
                onToggleExpand={() => onToggleExpand(opp.id)}
                onAdvance={() => onAdvance(opp)}
                onRetreat={() => onRetreat(opp)}
                onLogCall={() => onLogCall(opp.id)}
                onLogText={() => onLogText(opp.id)}
                onAddNote={(note) => onAddNote(opp.id, note)}
                onArchive={() => onArchive(opp.id)}
                onMarkWon={() => onMarkWon(opp)}
                onMarkLost={() => onMarkLost(opp)}
                onOpenDetail={() => onOpenDetail(opp)}
                onAssign={() => onAssign(opp.id)}
                onScheduleFollowUp={() => onScheduleFollowUp(opp.id)}
                canManage={canManage}
                stageConfig={stageConfig}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        /* ── Empty state ─────────────────────────────────────────────── */
        <div
          ref={setNodeRef}
          className={cn(
            "border border-dashed border-[rgba(255,255,255,0.06)] rounded-[4px] flex-1 flex flex-col items-center justify-center gap-[4px] min-h-[120px]",
            isOver && "bg-[rgba(89,119,148,0.08)]"
          )}
        >
          <span className="font-mohave text-body-sm text-text-disabled">
            {t("empty.noDeals")}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled hidden md:block">
            {t("empty.dropHere")}
          </span>
        </div>
      )}
    </div>
  );
}

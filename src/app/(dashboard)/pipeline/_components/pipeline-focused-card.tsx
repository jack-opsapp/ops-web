"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getActiveStages,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import { usePipelineModeStore } from "./pipeline-mode-store";
import {
  PipelineCardContent,
  type PipelineCardActionHandlers,
  type PipelineCardEditHandlers,
} from "./pipeline-card-content";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";

interface PipelineFocusedCardProps
  extends
    Omit<PipelineCardActionHandlers, "onOpenDetail">,
    Partial<PipelineCardEditHandlers> {
  opportunity: Opportunity;
  clientName: string;
  clients?: Client[];
  stageColor: string;
  stalenessOpacity: number;
  /** @deprecated Product callers must provide row-specific `leadAccess`. */
  canManage?: boolean;
  leadAccess: LeadAccess;
  onMoveStage: (opportunity: Opportunity, stage: OpportunityStage) => void;
}

export const PipelineFocusedCard = memo(function PipelineFocusedCard({
  opportunity,
  clientName,
  clients = [],
  stageColor,
  stalenessOpacity,
  leadAccess,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onConvert,
  onAssign,
  onScheduleFollowUp,
  onMoveStage,
  onTitleSave,
  onValueSave,
  onLinkClient,
  onCreateAndLinkClient,
  onAddressSave,
}: PipelineFocusedCardProps) {
  const { t } = useDictionary("pipeline");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: opportunity.id,
      data: { opportunity, mode: "focused" },
      disabled: !leadAccess.canEdit,
    });

  const openDetailPanel = useCallback(() => {
    usePipelineModeStore.getState().openDetailPanel(opportunity.id);
  }, [opportunity.id]);

  const openDetailLabel = `${t("focused.openDetail.label")}: ${opportunity.title || clientName}`;
  const previousStage = getFocusedAdjacentStage(opportunity.stage, -1);
  const nextStage = getFocusedAdjacentStage(opportunity.stage, 1);

  return (
    <article
      ref={setNodeRef}
      data-pipeline-transition-card
      data-opportunity-id={opportunity.id}
      data-focused-dragging={isDragging ? "true" : undefined}
      className={cn("relative w-full select-none", isDragging && "opacity-35")}
    >
      <div className="min-w-0">
        <PipelineCardContent
          opportunity={opportunity}
          clientName={clientName}
          clients={clients}
          stageColor={stageColor}
          stalenessOpacity={stalenessOpacity}
          density="comfortable"
          surfaceVariant="focused"
          canManage={leadAccess.canEdit}
          canAssign={leadAccess.canAssign}
          canConvert={leadAccess.canConvert}
          isHovered={isDragging}
          openDetailLabel={openDetailLabel}
          onLogCall={onLogCall}
          onLogText={onLogText}
          onAddNote={onAddNote}
          onArchive={onArchive}
          onDiscard={onDiscard}
          onMarkWon={onMarkWon}
          onMarkLost={onMarkLost}
          onConvert={onConvert}
          onAssign={onAssign}
          onScheduleFollowUp={onScheduleFollowUp}
          onOpenDetail={openDetailPanel}
          onTitleSave={onTitleSave}
          onValueSave={onValueSave}
          onLinkClient={onLinkClient}
          onCreateAndLinkClient={onCreateAndLinkClient}
          onAddressSave={onAddressSave}
          quickStageActions={
            <FocusedQuickStageActions
              currentStage={opportunity.stage}
              canManage={leadAccess.canEdit}
              canConvert={leadAccess.canConvert}
              previousStage={previousStage}
              nextStage={nextStage}
              onMoveStage={(stage) => {
                onMoveStage(opportunity, stage);
              }}
            />
          }
          leadingAccessory={
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={t(
                "focused.dragHandle.label",
                "Drag card to another stage"
              )}
              disabled={!leadAccess.canEdit}
              className="group flex h-full w-full cursor-grab touch-none appearance-none items-center justify-center rounded-sm bg-transparent text-line transition-colors duration-150 hover:text-text-3 focus-visible:text-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ops-accent active:cursor-grabbing disabled:cursor-not-allowed disabled:text-line"
              {...(leadAccess.canEdit ? attributes : {})}
              {...(leadAccess.canEdit ? listeners : {})}
            >
              <span
                aria-hidden="true"
                className="grid grid-cols-2 gap-x-1 gap-y-1 text-current"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <span
                    key={index}
                    className="h-0.5 w-0.5 rounded-full bg-current transition-colors duration-150"
                  />
                ))}
              </span>
            </button>
          }
        />
      </div>
    </article>
  );
});

const FOCUSED_STAGE_REASSIGN_ORDER: OpportunityStage[] = [
  ...getActiveStages(),
  OpportunityStage.Won,
  OpportunityStage.Lost,
];

function getFocusedAdjacentStage(
  stage: OpportunityStage,
  direction: -1 | 1
): OpportunityStage | null {
  const index = FOCUSED_STAGE_REASSIGN_ORDER.indexOf(stage);
  if (index === -1) return null;

  return FOCUSED_STAGE_REASSIGN_ORDER[index + direction] ?? null;
}

function formatStageLabel(template: string, stage: OpportunityStage) {
  return template.replaceAll("{stage}", getStageDisplayName(stage));
}

function withHexAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${value.toString(16).padStart(2, "0").toUpperCase()}`;
}

function FocusedQuickStageActions({
  currentStage,
  canManage,
  canConvert,
  previousStage,
  nextStage,
  onMoveStage,
}: {
  currentStage: OpportunityStage;
  canManage: boolean;
  canConvert: boolean;
  previousStage: OpportunityStage | null;
  nextStage: OpportunityStage | null;
  onMoveStage: (stage: OpportunityStage) => void;
}) {
  const { t } = useDictionary("pipeline");
  // Moving a lead to Won is a conversion — hide the forward arrow when the
  // operator can't convert (mirrors the detail menu's existing Won gating).
  // The affordance simply disappears at the Won boundary; Lost is never a
  // "forward" move, so there is nothing next-eligible to surface instead.
  const advanceStage =
    nextStage === OpportunityStage.Won && !canConvert ? null : nextStage;

  return (
    <div className="flex min-w-0 items-center gap-[6px]" data-no-drag="">
      {previousStage ? (
        <QuickStageButton
          label={formatStageLabel(
            t("card.retreatStage", "Back to {stage}"),
            previousStage
          )}
          stage={previousStage}
          disabled={!canManage}
          onClick={() => onMoveStage(previousStage)}
        >
          <ChevronLeft className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </QuickStageButton>
      ) : null}
      {advanceStage ? (
        <QuickStageButton
          label={formatStageLabel(
            t("card.advanceStage", "Move to {stage}"),
            advanceStage
          )}
          stage={advanceStage}
          disabled={!canManage}
          onClick={() => onMoveStage(advanceStage)}
        >
          <ChevronRight className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </QuickStageButton>
      ) : null}
      <FocusedStageMenu
        currentStage={currentStage}
        canManage={canManage}
        canConvert={canConvert}
        onMoveStage={onMoveStage}
      />
    </div>
  );
}

function QuickStageButton({
  label,
  stage,
  disabled,
  onClick,
  children,
}: {
  label: string;
  stage: OpportunityStage;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const stageName = getStageDisplayName(stage);
  const stageColor =
    OPPORTUNITY_STAGE_COLORS[stage] ??
    OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      style={
        {
          "--target-stage": stageColor,
          "--target-stage-soft": withHexAlpha(stageColor, 0.08),
          "--target-stage-hover": withHexAlpha(stageColor, 0.18),
          "--target-stage-line": withHexAlpha(stageColor, 0.42),
        } as CSSProperties
      }
      className={cn(
        "group inline-flex h-[28px] min-w-0 max-w-[132px] items-center gap-[5px] rounded border px-[7px] font-cakemono text-cake-badge font-light uppercase leading-none",
        "border-line bg-transparent text-text-3 transition-[background-color,border-color,color,opacity] duration-150",
        "hover:border-[var(--target-stage)] hover:bg-[var(--target-stage-hover)] hover:text-text",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
        disabled && "cursor-not-allowed opacity-40 hover:text-text-2"
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
    >
      <span className="shrink-0 text-text-3 transition-colors duration-150 group-hover:text-[var(--target-stage)]">
        {children}
      </span>
      <span className="min-w-0 truncate">{stageName}</span>
    </button>
  );
}

function FocusedStageMenu({
  currentStage,
  canManage,
  canConvert,
  onMoveStage,
}: {
  currentStage: OpportunityStage;
  canManage: boolean;
  canConvert: boolean;
  onMoveStage: (stage: OpportunityStage) => void;
}) {
  const { t } = useDictionary("pipeline");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        aria-label={t("card.stageMenuLabel", "Choose stage")}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("card.stageMenuLabel", "Choose stage")}
        disabled={!canManage}
        className={cn(
          "inline-flex h-[28px] items-center gap-[5px] rounded border border-line bg-transparent px-[7px] font-cakemono text-cake-badge font-light uppercase leading-none text-text-3",
          "transition-[background-color,border-color,color,opacity] duration-150 hover:border-line-hi hover:bg-surface-hover hover:text-text",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
          !canManage && "cursor-not-allowed opacity-40"
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!canManage) return;
          setOpen((value) => !value);
        }}
      >
        <span>{t("card.stageMenu", "Stage")}</span>
        <ChevronDown className="h-[12px] w-[12px]" strokeWidth={1.5} />
      </button>

      {open
        ? createPortal(
            <FocusedStageMenuPortal
              anchorRef={anchorRef}
              currentStage={currentStage}
              canConvert={canConvert}
              onClose={() => setOpen(false)}
              onMoveStage={(stage) => {
                setOpen(false);
                onMoveStage(stage);
              }}
            />,
            document.body
          )
        : null}
    </div>
  );
}

function FocusedStageMenuPortal({
  anchorRef,
  currentStage,
  canConvert,
  onClose,
  onMoveStage,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  currentStage: OpportunityStage;
  canConvert: boolean;
  onClose: () => void;
  onMoveStage: (stage: OpportunityStage) => void;
}) {
  const { t } = useDictionary("pipeline");
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - 228, rect.left)),
      y: Math.max(8, rect.top - 6),
    });
  }, [anchorRef]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        menuRef.current?.contains(event.target as Node) ||
        anchorRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      onClose();
    }

    const frame = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handlePointerDown);
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("card.stageMenuLabel", "Choose stage")}
      className="fixed z-[3000] w-[220px] rounded-modal border border-line p-1"
      style={{
        left: position.x,
        top: position.y,
        transform: "translateY(-100%)",
        background: "var(--surface-glass-dense)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {FOCUSED_STAGE_REASSIGN_ORDER.filter(
        (stage) =>
          stage !== currentStage &&
          // Won is a conversion — omit it for operators who can't convert,
          // mirroring the quick-arrow gate and the detail menu.
          !(stage === OpportunityStage.Won && !canConvert)
      ).map((stage) => (
        <StageMenuItem
          key={stage}
          stage={stage}
          label={formatStageLabel(
            t("card.advanceStage", "Move to {stage}"),
            stage
          )}
          onMoveStage={onMoveStage}
        />
      ))}
    </div>
  );
}

function StageMenuItem({
  stage,
  label,
  onMoveStage,
}: {
  stage: OpportunityStage;
  label: string;
  onMoveStage: (stage: OpportunityStage) => void;
}) {
  const stageName = getStageDisplayName(stage);
  const stageColor =
    OPPORTUNITY_STAGE_COLORS[stage] ??
    OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];

  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      className="group flex w-full items-center gap-2 rounded px-2 py-[6px] text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
      onClick={(event) => {
        event.stopPropagation();
        onMoveStage(stage);
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-5 shrink-0 rounded-bar transition-opacity duration-150 group-hover:opacity-100"
        style={{ backgroundColor: stageColor, opacity: 0.62 }}
      />
      <span className="min-w-0 truncate font-cakemono text-cake-badge font-light uppercase leading-none text-text-2 group-hover:text-text">
        {stageName}
      </span>
    </button>
  );
}

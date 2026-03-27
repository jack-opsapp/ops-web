import type { Opportunity } from "@/lib/types/pipeline";
import {
  OpportunityStage,
  getActiveStages,
  isTerminalStage,
  OPPORTUNITY_STAGE_SORT_ORDER,
  getDaysInStage,
} from "@/lib/types/pipeline";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  STACK_GAP,
  STACK_HORIZONTAL_GAP,
  STACK_HEADER_HEIGHT,
  CANVAS_PADDING,
  TERMINAL_COLS,
  TERMINAL_GAP,
} from "./spatial-canvas-store";

// ── Types ──

export interface StackLayout {
  stage: OpportunityStage;
  headerPosition: { x: number; y: number };
  cardPositions: { opportunityId: string; x: number; y: number }[];
  regionBounds: { x: number; y: number; width: number; height: number };
}

export interface TerminalRegionLayout {
  stage: OpportunityStage;
  position: { x: number; y: number };
  cardPositions: { opportunityId: string; x: number; y: number }[];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface CanvasLayout {
  stacks: StackLayout[];
  terminalRegions: TerminalRegionLayout[];
  canvasWidth: number;
  canvasHeight: number;
}

// ── Sort helpers ──

function sortOpportunities(
  opps: Opportunity[],
  sortBy: "value" | "name" | "date" | "days_in_stage",
  clientNames: Map<string, string>
): Opportunity[] {
  const sorted = [...opps];
  switch (sortBy) {
    case "value":
      sorted.sort((a, b) => {
        if (a.estimatedValue === null && b.estimatedValue === null) return 0;
        if (a.estimatedValue === null) return 1;
        if (b.estimatedValue === null) return -1;
        return b.estimatedValue - a.estimatedValue;
      });
      break;
    case "name":
      sorted.sort((a, b) => {
        const nameA =
          clientNames.get(a.clientId ?? "") ?? a.contactName ?? "";
        const nameB =
          clientNames.get(b.clientId ?? "") ?? b.contactName ?? "";
        return nameA.localeCompare(nameB);
      });
      break;
    case "date":
      sorted.sort((a, b) => {
        const dateA = a.stageEnteredAt?.getTime() ?? 0;
        const dateB = b.stageEnteredAt?.getTime() ?? 0;
        return dateB - dateA;
      });
      break;
    case "days_in_stage":
      sorted.sort((a, b) => {
        return getDaysInStage(b) - getDaysInStage(a);
      });
      break;
  }
  return sorted;
}

// ── Main layout calculator ──

export function calculateCanvasLayout(
  opportunities: Opportunity[],
  sortBy: "value" | "name" | "date" | "days_in_stage",
  clientNames: Map<string, string>
): CanvasLayout {
  const activeStages = getActiveStages();

  // Group opportunities by stage
  const byStage = new Map<OpportunityStage, Opportunity[]>();
  for (const stage of activeStages) {
    byStage.set(stage, []);
  }
  const wonOpps: Opportunity[] = [];
  const lostOpps: Opportunity[] = [];

  for (const opp of opportunities) {
    if (opp.stage === OpportunityStage.Won) {
      wonOpps.push(opp);
    } else if (
      opp.stage === OpportunityStage.Lost ||
      opp.stage === OpportunityStage.Discarded
    ) {
      lostOpps.push(opp);
    } else {
      const arr = byStage.get(opp.stage);
      if (arr) arr.push(opp);
    }
  }

  // Sort each stage's cards
  for (const [stage, opps] of byStage) {
    byStage.set(stage, sortOpportunities(opps, sortBy, clientNames));
  }

  // Build active stage stacks (left to right, in stage order)
  const stacks: StackLayout[] = [];
  let xCursor = CANVAS_PADDING;
  let maxStackHeight = 0;

  // Only create stacks for stages that have opportunities OR are in the default active stages
  const orderedStages = activeStages.sort(
    (a, b) => OPPORTUNITY_STAGE_SORT_ORDER[a] - OPPORTUNITY_STAGE_SORT_ORDER[b]
  );

  for (const stage of orderedStages) {
    const opps = byStage.get(stage) ?? [];
    const headerPos = { x: xCursor, y: CANVAS_PADDING };

    const cardPositions = opps.map((opp, idx) => ({
      opportunityId: opp.id,
      x: xCursor,
      y: CANVAS_PADDING + STACK_HEADER_HEIGHT + idx * (CARD_HEIGHT + STACK_GAP),
    }));

    const stackContentHeight =
      STACK_HEADER_HEIGHT +
      Math.max(opps.length, 1) * (CARD_HEIGHT + STACK_GAP);

    stacks.push({
      stage,
      headerPosition: headerPos,
      cardPositions,
      regionBounds: {
        x: xCursor - 8,
        y: CANVAS_PADDING - 8,
        width: CARD_WIDTH + 16,
        height: stackContentHeight + 16,
      },
    });

    if (stackContentHeight > maxStackHeight) {
      maxStackHeight = stackContentHeight;
    }

    xCursor += CARD_WIDTH + STACK_HORIZONTAL_GAP;
  }

  // Build terminal regions (Won, Lost) to the right of active stacks
  const terminalStartX = xCursor + TERMINAL_GAP;
  const terminalRegions: TerminalRegionLayout[] = [];

  for (const [idx, config] of [
    { stage: OpportunityStage.Won, opps: wonOpps },
    { stage: OpportunityStage.Lost, opps: lostOpps },
  ].entries()) {
    const regionX = terminalStartX + idx * (TERMINAL_COLS * (CARD_WIDTH + STACK_GAP) + TERMINAL_GAP);
    const sorted = sortOpportunities(config.opps, sortBy, clientNames);

    const cardPositions = sorted.map((opp, i) => {
      const col = i % TERMINAL_COLS;
      const row = Math.floor(i / TERMINAL_COLS);
      return {
        opportunityId: opp.id,
        x: regionX + col * (CARD_WIDTH + STACK_GAP),
        y: CANVAS_PADDING + STACK_HEADER_HEIGHT + row * (CARD_HEIGHT + STACK_GAP),
      };
    });

    const cols = Math.min(sorted.length, TERMINAL_COLS);
    const rows = Math.max(1, Math.ceil(sorted.length / TERMINAL_COLS));
    const regionWidth = cols * (CARD_WIDTH + STACK_GAP);
    const regionHeight =
      STACK_HEADER_HEIGHT + rows * (CARD_HEIGHT + STACK_GAP);

    terminalRegions.push({
      stage: config.stage,
      position: { x: regionX, y: CANVAS_PADDING },
      cardPositions,
      bounds: {
        x: regionX - 8,
        y: CANVAS_PADDING - 8,
        width: Math.max(regionWidth, CARD_WIDTH) + 16,
        height: regionHeight + 16,
      },
    });

    if (regionHeight > maxStackHeight) {
      maxStackHeight = regionHeight;
    }
  }

  // Calculate total canvas dimensions
  const lastTerminal = terminalRegions[terminalRegions.length - 1];
  const canvasWidth = lastTerminal
    ? lastTerminal.bounds.x + lastTerminal.bounds.width + CANVAS_PADDING
    : xCursor + CANVAS_PADDING;
  const canvasHeight = maxStackHeight + CANVAS_PADDING * 2;

  return {
    stacks,
    terminalRegions,
    canvasWidth: Math.max(canvasWidth, 1200),
    canvasHeight: Math.max(canvasHeight, 600),
  };
}

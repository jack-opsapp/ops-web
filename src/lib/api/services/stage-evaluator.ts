// src/lib/api/services/stage-evaluator.ts
// Free-tier pipeline staging based on correspondence count and timing.
// AI-tier staging is in Plan 4 (feature-gated).

export interface ThreadState {
  outboundCount: number;
  inboundCount: number;
  totalMessages: number;
  lastMessageDirection: "in" | "out";
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  currentStage: string;
  autoFollowUpDays: number; // from company pipeline stage config
}

export interface StageEvaluation {
  stage: string;
  changed: boolean;
  reason: string;
}

const TERMINAL_STAGES = ["won", "lost", "discarded"];

const STAGE_ORDER = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
];

export function isAllowedAutomatedEmailStageTransition(
  currentStage: string,
  targetStage: string
): boolean {
  if (
    !STAGE_ORDER.includes(currentStage) ||
    !STAGE_ORDER.includes(targetStage)
  ) {
    return false;
  }
  // `new_lead` is an ingestion origin, never a later classification. The
  // remaining active stages form real sales loops (revised quotes, dormant
  // negotiations, re-engagement), so they are guarded by exact snapshots
  // rather than a false total ordering.
  return targetStage !== "new_lead" || currentStage === "new_lead";
}

// ─── Service ────────────────────────────────────────────────────────────────

export const StageEvaluator = {
  /**
   * Evaluate pipeline stage based on correspondence counts.
   * Never advances to terminal stages (won/lost) — those require user confirmation.
   */
  evaluate(state: ThreadState): StageEvaluation {
    // Never touch terminal stages
    if (TERMINAL_STAGES.includes(state.currentStage)) {
      return {
        stage: state.currentStage,
        changed: false,
        reason: "Terminal stage — no auto-advance",
      };
    }

    // Check for follow-up condition first (applies at any active stage)
    if (state.lastMessageDirection === "out" && state.lastOutboundAt) {
      const daysSinceOutbound = Math.floor(
        (Date.now() - state.lastOutboundAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (
        daysSinceOutbound > state.autoFollowUpDays &&
        state.currentStage !== "follow_up" &&
        isAllowedAutomatedEmailStageTransition(state.currentStage, "follow_up")
      ) {
        return {
          stage: "follow_up",
          changed: true,
          reason: `No reply for ${daysSinceOutbound} days`,
        };
      }
    }

    // Check for re-engagement (client replied after follow_up)
    if (
      state.currentStage === "follow_up" &&
      state.lastMessageDirection === "in"
    ) {
      return {
        stage: "negotiation",
        changed: true,
        reason: "Client re-engaged after follow-up period",
      };
    }

    // Correspondence count rules
    let suggestedStage: string;
    if (state.outboundCount === 0) {
      suggestedStage = "new_lead";
    } else if (state.outboundCount === 1 && state.totalMessages < 4) {
      suggestedStage = "qualifying";
    } else if (
      state.outboundCount >= 2 &&
      state.totalMessages >= 4 &&
      state.totalMessages < 6
    ) {
      suggestedStage = "quoting";
    } else if (state.outboundCount >= 3 && state.totalMessages >= 6) {
      suggestedStage = "quoted";
    } else {
      suggestedStage = "qualifying";
    }

    // Only advance forward, never go backward (unless follow_up → negotiation above)
    const currentIndex = STAGE_ORDER.indexOf(state.currentStage);
    const suggestedIndex = STAGE_ORDER.indexOf(suggestedStage);
    if (
      suggestedStage !== state.currentStage &&
      suggestedIndex > currentIndex &&
      isAllowedAutomatedEmailStageTransition(state.currentStage, suggestedStage)
    ) {
      return {
        stage: suggestedStage,
        changed: true,
        reason: `Correspondence count: ${state.outboundCount} outbound, ${state.totalMessages} total`,
      };
    }

    return {
      stage: state.currentStage,
      changed: false,
      reason: "No stage change warranted",
    };
  },
};

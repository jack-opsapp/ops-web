export type QboConflictDecision =
  | "ops_won"
  | "qb_won"
  | "needs_review"
  | "skipped";

export interface QboConflictInput {
  opsUpdatedAt: string | null;
  qbUpdatedAt: string | null;
  materialDiff: boolean;
  moneyTouched?: boolean;
}

export interface QboConflictResult {
  decision: QboConflictDecision;
  reason?: string;
}

export function decideQboConflict(
  input: QboConflictInput,
): QboConflictResult {
  if (!input.materialDiff) return { decision: "skipped" };
  if (!input.opsUpdatedAt || !input.qbUpdatedAt) {
    return { decision: "needs_review", reason: "missing timestamp" };
  }

  const opsTime = Date.parse(input.opsUpdatedAt);
  const qbTime = Date.parse(input.qbUpdatedAt);
  if (!Number.isFinite(opsTime) || !Number.isFinite(qbTime)) {
    return { decision: "needs_review", reason: "invalid timestamp" };
  }

  if (qbTime > opsTime) return { decision: "qb_won" };
  if (opsTime > qbTime) return { decision: "ops_won" };
  if (input.moneyTouched) {
    return {
      decision: "needs_review",
      reason: "equal timestamps with money difference",
    };
  }
  return { decision: "needs_review", reason: "equal timestamps" };
}

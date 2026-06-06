import type { AccountingSyncAuditService } from "./accounting-sync-audit-service";
import type {
  AccountingSyncAuditStatus,
  AccountingSyncEntityType,
} from "./accounting-sync-queue-types";
import {
  decideQboConflict,
  type QboConflictDecision,
} from "./qbo-conflict";

export interface ReconcileRecordInput {
  companyId: string;
  connectionId: string;
  entityType: AccountingSyncEntityType;
  entityId: string;
  externalId: string;
  opsUpdatedAt: string | null;
  qbUpdatedAt: string | null;
  materialDiff: boolean;
  moneyTouched?: boolean;
}

export interface ReconcileEnqueueInput {
  companyId: string;
  connectionId: string;
  entityType: AccountingSyncEntityType;
  entityId: string;
  externalId: string;
  operation: "update";
  sourceUpdatedAt: string | null;
}

export interface ReconcileLinkedRecordResult {
  decision: QboConflictDecision;
  status: AccountingSyncAuditStatus;
  enqueued: boolean;
  reason: string | null;
}

type ReconcileAudit = Pick<AccountingSyncAuditService, "record">;

function statusForDecision(decision: QboConflictDecision): AccountingSyncAuditStatus {
  switch (decision) {
    case "ops_won":
    case "qb_won":
      return "succeeded";
    case "needs_review":
      return "needs_review";
    case "skipped":
      return "skipped";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  if (typeof error === "string" && error.trim()) return error.slice(0, 500);
  return "QuickBooks reconcile enqueue failed";
}

export class QuickBooksReconcileService {
  constructor(
    private readonly deps: {
      enqueue: (input: ReconcileEnqueueInput) => Promise<void>;
      audit: ReconcileAudit;
    },
  ) {}

  async reconcileLinkedRecord(input: ReconcileRecordInput): Promise<ReconcileLinkedRecordResult> {
    const result = decideQboConflict(input);
    let enqueueError: string | null = null;
    let enqueued = false;

    if (result.decision === "ops_won") {
      try {
        await this.deps.enqueue({
          companyId: input.companyId,
          connectionId: input.connectionId,
          entityType: input.entityType,
          entityId: input.entityId,
          externalId: input.externalId,
          operation: "update",
          sourceUpdatedAt: input.opsUpdatedAt,
        });
        enqueued = true;
      } catch (error) {
        enqueueError = errorText(error);
      }
    }

    const status: AccountingSyncAuditStatus = enqueueError
      ? "failed"
      : statusForDecision(result.decision);

    await this.deps.audit.record({
      companyId: input.companyId,
      connectionId: input.connectionId,
      provider: "quickbooks",
      direction: "reconcile",
      entityType: input.entityType,
      entityId: input.entityId,
      externalId: input.externalId,
      operation: "reconcile",
      status,
      source: "reconcile",
      decision: result.decision,
      opsUpdatedAt: input.opsUpdatedAt,
      qbUpdatedAt: input.qbUpdatedAt,
      beforeSnapshot: {
        materialDiff: input.materialDiff,
        moneyTouched: input.moneyTouched ?? false,
      },
      afterSnapshot: {
        enqueued,
      },
      error: enqueueError ?? result.reason ?? null,
    });

    if (enqueueError) {
      throw new Error(enqueueError);
    }

    return {
      decision: result.decision,
      status,
      enqueued,
      reason: result.reason ?? null,
    };
  }
}

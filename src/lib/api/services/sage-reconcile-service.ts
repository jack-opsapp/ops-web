import "server-only";

import type { AccountingSyncAuditService } from "./accounting-sync-audit-service";
import type {
  AccountingSyncAuditStatus,
  AccountingSyncQueueEntityType,
} from "./accounting-sync-queue-types";
import type { NormalizedSageRecord } from "./sage-normalize";

export type SageConflictDecision =
  | "ops_won"
  | "sage_won"
  | "needs_review"
  | "skipped";

export interface SageReconcileCandidate {
  companyId: string;
  connectionId: string;
  entityType: AccountingSyncQueueEntityType;
  entityId: string;
  externalId: string;
  resource: string;
  opsUpdatedAt: string | null;
  moneyTouched: boolean;
  syncDirection: "pull_only" | "bidirectional";
  propagateDeletes: boolean;
  latestAudit: {
    opsUpdatedAt: string | null;
    sageUpdatedAt: string | null;
  } | null;
}

export interface SageReconcileResult {
  decision: SageConflictDecision;
  status: AccountingSyncAuditStatus;
  enqueued: boolean;
  applied: boolean;
  reason: string | null;
}

type AuditPort = Pick<AccountingSyncAuditService, "record">;

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decision(input: {
  candidate: SageReconcileCandidate;
  provider: NormalizedSageRecord | null;
  materialDiff: boolean;
}): { decision: SageConflictDecision; reason?: string } {
  const { candidate, provider } = input;
  if (!provider) {
    if (
      candidate.entityType === "supplier_bill" ||
      candidate.entityType === "supplier_bill_payment"
    ) {
      return {
        decision: "needs_review",
        reason:
          "Sage is missing an accounts-payable record that requires operator review",
      };
    }
    if (!candidate.propagateDeletes) {
      return {
        decision: "needs_review",
        reason: "Sage record is missing and delete propagation is disabled",
      };
    }
    if (!candidate.latestAudit) {
      return {
        decision: "needs_review",
        reason: "Sage tombstone has no prior reconciliation evidence",
      };
    }
    if (candidate.latestAudit.opsUpdatedAt !== candidate.opsUpdatedAt) {
      return {
        decision: "needs_review",
        reason: "OPS changed after the last Sage observation",
      };
    }
    return { decision: "sage_won" };
  }

  if (!input.materialDiff) return { decision: "skipped" };
  const latest = candidate.latestAudit;
  if (latest) {
    const opsChanged = latest.opsUpdatedAt !== candidate.opsUpdatedAt;
    const sageChanged = latest.sageUpdatedAt !== provider.updatedAt;
    if (!opsChanged && !sageChanged) return { decision: "skipped" };
    if (opsChanged && !sageChanged) return { decision: "ops_won" };
    if (!opsChanged && sageChanged) return { decision: "sage_won" };
    if (candidate.moneyTouched) {
      return {
        decision: "needs_review",
        reason: "OPS and Sage both changed a financial record",
      };
    }
  }

  const opsTime = timestamp(candidate.opsUpdatedAt);
  const sageTime = timestamp(provider.updatedAt);
  if (opsTime === null || sageTime === null) {
    return {
      decision: "needs_review",
      reason: "OPS or Sage update timestamp is missing or invalid",
    };
  }
  if (sageTime > opsTime) return { decision: "sage_won" };
  if (opsTime > sageTime) return { decision: "ops_won" };
  return {
    decision: "needs_review",
    reason: "OPS and Sage have equal update timestamps with different data",
  };
}

function auditStatus(
  choice: SageConflictDecision,
  failed: boolean
): AccountingSyncAuditStatus {
  if (failed) return "failed";
  if (choice === "needs_review") return "needs_review";
  if (choice === "skipped") return "skipped";
  return "succeeded";
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  return "Sage reconciliation action failed";
}

export class SageReconcileService {
  constructor(
    private readonly dependencies: {
      audit: AuditPort;
      enqueue: (candidate: SageReconcileCandidate) => Promise<void>;
      applyInbound: (
        candidate: SageReconcileCandidate,
        provider: NormalizedSageRecord | null
      ) => Promise<{ opsUpdatedAt: string }>;
    }
  ) {}

  async reconcile(input: {
    candidate: SageReconcileCandidate;
    provider: NormalizedSageRecord | null;
    materialDiff: boolean;
    providerWritesEnabled: boolean;
  }): Promise<SageReconcileResult> {
    const resolved = decision(input);
    let enqueued = false;
    let applied = false;
    let actionError: string | null = null;
    let auditedOpsUpdatedAt = input.candidate.opsUpdatedAt;

    if (resolved.decision === "ops_won") {
      if (
        input.candidate.syncDirection !== "bidirectional" ||
        !input.providerWritesEnabled
      ) {
        resolved.decision = "needs_review";
        resolved.reason =
          "OPS is newer but this Sage connection cannot write to the provider";
      } else {
        try {
          await this.dependencies.enqueue(input.candidate);
          enqueued = true;
        } catch (error) {
          actionError = errorText(error);
        }
      }
    } else if (resolved.decision === "sage_won") {
      try {
        const result = await this.dependencies.applyInbound(
          input.candidate,
          input.provider
        );
        auditedOpsUpdatedAt = result.opsUpdatedAt;
        applied = true;
      } catch (error) {
        actionError = errorText(error);
      }
    }

    const status = auditStatus(resolved.decision, Boolean(actionError));
    await this.dependencies.audit.record({
      companyId: input.candidate.companyId,
      connectionId: input.candidate.connectionId,
      provider: "sage",
      direction: "reconcile",
      entityType: input.candidate.entityType,
      entityId: input.candidate.entityId,
      externalId: input.candidate.externalId,
      operation: "reconcile",
      status,
      source: "reconcile",
      decision: resolved.decision,
      opsUpdatedAt: auditedOpsUpdatedAt,
      qbUpdatedAt: input.provider?.updatedAt ?? null,
      beforeSnapshot: {
        resource: input.candidate.resource,
        materialDiff: input.materialDiff,
        moneyTouched: input.candidate.moneyTouched,
        providerMissing: input.provider === null,
      },
      afterSnapshot: { enqueued, applied },
      error: actionError ?? resolved.reason ?? null,
    });

    if (actionError) throw new Error(actionError);
    return {
      decision: resolved.decision,
      status,
      enqueued,
      applied,
      reason: resolved.reason ?? null,
    };
  }
}

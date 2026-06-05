export const ACCOUNTING_SYNC_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "blocked",
  "needs_review",
  "cancelled",
] as const;

export type AccountingSyncProvider = "quickbooks";

export type AccountingSyncEntityType = "customer" | "invoice" | "estimate" | "payment";

export type AccountingSyncOperation =
  | "create"
  | "update"
  | "void"
  | "inactivate"
  | "delete_soft"
  | "link"
  | "reconcile";

export type AccountingSyncQueueStatus =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed"
  | "blocked"
  | "needs_review"
  | "cancelled";

export type AccountingSyncDirection = "ops_to_qb" | "qb_to_ops" | "reconcile" | "system";

export type AccountingSyncDecision =
  | "ops_won"
  | "qb_won"
  | "skipped"
  | "needs_review"
  | "retry"
  | "blocked";

export type AccountingSyncAuditStatus = "succeeded" | "failed" | "blocked" | "needs_review" | "skipped";

export type AccountingSyncAuditSource = "trigger" | "worker" | "webhook" | "reconcile" | "operator";

export type AccountingSyncSnapshot = Record<string, unknown>;

export interface AccountingSyncQueueRow {
  id: string;
  companyId: string;
  connectionId: string;
  provider: AccountingSyncProvider;
  entityType: AccountingSyncEntityType;
  entityId: string;
  externalId: string | null;
  operation: AccountingSyncOperation;
  sourceTable: string;
  sourceAction: string;
  sourceUpdatedAt: string | null;
  idempotencyKey: string;
  status: AccountingSyncQueueStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  payloadSnapshot: AccountingSyncSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingSyncAuditInput {
  queueId?: string | null;
  companyId: string;
  connectionId?: string | null;
  provider: AccountingSyncProvider;
  direction: AccountingSyncDirection;
  entityType: AccountingSyncEntityType;
  entityId?: string | null;
  externalId?: string | null;
  operation: AccountingSyncOperation;
  status: AccountingSyncAuditStatus;
  source: AccountingSyncAuditSource;
  decision?: AccountingSyncDecision | null;
  opsUpdatedAt?: string | null;
  qbUpdatedAt?: string | null;
  beforeSnapshot?: AccountingSyncSnapshot;
  afterSnapshot?: AccountingSyncSnapshot;
  error?: string | null;
}

export const ACCOUNTING_SYNC_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "blocked",
  "needs_review",
  "cancelled",
] as const;

export type AccountingSyncProvider = "quickbooks" | "sage";

export type AccountingSyncEntityType =
  | "customer"
  | "invoice"
  | "estimate"
  | "payment";

export type SupplierBillSyncEntityType =
  | "supplier"
  | "supplier_bill"
  | "supplier_bill_payment";

export type AccountingSyncQueueEntityType =
  | AccountingSyncEntityType
  | SupplierBillSyncEntityType;

export type AccountingSyncOperation =
  | "create"
  | "update"
  | "void"
  | "inactivate"
  | "delete_soft"
  | "delete"
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

export type AccountingSyncDirection =
  | "ops_to_qb"
  | "qb_to_ops"
  | "ops_to_sage"
  | "sage_to_ops"
  | "reconcile"
  | "system";

export type AccountingSyncDecision =
  | "ops_won"
  | "qb_won"
  | "sage_won"
  | "skipped"
  | "needs_review"
  | "retry"
  | "blocked";

export type AccountingSyncAuditStatus =
  | "succeeded"
  | "failed"
  | "blocked"
  | "needs_review"
  | "skipped";

export type AccountingSyncAuditSource =
  | "trigger"
  | "worker"
  | "webhook"
  | "reconcile"
  | "operator"
  | "system";

export type AccountingSyncSnapshot = Record<string, unknown>;

export interface AccountingSyncQueueRow<
  TEntity extends AccountingSyncQueueEntityType = AccountingSyncEntityType,
> {
  id: string;
  companyId: string;
  connectionId: string;
  provider: AccountingSyncProvider;
  entityType: TEntity;
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
  providerRequestId: string | null;
  providerAcceptedAt: string | null;
  idempotencyExpiresAt: string | null;
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
  entityType: AccountingSyncQueueEntityType;
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

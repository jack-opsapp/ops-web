/**
 * OPS Web - Expense Approval System Types
 *
 * TypeScript interfaces for expense batches, line items, auto-approve rules,
 * and related helpers. These map to the Supabase PostgreSQL schema for the
 * expense approval workflow.
 *
 * Conventions:
 *   - All interfaces use camelCase (snake_case -> camelCase conversion happens
 *     at the service layer).
 *   - `string` for date/timestamp columns (ISO strings from Supabase).
 *   - `number` for monetary values (service layer handles NUMERIC precision).
 *   - Relationship fields are optional and populated by app-level joins.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Expense batch lifecycle status */
export enum ExpenseBatchStatus {
  /** Current-period envelope still accruing expenses with the crew — never in the review queue */
  Open = "open",
  PendingReview = "pending_review",
  Submitted = "submitted",
  Approved = "approved",
  PartiallyApproved = "partially_approved",
  Rejected = "rejected",
  AutoApproved = "auto_approved",
}

/** Auto-approve rule scope type */
export enum AutoApproveRuleType {
  Invoice = "invoice",
  LineItem = "line_item",
}

// ─── Status Display & Color Mappings ──────────────────────────────────────────

/** Uppercase display string for each batch status */
export const BATCH_STATUS_DISPLAY: Record<ExpenseBatchStatus, string> = {
  [ExpenseBatchStatus.Open]: "FILLING",
  [ExpenseBatchStatus.PendingReview]: "PENDING",
  [ExpenseBatchStatus.Submitted]: "SUBMITTED",
  [ExpenseBatchStatus.Approved]: "APPROVED",
  [ExpenseBatchStatus.PartiallyApproved]: "PARTIAL",
  [ExpenseBatchStatus.Rejected]: "REJECTED",
  [ExpenseBatchStatus.AutoApproved]: "AUTO-APPROVED",
};

/** Hex color for each batch status (legacy widget popovers; new surfaces use BATCH_STATUS_TONE) */
export const BATCH_STATUS_COLOR: Record<ExpenseBatchStatus, string> = {
  [ExpenseBatchStatus.Open]: "#8A8A8A",
  [ExpenseBatchStatus.PendingReview]: "#D99A3E",
  [ExpenseBatchStatus.Submitted]: "#D99A3E",
  [ExpenseBatchStatus.Approved]: "#9DB582",
  [ExpenseBatchStatus.PartiallyApproved]: "#C4A868",
  [ExpenseBatchStatus.Rejected]: "#93321A",
  [ExpenseBatchStatus.AutoApproved]: "#9DB582",
};

/**
 * Token-traceable tag classes per batch status — the design-system Tag recipe
 * (text / soft fill / line border built from the earth-tone tokens). New
 * surfaces consume these instead of hex so every value traces to a token.
 */
export const BATCH_STATUS_TONE: Record<ExpenseBatchStatus, string> = {
  [ExpenseBatchStatus.Open]: "text-text-3 bg-surface-input border-line",
  [ExpenseBatchStatus.PendingReview]: "text-tan bg-tan-soft border-tan-line",
  [ExpenseBatchStatus.Submitted]: "text-tan bg-tan-soft border-tan-line",
  [ExpenseBatchStatus.Approved]: "text-olive bg-olive-soft border-olive-line",
  [ExpenseBatchStatus.PartiallyApproved]: "text-tan bg-tan-soft border-tan-line",
  [ExpenseBatchStatus.Rejected]: "text-rose bg-rose-soft border-rose-line",
  [ExpenseBatchStatus.AutoApproved]: "text-olive bg-olive-soft border-olive-line",
};

/** Neutral fallbacks so an unknown/new server status can never render a blank pill. */
const BATCH_STATUS_DISPLAY_FALLBACK = "—";
const BATCH_STATUS_TONE_FALLBACK = "text-text-3 bg-surface-input border-line";

/** Display label for a batch status, guarded against unknown server values. */
export function batchStatusDisplay(status: ExpenseBatchStatus | string): string {
  return (
    BATCH_STATUS_DISPLAY[status as ExpenseBatchStatus] ??
    BATCH_STATUS_DISPLAY_FALLBACK
  );
}

/** Tag classes for a batch status, guarded against unknown server values. */
export function batchStatusTone(status: ExpenseBatchStatus | string): string {
  return (
    BATCH_STATUS_TONE[status as ExpenseBatchStatus] ?? BATCH_STATUS_TONE_FALLBACK
  );
}

// ─── Entity Interfaces ────────────────────────────────────────────────────────

/** Lightweight user info populated by app-level join (NOT a DB FK join) */
export interface ExpenseBatchUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
}

/** Expense batch — groups expense line items for review/approval */
export interface ExpenseBatch {
  id: string;
  companyId: string;
  batchNumber: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: ExpenseBatchStatus;
  submittedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  totalAmount: number | null;
  approvedAmount: number | null;
  parentBatchId: string | null;
  amendmentNumber: number;
  reviewNotes: string | null;
  /** When the operator recorded this envelope as paid out. NULL = approved money not yet settled. */
  paidAt: string | null;
  /** Who recorded the payout (expenses.approve holder). */
  paidBy: string | null;
  createdAt: string;
  updatedAt?: string;

  // Populated by app-level join, NOT DB join
  submitter?: ExpenseBatchUser | null;
}

/** Individual expense line item — maps to the `expenses` table */
export interface ExpenseLineItem {
  id: string;
  companyId: string;
  submittedBy: string;
  batchId: string | null;
  status: string | null;
  categoryId: string | null;
  merchantName: string | null;
  description: string | null;
  amount: number;
  taxAmount: number | null;
  currency: string | null;
  expenseDate: string | null;
  paymentMethod: string | null;
  receiptImageUrl: string | null;
  receiptThumbnailUrl: string | null;
  /** Why an expense has no receipt photo (require_receipt_photo escape hatch). */
  receiptMissingReason: string | null;
  receiptMissingNote: string | null;
  /** Why an expense has no project (require_project_assignment escape hatch). */
  projectMissingReason: string | null;
  projectMissingNote: string | null;
  ocrRawData: unknown | null;
  ocrConfidence: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  accountingSyncStatus: string | null;
  accountingSyncId: string | null;
  accountingSyncedAt: string | null;
  flagComment: string | null;
  flaggedBy: string | null;
  flaggedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;

  // App-level join from expense_categories.name
  categoryName?: string | null;
  // App-level join from expense_project_allocations.project_id (TEXT, not UUID)
  projectId?: string | null;
  // App-level join from projects.title via the allocation's project_id
  projectName?: string | null;
}

/** Auto-approve rule configuration */
export interface AutoApproveRule {
  id: string;
  companyId: string;
  createdBy: string;
  ruleType: AutoApproveRuleType;
  thresholdAmount: number;
  appliesToAll: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  members: AutoApproveRuleMember[];
}

/** Member assignment for an auto-approve rule */
export interface AutoApproveRuleMember {
  id: string;
  ruleId: string;
  userId: string;
}

// ─── Create / Update Utility Types ────────────────────────────────────────────

/** Fields required to create a new auto-approve rule */
export type CreateAutoApproveRule = Pick<
  AutoApproveRule,
  "companyId" | "createdBy" | "ruleType" | "thresholdAmount" | "appliesToAll"
>;

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Whether a batch is in a state where it can be reviewed (approved/rejected) */
export function isBatchReviewable(
  batch: Pick<ExpenseBatch, "status">
): boolean {
  return (
    batch.status === ExpenseBatchStatus.PendingReview ||
    batch.status === ExpenseBatchStatus.Submitted
  );
}

/** Whether a raw status value indicates the batch needs review */
export function isBatchNeedsReview(status: ExpenseBatchStatus): boolean {
  return (
    status === ExpenseBatchStatus.PendingReview ||
    status === ExpenseBatchStatus.Submitted
  );
}

/** Whether a status represents an approved outcome */
export function isBatchApproved(status: ExpenseBatchStatus): boolean {
  return (
    status === ExpenseBatchStatus.Approved ||
    status === ExpenseBatchStatus.AutoApproved ||
    status === ExpenseBatchStatus.PartiallyApproved
  );
}

/** Whether a batch is a current-period "filling" envelope (with the crew, not in any queue). */
export function isBatchFilling(status: ExpenseBatchStatus): boolean {
  return status === ExpenseBatchStatus.Open;
}

/** Approved money waiting to be settled up — the TO PAY working set. */
export function isBatchAwaitingPayout(
  batch: Pick<ExpenseBatch, "status" | "paidAt">
): boolean {
  return isBatchApproved(batch.status) && batch.paidAt == null;
}

/** Recorded as paid out to the submitter — terminal. */
export function isBatchPaid(batch: Pick<ExpenseBatch, "paidAt">): boolean {
  return batch.paidAt != null;
}

/**
 * The amount actually owed for a batch.
 *
 * `approved_amount` is only authoritative for partial approvals (the reject-
 * with-revisions flow sets it to the clean-line total). The atomic
 * `approve_expense_batch` RPC approves every line but leaves approved_amount
 * at its creation value (often 0), so for full approvals a zero/absent figure
 * means "the whole envelope" — fall back to the recalculated total.
 */
export function batchOwedAmount(
  batch: Pick<ExpenseBatch, "status" | "approvedAmount" | "totalAmount">
): number {
  if (batch.status === ExpenseBatchStatus.PartiallyApproved) {
    return batch.approvedAmount ?? batch.totalAmount ?? 0;
  }
  if (batch.approvedAmount != null && batch.approvedAmount > 0) {
    return batch.approvedAmount;
  }
  return batch.totalAmount ?? 0;
}

/**
 * Get a human-readable display name for a batch.
 * Priority: "FirstName LastName" from submitter -> email -> truncated submittedBy UUID.
 */
export function getBatchDisplayName(
  batch: Pick<ExpenseBatch, "submittedBy" | "submitter">
): string {
  const user = batch.submitter;
  if (user) {
    const first = user.firstName?.trim() ?? "";
    const last = user.lastName?.trim() ?? "";
    const fullName = `${first} ${last}`.trim();
    if (fullName) return fullName;
    if (user.email) return user.email;
  }
  if (batch.submittedBy) {
    // Truncate UUID for display
    return batch.submittedBy.length > 8
      ? `${batch.submittedBy.slice(0, 8)}...`
      : batch.submittedBy;
  }
  return "Unknown";
}

/**
 * Extract a "YYYY-MM" period key from a batch's periodStart.
 * Returns the first 7 characters (e.g. "2026-03").
 */
export function periodKeyFromBatch(
  batch: Pick<ExpenseBatch, "periodStart">
): string {
  if (!batch.periodStart) return "unknown";
  return batch.periodStart.slice(0, 7);
}

/**
 * Convert a "YYYY-MM" period key to a display string like "MAR 2026".
 */
export function formatPeriodDisplay(key: string): string {
  const parts = key.split("-");
  if (parts.length < 2) return key.toUpperCase();

  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;

  const MONTH_ABBREVS = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];

  const month = MONTH_ABBREVS[monthIndex];
  if (!month) return key.toUpperCase();

  return `${month} ${year}`;
}

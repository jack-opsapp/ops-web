/**
 * SPEC admin shared types — feed both the data layer (spec-queries.ts) and the
 * UI components (admin/spec/_components/*). Mirror the table shapes documented
 * in ops-software-bible/SPEC/02_DATA_MODEL.md.
 */

// ─── Domain enums ────────────────────────────────────────────────────────────

export type SpecTier = "setup" | "build" | "enterprise";

export type SpecProjectStatus =
  | "awaiting_owner_approval"
  | "awaiting_deposit"
  | "deposit_paid"
  | "discovery"
  | "building"
  | "on_hold"
  | "stalled_on_hold"
  | "support"
  | "on_retainer"
  | "completed"
  | "stalled"
  | "cancelled"
  | "refunded";

export type SpecHoldType = "customer_requested" | "ops_blocked";

export type SpecPaymentMilestone =
  | "deposit"
  | "scope_signoff"
  | "midpoint"
  | "delivery";

export type SpecPaymentStatus =
  | "pending"
  | "invoiced"
  | "paid"
  | "overdue"
  | "disputed"
  | "refunded"
  | "partially_refunded"
  | "voided"
  | "uncollectible";

// ─── TODAY queue ────────────────────────────────────────────────────────────

export type TodaySectionKey =
  | "money_to_collect"
  | "blocked_on_approval"
  | "decisions_due"
  | "sla_misses"
  | "refund_dispute_risk"
  | "next_best_action";

export interface TodayItem {
  id: string;
  description: string;
  ageLabel: string;
  ageMinutes: number;
  amountCents?: number;
  primaryAction?: { label: string; href: string };
  deepLink: string;
}

export interface TodaySection {
  key: TodaySectionKey;
  label: string;
  items: TodayItem[];
}

// ─── Capacity ────────────────────────────────────────────────────────────────

export interface CapacityRow {
  tier: SpecTier;
  slotCeiling: number;
  active: number;
  queued: number;
  holdCustomerRequested: number;
  holdOpsBlocked: number;
  isAcceptingBookings: boolean;
  manualNextStartOverride: string | null; // YYYY-MM-DD
  publicNote: string | null;
  snapshotRefreshedAt: string | null;
}

// ─── Kanban ──────────────────────────────────────────────────────────────────

export const KANBAN_COLUMNS: SpecProjectStatus[] = [
  "awaiting_owner_approval",
  "awaiting_deposit",
  "deposit_paid",
  "discovery",
  "building",
  "on_hold",
  "support",
  "on_retainer",
  "completed",
];

export interface KanbanCard {
  id: string;
  customerLabel: string;
  tier: SpecTier;
  status: SpecProjectStatus;
  holdType: SpecHoldType | null;
  daysInStatus: number;
  totalCommittedCents: number;
  nextActionLabel: string | null;
  isTest: boolean;
}

export interface KanbanColumn {
  status: SpecProjectStatus;
  cards: KanbanCard[];
}

export interface KanbanSideCounters {
  stalled: number;
  stalledOnHold: number;
  cancelled: number;
  refunded: number;
}

// ─── Revenue ─────────────────────────────────────────────────────────────────

export interface RevenuePoint {
  label: string; // YYYY-MM (display: MM)
  cents: number;
}

export interface RevenueSummary {
  paidThisMonthCents: number;
  paidThisQuarterCents: number;
  paidYtdCents: number;
  pendingCents: number;
  overdueCents: number;
  refundedCents: number;
  monthlyTrend: RevenuePoint[];
}

// ─── Pipeline velocity ───────────────────────────────────────────────────────

export interface VelocityRow {
  status: SpecProjectStatus;
  avgDaysCurrent: number;
  sampleSize: number;
}

export interface SlowestProject {
  id: string;
  customerLabel: string;
  tier: SpecTier;
  status: SpecProjectStatus;
  daysInStatus: number;
}

export interface CycleTimeRow {
  tier: SpecTier;
  avgDays: number | null; // null when no completed engagements yet for the tier
  sampleSize: number;
}

export interface PipelineVelocity {
  perStatus: VelocityRow[];
  slowest: SlowestProject[];
  cycleTime: CycleTimeRow[];
}

// ─── Overview composition ────────────────────────────────────────────────────

export interface SpecOverviewSnapshot {
  today: TodaySection[];
  capacity: CapacityRow[];
  kanbanColumns: KanbanColumn[];
  kanbanCounters: KanbanSideCounters;
  revenue: RevenueSummary;
  velocity: PipelineVelocity;
  snapshotRefreshedAt: string | null;
  testMode: boolean;
}

// ─── Refund queue (F.3) ──────────────────────────────────────────────────────

export type SpecRefundRequestStatus =
  | "pending"
  | "processed"
  | "partial"
  | "failed"
  | "denied";

export type SpecRefundRequestSource = "customer_initiated" | "stripe_dispute";

/** One `spec_payments` row narrowed for the refund-breakdown preview + processor. */
export interface SpecRefundPaymentSummary {
  id: string;
  milestone: SpecPaymentMilestone;
  status: SpecPaymentStatus;
  totalCents: number;
  amountRefundedCents: number | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  paidAt: string | null;
  invoicedAt: string | null;
  dueDate: string | null;
}

/**
 * Server-computed eligibility chips rendered next to each refund row. Each
 * boolean is a yes/no chip the operator sees before approving.
 */
export interface SpecRefundEligibility {
  withinGuaranteeWindow: boolean;
  daysSinceWalkthrough: number | null;
  hasActiveDispute: boolean;
  hasNonPaymentDisable: boolean;
  materialBreachFlag: boolean;
  guaranteeAlreadyInvoked: boolean;
}

/**
 * A row on `/admin/spec/refunds`. Pending + processed refunds share the same
 * card layout; processed rows additionally expose the executed breakdown.
 */
export interface SpecRefundQueueRow {
  id: string;
  specProjectId: string;
  requestSource: SpecRefundRequestSource;
  isGuaranteeInvocation: boolean;
  isGoodwill: boolean;
  status: SpecRefundRequestStatus;
  customerReasonText: string | null;
  requestedAt: string;
  requestedAgeLabel: string;
  processedAt: string | null;
  processedByUserId: string | null;
  isTest: boolean;
  totalRefundCents: number | null;

  // Customer + project
  projectTier: SpecTier;
  projectStatus: SpecProjectStatus;
  customerName: string | null;
  customerEmail: string;
  walkthroughCompletedAt: string | null;

  // Per-milestone payments for breakdown preview.
  payments: SpecRefundPaymentSummary[];

  // Eligibility chips.
  eligibility: SpecRefundEligibility;
}

// ─── Owner-approvals queue (F.3) ─────────────────────────────────────────────

export type SpecOwnerApprovalStatus =
  | "pending"
  | "approved"
  | "declined"
  | "expired";

export interface SpecOwnerApprovalQueueRow {
  id: string;
  specProjectId: string;
  status: SpecOwnerApprovalStatus;
  tier: SpecTier;
  approvedTotalCents: number;
  approvedDepositCents: number;
  requestedAt: string;
  ageLabel: string;
  ageMinutes: number;
  isTest: boolean;

  // Buyer + account_holder identity for the queue view.
  buyerUserId: string;
  buyerName: string | null;
  buyerEmail: string | null;
  accountHolderUserId: string;
  accountHolderName: string | null;
  accountHolderEmail: string | null;
  companyId: string;
  companyName: string | null;
}

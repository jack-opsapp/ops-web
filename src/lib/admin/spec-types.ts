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

/**
 * Full spec_capacity row for the editor at /admin/spec/capacity.
 * Mirrors every editable column in `public.spec_capacity` (the read-only
 * overview projection uses `CapacityRow` above; this carries the raw config
 * the editor mutates). Cents are stored as integers; the form converts to
 * dollars for display + back on save.
 */
export interface CapacityEditRow {
  tier: SpecTier;
  slotCeiling: number;
  discoveryDaysMin: number;
  discoveryDaysMax: number;
  buildDaysMin: number;
  buildDaysMax: number;
  supportWindowDays: number;
  subscriptionMultiplierEstimate: number; // numeric(4,2)
  retainerMonthlyCents: number;
  polishHoursBudget: number; // numeric(4,2), 0.5 increments
  isAcceptingBookings: boolean;
  manualNextStartOverride: string | null; // YYYY-MM-DD
  publicNote: string | null;
  adminNotes: string | null;
  updatedAt: string | null;
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

// ─── Project detail (F.2.a) ──────────────────────────────────────────────────
//
// Additive type surface for `/admin/spec/[id]`. Designed to be loaded once per
// page render (server-side) and threaded into the tab subtrees. None of these
// shapes are exposed to customer clients — operator-only.

export type SpecAcceptanceEventType =
  | "tos_accepted"
  | "owner_purchase_approved"
  | "scope_signoff"
  | "midpoint_accepted"
  | "delivery_accepted"
  | "change_order_accepted";

export type SpecChangeOrderType =
  | "minor_hourly"
  | "major_fixed"
  | "polish_budget"
  | "platform_compat_rebuild"
  | "tier_upgrade";

export type SpecChangeOrderStatus =
  | "proposed"
  | "customer_approved"
  | "customer_declined"
  | "in_progress"
  | "completed"
  | "paid";

export type SpecFeatureStatus = "pending" | "passing" | "failing";

export type SpecCommunicationDirection = "outbound" | "inbound";

export type SpecCommunicationChannel =
  | "email"
  | "admin_note"
  | "call_log"
  | "video_message"
  | "system";

export type SpecTicketSeverity = "critical" | "high" | "cosmetic_enhancement";
export type SpecTicketStatus = "open" | "in_progress" | "resolved" | "escalated_to_change_order";
export type SpecTicketPhase = "support" | "retainer" | "ad_hoc";

export type SpecOwnerApprovalStatus = "pending" | "approved" | "declined" | "expired";

// ─── Identity links ──────────────────────────────────────────────────────────

export interface SpecUserLink {
  id: string;
  email: string | null;
  name: string | null;
}

export interface SpecCompanyLink {
  id: string;
  name: string | null;
}

// ─── Header projection ───────────────────────────────────────────────────────

export interface SpecProjectHeader {
  id: string;
  tier: SpecTier;
  originalTier: SpecTier | null;
  status: SpecProjectStatus;
  isTest: boolean;
  customerLabel: string;
}

// ─── Tab 1: Overview ─────────────────────────────────────────────────────────

export interface SpecAttributionSnapshot {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  fbclid: string | null;
  landingUrl: string | null;
  firstTouchAt: string | null;
}

export interface SpecHoldState {
  holdType: SpecHoldType;
  priorStatus: SpecProjectStatus | null;
  onHoldAt: string | null;
  onHoldExpiresAt: string | null;
  onHoldReason: string | null;
}

export interface SpecMilestoneBreakdown {
  milestone: SpecPaymentMilestone;
  amountCents: number;
  status: SpecPaymentStatus;
}

export interface SpecFinancialSummary {
  totalCommittedCents: number;
  totalPaidCents: number;
  pendingCents: number;
  overdueCents: number;
  refundedCents: number;
  polishHoursUsed: number;
  polishHoursBudget: number;
  perMilestone: SpecMilestoneBreakdown[];
}

export interface SpecOverviewTab {
  customer: {
    name: string | null;
    email: string;
    phone: string | null;
    gstNumber: string | null;
  };
  buyer: SpecUserLink | null;
  accountHolder: SpecUserLink | null;
  buyerIsAccountHolder: boolean;
  company: SpecCompanyLink | null;
  lastStatusChangeAt: string | null;
  keyDates: {
    depositPaidAt: string | null;
    scopeDocSignedAt: string | null;
    buildStartedAt: string | null;
    walkthroughCompletedAt: string | null;
    supportWindowEndsAt: string | null;
  };
  holdState: SpecHoldState | null;
  financial: SpecFinancialSummary;
  estimatedCompletionDate: string | null;
  attribution: SpecAttributionSnapshot;
}

// ─── Tab 2: Timeline ─────────────────────────────────────────────────────────

export type SpecTimelineEventKind =
  | "status_change"
  | "acceptance"
  | "communication"
  | "payment"
  | "change_order"
  | "scope_document"
  | "satisfaction_rating"
  | "support_ticket"
  | "system";

export type SpecTimelineFilter =
  | "all"
  | "comms"
  | "money"
  | "status"
  | "tickets"
  | "acceptance";

export interface SpecTimelineEvent {
  id: string;
  kind: SpecTimelineEventKind;
  occurredAt: string;
  actorLabel: string | null;
  summary: string;
  detail: string | null;
  // Per-kind metadata (rendered as small tactical pills underneath the summary).
  meta?: {
    eventType?: SpecAcceptanceEventType;
    signatureMethod?: string | null;
    payloadHash?: string | null;
    milestone?: SpecPaymentMilestone;
    paymentStatus?: SpecPaymentStatus;
    amountCents?: number;
    channel?: SpecCommunicationChannel;
    direction?: SpecCommunicationDirection;
    changeOrderStatus?: SpecChangeOrderStatus;
    scopeDocVersion?: number;
    scopeDocAction?: "drafted" | "sent" | "superseded";
    rating?: number;
    featureName?: string;
    ticketStatus?: SpecTicketStatus;
    ticketSeverity?: SpecTicketSeverity;
    isPathBAcceptancePair?: boolean;
  };
}

// ─── Tab 3: Intake responses ─────────────────────────────────────────────────

export interface SpecIntakeFile {
  path: string;          // Storage path (relative to bucket `spec-intake/{id}/...`)
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  signedUrl?: string | null;
}

export interface SpecIntakeTab {
  submittedAt: string | null;
  responses: Record<string, unknown> | null;
  files: SpecIntakeFile[];
  regulatedWorkflowFlaggedAt: string | null;
  regulatedWorkflowFlags: Record<string, unknown> | null;
}

// ─── Tab 4: Scope doc ────────────────────────────────────────────────────────

export interface SpecScopeDocumentRow {
  id: string;
  version: number;
  contentHash: string;
  externalUrl: string | null;
  draftedAt: string;
  sentAt: string | null;
  supersededAt: string | null;
  isCurrent: boolean;
}

export interface SpecScopeFeatureRow {
  id: string;
  featureName: string;
  acceptanceCriteria: string;
  status: SpecFeatureStatus;
  verifiedAt: string | null;
  failureNotes: string | null;
}

export interface SpecScopeTab {
  versions: SpecScopeDocumentRow[];
  current: {
    id: string;
    version: number;
    contentJson: Record<string, unknown> | null;
    externalUrl: string | null;
    features: SpecScopeFeatureRow[];
  } | null;
}

// ─── Tab 5: Milestones ───────────────────────────────────────────────────────

export interface SpecMilestoneRow {
  id: string | null;             // null when no spec_payments row yet
  milestone: SpecPaymentMilestone;
  label: string;                 // "P1" | "P2" | "P3" | "P4"
  status: SpecPaymentStatus | "not_yet_fired";
  amountCents: number;           // canonical tier-derived amount (25% of total)
  invoicedAt: string | null;
  paidAt: string | null;
  dueDate: string | null;
  stripeInvoiceId: string | null;
  fireable: boolean;             // P2/P3/P4 only; true when prereq met + no row
  fireBlockedReason: string | null;
}

export interface SpecMilestonesTab {
  tierTotalCents: number;
  rows: SpecMilestoneRow[];
}

// ─── Composed project-detail snapshot ────────────────────────────────────────

export interface SpecProjectDetailSnapshot {
  header: SpecProjectHeader;
  overview: SpecOverviewTab;
  timeline: SpecTimelineEvent[];
  intake: SpecIntakeTab;
  scope: SpecScopeTab;
  milestones: SpecMilestonesTab;
}

// ─── Tier pricing (locked 25 / 25 / 25 / 25 across all tiers) ───────────────

export const SPEC_TIER_TOTAL_CENTS: Record<SpecTier, number> = {
  setup: 300_000,
  build: 850_000,
  enterprise: 1_800_000,
};

export const SPEC_MILESTONE_LABELS: Record<SpecPaymentMilestone, string> = {
  deposit: "P1",
  scope_signoff: "P2",
  midpoint: "P3",
  delivery: "P4",
};

export const SPEC_MILESTONE_ORDER: SpecPaymentMilestone[] = [
  "deposit",
  "scope_signoff",
  "midpoint",
  "delivery",
];
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

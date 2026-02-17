/**
 * OPS Web - Pipeline & Financial Entity Types
 *
 * TypeScript interfaces for all pipeline, estimate, invoice, payment, and
 * activity entities. These map to the Supabase PostgreSQL schema defined in
 * PIPELINE-STRATEGY.md Part 5.
 *
 * Conventions:
 *   - All interfaces use camelCase (snake_case → camelCase conversion happens
 *     at the service layer).
 *   - `Date | null` for optional timestamps.
 *   - `number` for monetary values (the service layer handles NUMERIC(12,2)).
 *   - Relationship fields are optional and loaded separately.
 */

import type { Client, Project } from "./models";

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Pipeline opportunity stage */
export enum OpportunityStage {
  NewLead = "new_lead",
  Qualifying = "qualifying",
  Quoting = "quoting",
  Quoted = "quoted",
  FollowUp = "follow_up",
  Negotiation = "negotiation",
  Won = "won",
  Lost = "lost",
}

/** How the lead was acquired */
export enum OpportunitySource {
  Referral = "referral",
  Website = "website",
  Email = "email",
  Phone = "phone",
  WalkIn = "walk_in",
  SocialMedia = "social_media",
  RepeatClient = "repeat_client",
  Other = "other",
}

/** Estimate lifecycle status */
export enum EstimateStatus {
  Draft = "draft",
  Sent = "sent",
  Viewed = "viewed",
  Approved = "approved",
  ChangesRequested = "changes_requested",
  Declined = "declined",
  Converted = "converted",
  Expired = "expired",
  Superseded = "superseded",
}

/** Invoice lifecycle status */
export enum InvoiceStatus {
  Draft = "draft",
  Sent = "sent",
  AwaitingPayment = "awaiting_payment",
  PartiallyPaid = "partially_paid",
  PastDue = "past_due",
  Paid = "paid",
  Void = "void",
  WrittenOff = "written_off",
}

/** Activity / event type for the timeline */
export enum ActivityType {
  Note = "note",
  Email = "email",
  Call = "call",
  Meeting = "meeting",
  EstimateSent = "estimate_sent",
  EstimateAccepted = "estimate_accepted",
  EstimateDeclined = "estimate_declined",
  InvoiceSent = "invoice_sent",
  PaymentReceived = "payment_received",
  StageChange = "stage_change",
  Created = "created",
  Won = "won",
  Lost = "lost",
  System = "system",
}

/** Scheduled follow-up type */
export enum FollowUpType {
  Call = "call",
  Email = "email",
  Meeting = "meeting",
  QuoteFollowUp = "quote_follow_up",
  InvoiceFollowUp = "invoice_follow_up",
  Custom = "custom",
}

/** Follow-up completion status */
export enum FollowUpStatus {
  Pending = "pending",
  Completed = "completed",
  Skipped = "skipped",
}

/** Payment method */
export enum PaymentMethod {
  CreditCard = "credit_card",
  DebitCard = "debit_card",
  Ach = "ach",
  Cash = "cash",
  Check = "check",
  BankTransfer = "bank_transfer",
  Stripe = "stripe",
  Other = "other",
}

/** Opportunity priority level */
export enum OpportunityPriority {
  Low = "low",
  Medium = "medium",
  High = "high",
}

/** Discount type for estimates and invoices */
export enum DiscountType {
  Percentage = "percentage",
  Fixed = "fixed",
}

/** Payment milestone type */
export enum MilestoneType {
  Percentage = "percentage",
  Fixed = "fixed",
}

// ─── Stage Color Mappings ─────────────────────────────────────────────────────

export const OPPORTUNITY_STAGE_COLORS: Record<OpportunityStage, string> = {
  [OpportunityStage.NewLead]: "#BCBCBC",
  [OpportunityStage.Qualifying]: "#8195B5",
  [OpportunityStage.Quoting]: "#C4A868",
  [OpportunityStage.Quoted]: "#B5A381",
  [OpportunityStage.FollowUp]: "#A182B5",
  [OpportunityStage.Negotiation]: "#B58289",
  [OpportunityStage.Won]: "#9DB582",
  [OpportunityStage.Lost]: "#6B7280",
};

export const ESTIMATE_STATUS_COLORS: Record<EstimateStatus, string> = {
  [EstimateStatus.Draft]: "#9CA3AF",
  [EstimateStatus.Sent]: "#8195B5",
  [EstimateStatus.Viewed]: "#C4A868",
  [EstimateStatus.Approved]: "#9DB582",
  [EstimateStatus.ChangesRequested]: "#B5A381",
  [EstimateStatus.Declined]: "#B58289",
  [EstimateStatus.Converted]: "#A182B5",
  [EstimateStatus.Expired]: "#6B7280",
  [EstimateStatus.Superseded]: "#D1D5DB",
};

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  [InvoiceStatus.Draft]: "#9CA3AF",
  [InvoiceStatus.Sent]: "#8195B5",
  [InvoiceStatus.AwaitingPayment]: "#C4A868",
  [InvoiceStatus.PartiallyPaid]: "#B5A381",
  [InvoiceStatus.PastDue]: "#B58289",
  [InvoiceStatus.Paid]: "#9DB582",
  [InvoiceStatus.Void]: "#6B7280",
  [InvoiceStatus.WrittenOff]: "#D1D5DB",
};

export const ACTIVITY_TYPE_COLORS: Record<ActivityType, string> = {
  [ActivityType.Note]: "#9CA3AF",
  [ActivityType.Email]: "#8195B5",
  [ActivityType.Call]: "#9DB582",
  [ActivityType.Meeting]: "#A182B5",
  [ActivityType.EstimateSent]: "#C4A868",
  [ActivityType.EstimateAccepted]: "#9DB582",
  [ActivityType.EstimateDeclined]: "#B58289",
  [ActivityType.InvoiceSent]: "#8195B5",
  [ActivityType.PaymentReceived]: "#9DB582",
  [ActivityType.StageChange]: "#B5A381",
  [ActivityType.Created]: "#BCBCBC",
  [ActivityType.Won]: "#9DB582",
  [ActivityType.Lost]: "#B58289",
  [ActivityType.System]: "#6B7280",
};

export const FOLLOW_UP_TYPE_COLORS: Record<FollowUpType, string> = {
  [FollowUpType.Call]: "#9DB582",
  [FollowUpType.Email]: "#8195B5",
  [FollowUpType.Meeting]: "#A182B5",
  [FollowUpType.QuoteFollowUp]: "#C4A868",
  [FollowUpType.InvoiceFollowUp]: "#B5A381",
  [FollowUpType.Custom]: "#9CA3AF",
};

// ─── Stage Sort Orders ────────────────────────────────────────────────────────

export const OPPORTUNITY_STAGE_SORT_ORDER: Record<OpportunityStage, number> = {
  [OpportunityStage.NewLead]: 0,
  [OpportunityStage.Qualifying]: 1,
  [OpportunityStage.Quoting]: 2,
  [OpportunityStage.Quoted]: 3,
  [OpportunityStage.FollowUp]: 4,
  [OpportunityStage.Negotiation]: 5,
  [OpportunityStage.Won]: 6,
  [OpportunityStage.Lost]: 7,
};

// ─── Default Pipeline Stage Configurations ────────────────────────────────────

export interface PipelineStageDefault {
  name: string;
  slug: string;
  color: string;
  sortOrder: number;
  winProbability: number;
  autoFollowUpDays: number | null;
}

/** Default stage configs seeded for new companies */
export const PIPELINE_STAGES_DEFAULT: PipelineStageDefault[] = [
  {
    name: "New Lead",
    slug: "new_lead",
    color: "#BCBCBC",
    sortOrder: 0,
    winProbability: 10,
    autoFollowUpDays: 2,
  },
  {
    name: "Qualifying",
    slug: "qualifying",
    color: "#8195B5",
    sortOrder: 1,
    winProbability: 20,
    autoFollowUpDays: 3,
  },
  {
    name: "Quoting",
    slug: "quoting",
    color: "#C4A868",
    sortOrder: 2,
    winProbability: 40,
    autoFollowUpDays: 3,
  },
  {
    name: "Quoted",
    slug: "quoted",
    color: "#B5A381",
    sortOrder: 3,
    winProbability: 60,
    autoFollowUpDays: 5,
  },
  {
    name: "Follow-Up",
    slug: "follow_up",
    color: "#A182B5",
    sortOrder: 4,
    winProbability: 50,
    autoFollowUpDays: 3,
  },
  {
    name: "Negotiation",
    slug: "negotiation",
    color: "#B58289",
    sortOrder: 5,
    winProbability: 75,
    autoFollowUpDays: 2,
  },
  {
    name: "Won",
    slug: "won",
    color: "#9DB582",
    sortOrder: 6,
    winProbability: 100,
    autoFollowUpDays: null,
  },
  {
    name: "Lost",
    slug: "lost",
    color: "#6B7280",
    sortOrder: 7,
    winProbability: 0,
    autoFollowUpDays: null,
  },
];

// ─── Entity Interfaces ────────────────────────────────────────────────────────

/** Pipeline deal / opportunity card */
export interface Opportunity {
  id: string;
  companyId: string;
  clientId: string | null;
  title: string;
  description: string | null;

  // Contact info (for leads without a client record yet)
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;

  // Pipeline tracking
  stage: OpportunityStage;
  source: OpportunitySource | null;
  assignedTo: string | null;
  priority: OpportunityPriority | null;

  // Financial
  estimatedValue: number | null;
  actualValue: number | null;
  winProbability: number;

  // Dates
  expectedCloseDate: Date | null;
  actualCloseDate: Date | null;
  stageEnteredAt: Date;

  // Conversion
  projectId: string | null;
  lostReason: string | null;
  lostNotes: string | null;

  // Address
  address: string | null;

  // Denormalized for performance
  lastActivityAt: Date | null;
  nextFollowUpAt: Date | null;
  tags: string[];

  // System
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  client?: Client | null;
  project?: Project | null;
  estimates?: Estimate[];
  activities?: Activity[];
  followUps?: FollowUp[];
  stageTransitions?: StageTransition[];
}

/** Immutable stage change record */
export interface StageTransition {
  id: string;
  companyId: string;
  opportunityId: string;
  fromStage: OpportunityStage | null;
  toStage: OpportunityStage;
  transitionedAt: Date;
  transitionedBy: string | null;
  durationInStage: number | null; // duration in milliseconds (converted from PG interval)

  // Relationships (loaded separately)
  opportunity?: Opportunity | null;
}

/** Per-company pipeline stage configuration */
export interface PipelineStageConfig {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  isWonStage: boolean;
  isLostStage: boolean;
  defaultWinProbability: number;
  autoFollowUpDays: number | null;
  autoFollowUpType: FollowUpType | null;
  staleThresholdDays: number;
  createdAt: Date | null;
  deletedAt: Date | null;
}

/** Products/services catalog item */
export interface Product {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  defaultPrice: number;
  unitCost: number | null;
  unit: string;
  category: string | null;
  isTaxable: boolean;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  deletedAt: Date | null;
}

/** Tax rate configuration */
export interface TaxRate {
  id: string;
  companyId: string;
  name: string;
  rate: number; // decimal, e.g. 0.0875 = 8.75%
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date | null;
}

/** Quote / proposal */
export interface Estimate {
  id: string;
  companyId: string;
  opportunityId: string | null;
  clientId: string;
  estimateNumber: string;
  version: number;
  parentId: string | null;

  // Content
  title: string | null;
  clientMessage: string | null;
  internalNotes: string | null;
  terms: string | null;

  // Pricing (snapshots -- NOT computed from line items at query time)
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;

  // Payment schedule
  depositType: DiscountType | null;
  depositValue: number | null;
  depositAmount: number | null;

  // Status
  status: EstimateStatus;
  issueDate: Date;
  expirationDate: Date | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  approvedAt: Date | null;

  // PDF
  pdfStoragePath: string | null;

  // System
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  lineItems?: LineItem[];
  paymentMilestones?: PaymentMilestone[];
  client?: Client | null;
  opportunity?: Opportunity | null;
  parentEstimate?: Estimate | null;
}

/** Billing document */
export interface Invoice {
  id: string;
  companyId: string;
  clientId: string;
  estimateId: string | null;
  opportunityId: string | null;
  projectId: string | null;
  invoiceNumber: string;

  // Content
  subject: string | null;
  clientMessage: string | null;
  internalNotes: string | null;
  footer: string | null;
  terms: string | null;

  // Pricing
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;

  // Payment tracking (denormalized, updated by trigger)
  amountPaid: number;
  balanceDue: number;
  depositApplied: number;

  // Status & dates
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date;
  paymentTerms: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  paidAt: Date | null;

  // PDF
  pdfStoragePath: string | null;

  // System
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  lineItems?: LineItem[];
  payments?: Payment[];
  client?: Client | null;
  estimate?: Estimate | null;
  opportunity?: Opportunity | null;
  project?: Project | null;
}

/** Line item for estimate or invoice */
export interface LineItem {
  id: string;
  companyId: string;

  // Polymorphic parent (exactly one must be set)
  estimateId: string | null;
  invoiceId: string | null;

  // From catalog (optional reference)
  productId: string | null;

  // Content
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  unitCost: number | null;
  discountPercent: number;
  isTaxable: boolean;
  taxRateId: string | null;

  // Calculated (stored, generated by DB)
  lineTotal: number;

  // Estimate-specific
  isOptional: boolean;
  isSelected: boolean;

  // Display
  sortOrder: number;
  category: string | null;
  serviceDate: Date | null;

  createdAt: Date | null;

  // Relationships (loaded separately)
  product?: Product | null;
  taxRate?: TaxRate | null;
}

/** Payment record */
export interface Payment {
  id: string;
  companyId: string;
  invoiceId: string;
  clientId: string;
  amount: number;
  paymentMethod: PaymentMethod | null;
  referenceNumber: string | null;
  notes: string | null;
  paymentDate: Date;
  stripePaymentIntent: string | null;
  createdBy: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidedBy: string | null;

  // Relationships (loaded separately)
  invoice?: Invoice | null;
}

/** Progress billing milestone */
export interface PaymentMilestone {
  id: string;
  estimateId: string;
  name: string;
  type: MilestoneType;
  value: number;
  amount: number;
  sortOrder: number;
  invoiceId: string | null;
  paidAt: Date | null;

  // Relationships (loaded separately)
  estimate?: Estimate | null;
  invoice?: Invoice | null;
}

/** Communication / event log entry */
export interface Activity {
  id: string;
  companyId: string;
  opportunityId: string | null;
  clientId: string | null;
  estimateId: string | null;
  invoiceId: string | null;

  type: ActivityType;
  subject: string;
  content: string | null;
  outcome: string | null;
  direction: "inbound" | "outbound" | null;
  durationMinutes: number | null;

  createdBy: string | null;
  createdAt: Date;

  // Relationships (loaded separately)
  opportunity?: Opportunity | null;
  client?: Client | null;
}

/** Scheduled follow-up task */
export interface FollowUp {
  id: string;
  companyId: string;
  opportunityId: string | null;
  clientId: string | null;

  type: FollowUpType;
  title: string;
  description: string | null;
  dueAt: Date;
  reminderAt: Date | null;
  completedAt: Date | null;
  assignedTo: string | null;
  status: FollowUpStatus;
  completionNotes: string | null;
  isAutoGenerated: boolean;
  triggerSource: string | null;

  createdBy: string | null;
  createdAt: Date;

  // Relationships (loaded separately)
  opportunity?: Opportunity | null;
  client?: Client | null;
}

// ─── Stage Navigation ─────────────────────────────────────────────────────────

const PIPELINE_STAGE_ORDER: OpportunityStage[] = [
  OpportunityStage.NewLead,
  OpportunityStage.Qualifying,
  OpportunityStage.Quoting,
  OpportunityStage.Quoted,
  OpportunityStage.FollowUp,
  OpportunityStage.Negotiation,
  OpportunityStage.Won,
  OpportunityStage.Lost,
];

export function nextOpportunityStage(
  current: OpportunityStage
): OpportunityStage | null {
  const idx = PIPELINE_STAGE_ORDER.indexOf(current);
  return idx < PIPELINE_STAGE_ORDER.length - 1
    ? PIPELINE_STAGE_ORDER[idx + 1]
    : null;
}

export function previousOpportunityStage(
  current: OpportunityStage
): OpportunityStage | null {
  const idx = PIPELINE_STAGE_ORDER.indexOf(current);
  return idx > 0 ? PIPELINE_STAGE_ORDER[idx - 1] : null;
}

/** Active stages (neither Won nor Lost) */
export function isActiveStage(stage: OpportunityStage): boolean {
  return stage !== OpportunityStage.Won && stage !== OpportunityStage.Lost;
}

/** Terminal stages (Won or Lost) */
export function isTerminalStage(stage: OpportunityStage): boolean {
  return stage === OpportunityStage.Won || stage === OpportunityStage.Lost;
}

/** Get ordered active stages only (excludes Won and Lost) */
export function getActiveStages(): OpportunityStage[] {
  return PIPELINE_STAGE_ORDER.filter(isActiveStage);
}

/** Get all stages in pipeline order */
export function getAllStages(): OpportunityStage[] {
  return [...PIPELINE_STAGE_ORDER];
}

// ─── Opportunity Helpers ──────────────────────────────────────────────────────

/** Get the display name for a stage slug */
export function getStageDisplayName(stage: OpportunityStage): string {
  const config = PIPELINE_STAGES_DEFAULT.find((s) => s.slug === stage);
  return config?.name ?? stage;
}

/** Get the color for a stage slug */
export function getStageColor(stage: OpportunityStage): string {
  return OPPORTUNITY_STAGE_COLORS[stage] ?? "#BCBCBC";
}

/** Calculate weighted pipeline value for an opportunity */
export function getWeightedValue(
  opportunity: Pick<Opportunity, "estimatedValue" | "winProbability">
): number {
  if (!opportunity.estimatedValue) return 0;
  return Math.round(opportunity.estimatedValue * (opportunity.winProbability / 100) * 100) / 100;
}

/** Check if an opportunity is stale (no activity within threshold) */
export function isOpportunityStale(
  opportunity: Pick<Opportunity, "lastActivityAt" | "stageEnteredAt">,
  staleThresholdDays: number = 7
): boolean {
  const referenceDate = opportunity.lastActivityAt ?? opportunity.stageEnteredAt;
  if (!referenceDate) return false;
  const now = new Date();
  const diffMs = now.getTime() - referenceDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= staleThresholdDays;
}

/** Calculate days in current stage */
export function getDaysInStage(
  opportunity: Pick<Opportunity, "stageEnteredAt">
): number {
  const now = new Date();
  const diffMs = now.getTime() - opportunity.stageEnteredAt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** Get contact display name (from client or inline contact fields) */
export function getOpportunityContactName(
  opportunity: Pick<Opportunity, "contactName">,
  client?: Client | null
): string {
  return client?.name ?? opportunity.contactName ?? "Unknown Contact";
}

// ─── Estimate Helpers ─────────────────────────────────────────────────────────

/** Check if estimate is expired */
export function isEstimateExpired(
  estimate: Pick<Estimate, "expirationDate" | "status">
): boolean {
  if (
    estimate.status === EstimateStatus.Approved ||
    estimate.status === EstimateStatus.Converted
  ) {
    return false;
  }
  if (!estimate.expirationDate) return false;
  return new Date() > estimate.expirationDate;
}

/** Check if estimate can be edited */
export function isEstimateEditable(
  estimate: Pick<Estimate, "status">
): boolean {
  return (
    estimate.status === EstimateStatus.Draft ||
    estimate.status === EstimateStatus.ChangesRequested
  );
}

/** Check if estimate can be sent */
export function isEstimateSendable(
  estimate: Pick<Estimate, "status">
): boolean {
  return estimate.status === EstimateStatus.Draft;
}

// ─── Invoice Helpers ──────────────────────────────────────────────────────────

/** Check if invoice is overdue */
export function isInvoiceOverdue(
  invoice: Pick<Invoice, "dueDate" | "status" | "balanceDue">
): boolean {
  if (
    invoice.status === InvoiceStatus.Paid ||
    invoice.status === InvoiceStatus.Void ||
    invoice.status === InvoiceStatus.WrittenOff
  ) {
    return false;
  }
  if (!invoice.dueDate) return false;
  return new Date() > invoice.dueDate && invoice.balanceDue > 0;
}

/** Check if invoice can accept payments */
export function isInvoicePayable(
  invoice: Pick<Invoice, "status" | "balanceDue">
): boolean {
  return (
    invoice.balanceDue > 0 &&
    invoice.status !== InvoiceStatus.Draft &&
    invoice.status !== InvoiceStatus.Void &&
    invoice.status !== InvoiceStatus.WrittenOff
  );
}

/** Get days until due (negative means overdue) */
export function getDaysUntilDue(
  invoice: Pick<Invoice, "dueDate">
): number {
  const now = new Date();
  const diffMs = invoice.dueDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ─── Follow-Up Helpers ────────────────────────────────────────────────────────

/** Check if a follow-up is overdue */
export function isFollowUpOverdue(
  followUp: Pick<FollowUp, "dueAt" | "status">
): boolean {
  if (followUp.status !== FollowUpStatus.Pending) return false;
  return new Date() > followUp.dueAt;
}

/** Check if a follow-up is due today */
export function isFollowUpToday(
  followUp: Pick<FollowUp, "dueAt" | "status">
): boolean {
  if (followUp.status !== FollowUpStatus.Pending) return false;
  const today = new Date();
  return (
    followUp.dueAt.getFullYear() === today.getFullYear() &&
    followUp.dueAt.getMonth() === today.getMonth() &&
    followUp.dueAt.getDate() === today.getDate()
  );
}

// ─── Line Item Helpers ────────────────────────────────────────────────────────

/** Calculate line total: quantity * unitPrice * (1 - discountPercent / 100) */
export function calculateLineTotal(
  quantity: number,
  unitPrice: number,
  discountPercent: number = 0
): number {
  return Math.round(quantity * unitPrice * (1 - discountPercent / 100) * 100) / 100;
}

/** Calculate line item tax amount */
export function calculateLineTax(lineTotal: number, taxRate: number): number {
  return Math.round(lineTotal * taxRate * 100) / 100;
}

/** Calculate document totals from line items and a tax rate */
export function calculateDocumentTotals(
  lineItems: Pick<LineItem, "lineTotal" | "isTaxable" | "isOptional" | "isSelected">[],
  taxRate: number = 0,
  discountAmount: number = 0
): { subtotal: number; taxAmount: number; total: number } {
  const selectedItems = lineItems.filter(
    (item) => !item.isOptional || item.isSelected
  );
  const subtotal = selectedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxableTotal = selectedItems
    .filter((item) => item.isTaxable)
    .reduce((sum, item) => sum + item.lineTotal, 0);
  const taxAmount = Math.round(taxableTotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + taxAmount - discountAmount) * 100) / 100;
  return { subtotal, taxAmount, total };
}

/** Calculate profit margin from unit price and unit cost */
export function calculateMargin(
  unitPrice: number,
  unitCost: number | null
): number | null {
  if (unitCost === null || unitPrice === 0) return null;
  return Math.round(((unitPrice - unitCost) / unitPrice) * 10000) / 100;
}

// ─── Payment Helpers ──────────────────────────────────────────────────────────

/** Format a tax rate as a percentage string (e.g. 0.0875 => "8.75%") */
export function formatTaxRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/** Format currency amount */
export function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Create / Update Utility Types ────────────────────────────────────────────

/** Create type - omits server-generated fields */
export type CreateOpportunity = Omit<
  Opportunity,
  | "id"
  | "stageEnteredAt"
  | "lastActivityAt"
  | "nextFollowUpAt"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "client"
  | "project"
  | "estimates"
  | "activities"
  | "followUps"
  | "stageTransitions"
>;

export type CreateEstimate = Omit<
  Estimate,
  | "id"
  | "estimateNumber"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "lineItems"
  | "paymentMilestones"
  | "client"
  | "opportunity"
  | "parentEstimate"
>;

export type CreateInvoice = Omit<
  Invoice,
  | "id"
  | "invoiceNumber"
  | "amountPaid"
  | "balanceDue"
  | "depositApplied"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "lineItems"
  | "payments"
  | "client"
  | "estimate"
  | "opportunity"
  | "project"
>;

export type CreateLineItem = Omit<
  LineItem,
  "id" | "lineTotal" | "createdAt" | "product" | "taxRate"
>;

export type CreatePayment = Omit<
  Payment,
  "id" | "createdAt" | "voidedAt" | "voidedBy" | "invoice"
>;

export type CreatePaymentMilestone = Omit<
  PaymentMilestone,
  "id" | "invoiceId" | "paidAt" | "estimate" | "invoice"
>;

export type CreateActivity = Omit<
  Activity,
  "id" | "createdAt" | "opportunity" | "client"
>;

export type CreateFollowUp = Omit<
  FollowUp,
  "id" | "completedAt" | "createdAt" | "opportunity" | "client"
>;

export type CreateProduct = Omit<
  Product,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

export type CreateTaxRate = Omit<TaxRate, "id" | "createdAt">;

export type CreatePipelineStageConfig = Omit<
  PipelineStageConfig,
  "id" | "createdAt" | "deletedAt"
>;

/** Update type - all fields optional except id */
export type UpdateOpportunity = Partial<CreateOpportunity> & { id: string };
export type UpdateEstimate = Partial<CreateEstimate> & { id: string };
export type UpdateInvoice = Partial<CreateInvoice> & { id: string };
export type UpdateLineItem = Partial<CreateLineItem> & { id: string };
export type UpdatePayment = Partial<CreatePayment> & { id: string };
export type UpdatePaymentMilestone = Partial<CreatePaymentMilestone> & { id: string };
export type UpdateActivity = Partial<CreateActivity> & { id: string };
export type UpdateFollowUp = Partial<CreateFollowUp> & { id: string };
export type UpdateProduct = Partial<CreateProduct> & { id: string };
export type UpdateTaxRate = Partial<CreateTaxRate> & { id: string };
export type UpdatePipelineStageConfig = Partial<CreatePipelineStageConfig> & { id: string };

// ─── Helper Props Type ────────────────────────────────────────────────────────

/** Props type for components that display a stage badge or indicator */
export interface StageProps {
  stage: OpportunityStage;
  color?: string;
  showIcon?: boolean;
}

/** Props type for components that need opportunity card data */
export interface OpportunityCardProps {
  opportunity: Opportunity;
  clientName: string;
  daysInStage: number;
  isStale: boolean;
  nextFollowUp: FollowUp | null;
  estimateCount: number;
  weightedValue: number;
}

/** Loss reason options for the Lost stage prompt */
export const LOSS_REASONS = [
  "Price",
  "Timing",
  "Competition",
  "Scope",
  "No Response",
  "Other",
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];

/** Payment terms options */
export const PAYMENT_TERMS_OPTIONS = [
  "Due on Receipt",
  "Net 7",
  "Net 10",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
  "Net 90",
] as const;

/** Unit options for line items and products */
export const UNIT_OPTIONS = [
  "each",
  "hour",
  "sqft",
  "linear ft",
  "day",
  "flat rate",
] as const;

/**
 * OPS Web - QuickBooks Import (read-only sync) Types
 *
 * TypeScript interfaces for the QBO pull -> stage -> review -> apply pipeline.
 * These map to the qbo_* tables created in migration
 * 20260602000000_qbo_readonly_sync_a0_schema.sql.
 *
 * Conventions (match pipeline.ts):
 *   - camelCase fields (snake_case -> camelCase at the service layer).
 *   - `Date | null` for timestamptz columns; ISO `string` for `date` columns.
 *   - `number` for NUMERIC monetary/quantity values.
 *   - `Record<string, unknown>` for jsonb blobs.
 */

// ─── Run + status ─────────────────────────────────────────────────────────────

export type QboImportRunStatus =
  | "pending"
  | "pulling"
  | "staged"
  | "applying"
  | "applied"
  | "error";

/** One pull -> stage -> apply cycle. Mirrors qbo_import_runs. */
export interface QboImportRun {
  id: string;
  companyId: string;
  provider: string;
  status: QboImportRunStatus;
  /** Trailing-history cutoff date used for the pull window (ISO date). */
  historyCutoff: string | null;
  /** MUST stay 0 — read-only guarantee. Any non-zero value is a hard failure. */
  qbWriteCalls: number;
  totals: Record<string, unknown>;
  error: string | null;
  createdBy: string | null;
  createdAt: Date | null;
  finishedAt: Date | null;
}

// ─── Staging ────────────────────────────────────────────────────────────────--

/** Mirrors qbo_staging_customers. */
export interface QboStagedCustomer {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean | null;
  raw: Record<string, unknown> | null;
  createdAt: Date | null;
}

/** Mirrors qbo_staging_estimates. */
export interface QboStagedEstimate {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  docNumber: string | null;
  customerQbId: string | null;
  txnDate: string | null;
  expirationDate: string | null;
  txnStatus: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  total: number | null;
  raw: Record<string, unknown> | null;
}

/** Mirrors qbo_staging_invoices. */
export interface QboStagedInvoice {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  docNumber: string | null;
  customerQbId: string | null;
  estimateQbId: string | null;
  txnDate: string | null;
  dueDate: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  total: number | null;
  balance: number | null;
  derivedStatus: string | null;
  raw: Record<string, unknown> | null;
}

/** Mirrors qbo_staging_line_items. parentType discriminates the parent doc. */
export interface QboStagedLineItem {
  id: string;
  runId: string;
  companyId: string;
  parentType: "invoice" | "estimate";
  parentQbId: string;
  qbLineId: string | null;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  isTaxable: boolean | null;
  qbItemType: string | null;
  sortOrder: number | null;
}

/** One element of qbo_staging_payments.applied_lines. */
export interface QboStagedPaymentLine {
  invoiceQbId: string;
  amount: number;
  referenceNumber: string | null;
}

/** Mirrors qbo_staging_payments. */
export interface QboStagedPayment {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  customerQbId: string | null;
  txnDate: string | null;
  totalAmt: number | null;
  unappliedAmt: number | null;
  appliedLines: QboStagedPaymentLine[];
  raw: Record<string, unknown> | null;
}

// ─── Customer matching ─────────────────────────────────────────────────────--

/** The four proposed/decided actions for a staged QB customer. */
export const MATCH_ACTIONS = ["link", "create", "skip", "needs_review"] as const;
export type MatchAction = (typeof MATCH_ACTIONS)[number];

export type MatchBasis = "email" | "name_exact" | "name_fuzzy" | "none";
export type MatchConfidence = "high" | "medium" | "low";

/** A candidate existing client surfaced for an ambiguous/low-confidence match. */
export interface QboMatchCandidate {
  clientId: string;
  name: string | null;
  basis: MatchBasis;
  /** 0..1 similarity score (1 = exact email/name). */
  score: number;
}

/** Mirrors qbo_customer_matches. */
export interface QboCustomerMatch {
  id: string;
  runId: string;
  companyId: string;
  customerQbId: string;
  proposedAction: MatchAction;
  matchedClientId: string | null;
  matchBasis: MatchBasis | null;
  confidence: MatchConfidence | null;
  candidates: QboMatchCandidate[];
  decidedAction: MatchAction | null;
  decidedClientId: string | null;
}

// ─── Review aggregate (returned by getImportReview → review UI) ──────────────

/** Per-action customer counts shown in the review header. */
export interface QboMatchCounts {
  link: number;
  create: number;
  skip: number;
  needs_review: number;
}

/** Staged record counts surfaced in the review UI. */
export interface QboStagedCounts {
  customers: number;
  estimates: number;
  invoices: number;
  lineItems: number;
  payments: number;
  /** Payment rows whose linked invoice was not pulled (deposits/retainers). */
  orphanPayments: number;
  /** Invoices skipped because voided or zero-total. */
  skippedInvoices: number;
}

/**
 * QUICKBOOKS-vs-OPS reconciliation totals. Because CanPro has 0 live invoices
 * pre-apply, "opsToBe" mirrors the QB-authoritative staged values; the strip
 * turns green when QB === opsToBe to the cent.
 */
export interface QboReconciliation {
  /** Sum of staged invoice `balance` for non-skipped invoices (QB open A/R). */
  qbOpenAr: number;
  /** What OPS A/R will become after apply (== qbOpenAr; QB is authoritative). */
  opsToBeOpenAr: number;
  /** Count of non-skipped staged invoices with balance > 0. */
  openInvoiceCount: number;
  /** Sum of staged payment `amount` (applied lines only) in the pull window. */
  collectedInWindow: number;
  /** Distinct staged customers. */
  customerCount: number;
  /** True when qbOpenAr === opsToBeOpenAr (rounded to cents). */
  arMatched: boolean;
}

/** Aggregate payload the review screen renders. */
export interface QboImportReview {
  run: QboImportRun;
  matches: QboCustomerMatch[];
  matchCounts: QboMatchCounts;
  stagedCounts: QboStagedCounts;
  reconciliation: QboReconciliation;
}

/** One owner decision applied at apply-time. */
export interface QboApplyDecision {
  customerQbId: string;
  action: MatchAction;
  clientId?: string;
}

// ─── Pull layer (Phase A1) ─────────────────────────────────────────────────--

/** A raw QuickBooks Online record as returned by the pull service (untyped passthrough). */
export type QboRawRecord = Record<string, unknown>;

/** Aggregate of one full read-only pull, plus the safety counter (must be 0). */
export interface QboPullResult {
  customers: QboRawRecord[];
  invoices: QboRawRecord[];
  estimates: QboRawRecord[];
  payments: QboRawRecord[];
  items: QboRawRecord[];
  /** Number of non-GET requests issued during the pull. MUST be 0 (spec §6.5). */
  qbWriteCalls: number;
}

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

// ─── Review aggregate (returned to the review UI) ──────────────────────────--

/** Per-action and per-entity counts surfaced in the review screen. */
export interface QboImportCounts {
  customers: number;
  customersLink: number;
  customersCreate: number;
  customersSkip: number;
  customersNeedsReview: number;
  estimates: number;
  invoices: number;
  lineItems: number;
  payments: number;
  /** Payments with no linked pulled invoice (deposits/retainers). */
  orphanPayments: number;
  /** Voided / zero-total invoices skipped + flagged. */
  skippedInvoices: number;
}

/** A single side (QuickBooks or OPS) of the reconciliation strip. */
export interface QboReconciliationSide {
  openArTotal: number;
  openInvoiceCount: number;
  collected24mo: number;
  customerCount: number;
}

export interface QboReconciliation {
  quickbooks: QboReconciliationSide;
  ops: QboReconciliationSide;
}

/** Aggregate payload returned to the review UI for a run. */
export interface QboImportReview {
  run: QboImportRun;
  matches: QboCustomerMatch[];
  counts: QboImportCounts;
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

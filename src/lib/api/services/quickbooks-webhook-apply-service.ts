/**
 * OPS Web — QuickBooks Webhook Apply Service (inbound, single-entity, read-only)
 *
 * Applies ONE QuickBooks entity named by an inbound Intuit change-event into the
 * live OPS tables. This is the real-time counterpart to the batch import
 * (quickbooks-import-service.applyImport): same canonical mapping, same
 * upsert-by-(company_id, qb_id), same NOT-NULL fallbacks, same generated-column
 * rules, same QB-authoritative reconciliation — but for a single record fetched
 * on demand instead of a staged run.
 *
 * INBOUND ONLY. Every QuickBooks call goes through QuickBooksPullService, which
 * is GET-only and asserts qbWriteCalls === 0. This service NEVER calls any push*
 * path and NEVER writes to QuickBooks. It reads from QB (GET) and writes only to
 * the OPS Supabase database.
 *
 * Field-mapping parity with applyImport is deliberate and load-bearing: the
 * normalize mappers (qbo-normalize) and the upsert column sets here MUST NOT
 * diverge from the manual apply, or a webhook-applied record would differ from
 * the same record imported in a batch run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { AccountingTokenService } from "./accounting-token-service";
import { QuickBooksPullService } from "./quickbooks-pull-service";
import { getQuickBooksEnvironment } from "./quickbooks-config";
import {
  normalizeCustomer,
  normalizeInvoice,
  normalizeEstimate,
  splitPaymentLines,
  deriveInvoiceStatus,
  mapEstimateStatus,
  clientFieldsFromCustomer,
  subClientFieldsFromCustomer,
  type QbRecordLike,
} from "./qbo-normalize";
import {
  QuickBooksEstimateAcceptanceService,
  type QuickBooksEstimateAcceptanceResult,
} from "./quickbooks-estimate-acceptance-service";

// QB entity names this service handles. Anything else (Item, Bill, Vendor, …)
// is intentionally ignored by the webhook receiver.
export type QboEntityName = "Customer" | "Invoice" | "Payment" | "Estimate";

// Intuit change-event operations. Create/Update fetch + upsert; Delete/Void are
// soft-handled; Merge/Emailed/etc. are ignored.
export type QboOperation =
  | "Create"
  | "Update"
  | "Delete"
  | "Void"
  | "Emailed"
  | "Merge";

/** Outcome of applying one entity — surfaced to the sync log + the route. */
export interface ApplyEntityResult {
  /** Maps to accounting_sync_log.status. */
  status: "success" | "skipped" | "error" | "needs_review";
  /** Lowercase singular OPS entity for accounting_sync_log.entity_type. */
  logEntityType: "client" | "estimate" | "invoice" | "payment";
  /** The QB id we acted on (for the log). */
  qbId: string;
  /** Concrete OPS row id when the apply path resolved one. */
  entityId?: string | null;
  /** QuickBooks entity updated timestamp when it is present on the fetched record. */
  qbUpdatedAt?: string | null;
  /** Structured result details for accounting_sync_events.after_snapshot. */
  afterSnapshot?: Record<string, unknown>;
  /** Short, token-free reason for skip/error (for accounting_sync_log.details). */
  detail: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** QB entity name → OPS sync-log entity_type (lowercase singular, CHECK-constrained). */
function logEntityTypeFor(entity: QboEntityName): ApplyEntityResult["logEntityType"] {
  switch (entity) {
    case "Customer":
      return "client";
    case "Invoice":
      return "invoice";
    case "Payment":
      return "payment";
    case "Estimate":
      return "estimate";
  }
}

function qbMetaUpdatedAt(record: QbRecordLike): string | null {
  const meta = record.MetaData;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>).LastUpdatedTime;
  return typeof value === "string" && value.trim() ? value : null;
}

interface ConnectionRow {
  id: string;
  company_id: string;
}

export class QuickBooksWebhookApplyService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = getServiceRoleClient()) {
    this.supabase = supabase;
  }

  /** Build a GET-only pull service from a freshly-resolved (decrypted) token. */
  private async buildPull(connectionId: string): Promise<QuickBooksPullService> {
    const { accessToken, realmId } = await AccountingTokenService.getValidToken(
      this.supabase,
      connectionId
    );
    if (!realmId) {
      throw new Error("QuickBooks realmId not found on connection");
    }
    return new QuickBooksPullService(realmId, accessToken, getQuickBooksEnvironment());
  }

  private async suppressAccountingSync(
    companyId: string,
    entityType: "customer" | "invoice" | "estimate" | "payment",
    entityId: string
  ): Promise<void> {
    const { error } = await this.supabase.rpc("suppress_accounting_sync", {
      p_company_id: companyId,
      p_provider: "quickbooks",
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_source: "quickbooks",
      p_ttl_seconds: 600,
    });
    if (error) {
      throw new Error(`Failed to suppress QuickBooks accounting sync: ${error.message}`);
    }
  }

  /**
   * Fetch + apply a single entity for a connection. Never throws for a
   * per-entity failure that the route should swallow — instead returns an
   * `error` result with a token-free detail. (Truly unexpected throws still
   * propagate so the route's catch can log them.)
   */
  async applyEntity(
    connection: ConnectionRow,
    entity: QboEntityName,
    qbId: string,
    operation: QboOperation
  ): Promise<ApplyEntityResult> {
    const logEntityType = logEntityTypeFor(entity);

    // Delete / Void — soft-handle without a QB fetch (the record may be gone).
    if (operation === "Delete" || operation === "Void") {
      return this.applyDeleteOrVoid(connection, entity, qbId, logEntityType, operation);
    }

    // Only Create/Update fetch + upsert. Everything else (Merge, Emailed, …) is
    // recorded as skipped so the audit trail shows we saw it and chose not to act.
    if (operation !== "Create" && operation !== "Update") {
      return { status: "skipped", logEntityType, qbId, detail: `unhandled operation ${operation}` };
    }

    const pull = await this.buildPull(connection.id);
    const record = await pull.fetchEntityById(entity, qbId);
    // Read-only invariant: a fetch must never have written to QuickBooks.
    if (pull.qbWriteCalls !== 0) {
      throw new Error(`Read-only violation: QB write calls = ${pull.qbWriteCalls}`);
    }
    if (!record) {
      return { status: "skipped", logEntityType, qbId, detail: "record not found in QuickBooks" };
    }

    switch (entity) {
      case "Customer":
        return this.applyCustomer(connection, qbId, record);
      case "Estimate":
        return this.applyEstimate(connection, qbId, record, pull);
      case "Invoice":
        return this.applyInvoice(connection, qbId, record, pull);
      case "Payment":
        return this.applyPayment(connection, qbId, record, pull);
    }
  }

  // ── Customer ────────────────────────────────────────────────────────────
  // Upsert by (company_id, qb_id). Client + contact field shaping is shared with
  // applyImport via clientFieldsFromCustomer / subClientFieldsFromCustomer in
  // qbo-normalize — the single source of truth. This parity is load-bearing: a
  // webhook-applied customer MUST match the same customer applied in a batch run.

  private async applyCustomer(
    connection: ConnectionRow,
    qbId: string,
    record: QbRecordLike
  ): Promise<ApplyEntityResult> {
    const n = normalizeCustomer(record);
    const { data: existingClient } = await this.supabase
      .from("clients")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", n.qb_id)
      .maybeSingle();
    const clientId = (existingClient?.id as string | undefined) ?? crypto.randomUUID();
    await this.suppressAccountingSync(connection.company_id, "customer", clientId);
    const { error } = await this.supabase.from("clients").upsert(
      {
        id: clientId,
        company_id: connection.company_id,
        qb_id: n.qb_id,
        ...clientFieldsFromCustomer(n),
      },
      { onConflict: "company_id,qb_id" }
    );
    if (error) {
      return { status: "error", logEntityType: "client", qbId, entityId: clientId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "client upsert failed" };
    }

    // Company-type customers also get a contact sub_client (parity with
    // applyImport STEP 1b). Null for individuals, contact-less companies, and Jobs.
    const subFields = subClientFieldsFromCustomer(n);
    if (subFields) {
      const { data: clientRow } = await this.supabase
        .from("clients").select("id")
        .eq("company_id", connection.company_id).eq("qb_id", n.qb_id).maybeSingle();
      if (clientRow?.id) {
        const { data: existingSubClient } = await this.supabase
          .from("sub_clients")
          .select("id")
          .eq("company_id", connection.company_id)
          .eq("qb_id", n.qb_id)
          .maybeSingle();
        const subClientId = (existingSubClient?.id as string | undefined) ?? crypto.randomUUID();
        await this.suppressAccountingSync(connection.company_id, "customer", subClientId);
        const { error: subErr } = await this.supabase.from("sub_clients").upsert(
          {
            id: subClientId,
            company_id: connection.company_id,
            client_id: clientRow.id as string,
            qb_id: n.qb_id,
            ...subFields,
          },
          { onConflict: "company_id,qb_id" }
        );
        if (subErr) {
          return { status: "error", logEntityType: "client", qbId, entityId: clientId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "sub_client upsert failed" };
        }
      }
    }
    return { status: "success", logEntityType: "client", qbId, entityId: clientId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: null };
  }

  /** Resolve the OPS client id for a QB customer ref, fetching+creating the customer if absent. */
  private async ensureClientForCustomer(
    connection: ConnectionRow,
    customerQbId: string | null,
    pull: QuickBooksPullService
  ): Promise<string | null> {
    if (!customerQbId) return null;

    const { data: existing } = await this.supabase
      .from("clients")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", customerQbId)
      .maybeSingle();
    if (existing?.id) return existing.id as string;

    // Customer not in OPS yet — fetch + upsert it first (parity with applyImport,
    // which never applies a transaction whose customer was skipped).
    const custRecord = await pull.fetchEntityById("Customer", customerQbId);
    if (pull.qbWriteCalls !== 0) {
      throw new Error(`Read-only violation: QB write calls = ${pull.qbWriteCalls}`);
    }
    if (!custRecord) return null;
    await this.applyCustomer(connection, customerQbId, custRecord);

    const { data: created } = await this.supabase
      .from("clients")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", customerQbId)
      .maybeSingle();
    return (created?.id as string) ?? null;
  }

  // ── Estimate ──────────────────────────────────────────────────────────────
  // Header upsert by (company_id, qb_id) + delete-by-parent line reinsert.
  // Mirrors applyImport STEP 2 (estimate header) + STEP 3 (lines).

  private async applyEstimate(
    connection: ConnectionRow,
    qbId: string,
    record: QbRecordLike,
    pull: QuickBooksPullService
  ): Promise<ApplyEntityResult> {
    const now = new Date();
    const norm = normalizeEstimate(record, now);
    const staging = norm.staging;

    const clientId = await this.ensureClientForCustomer(connection, staging.customer_qb_id, pull);
    if (!clientId) {
      return { status: "skipped", logEntityType: "estimate", qbId, detail: "customer unresolved" };
    }

    const rawTxnStatus =
      typeof record.TxnStatus === "string" && record.TxnStatus.trim()
        ? record.TxnStatus
        : null;
    const status = mapEstimateStatus(rawTxnStatus, staging.expiration_date, now);
    const isAcceptedInQuickBooks = rawTxnStatus === "Accepted";
    // C3: estimate_number/subtotal/tax_amount/total are NOT NULL.
    const estimateNumber = staging.doc_number ?? `QB-${qbId}`;
    const { data: existingEstimate } = await this.supabase
      .from("estimates")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const estimateIdForWrite = (existingEstimate?.id as string | undefined) ?? crypto.randomUUID();
    const estimateRow: Record<string, unknown> = {
      id: estimateIdForWrite,
      company_id: connection.company_id,
      qb_id: qbId,
      client_id: clientId,
      estimate_number: estimateNumber,
      subtotal: Number(staging.subtotal ?? 0),
      tax_rate: staging.tax_rate ?? null,
      tax_amount: Number(staging.tax_amount ?? 0),
      total: Number(staging.total ?? 0),
      status,
      expiration_date: staging.expiration_date ?? null,
    };
    // issue_date is NOT NULL DEFAULT CURRENT_DATE — send txn_date or omit (never null).
    if (staging.txn_date) estimateRow.issue_date = staging.txn_date;

    await this.suppressAccountingSync(connection.company_id, "estimate", estimateIdForWrite);
    const { error: upsertErr } = await this.supabase
      .from("estimates")
      .upsert(estimateRow, { onConflict: "company_id,qb_id" });
    if (upsertErr) {
      return { status: "error", logEntityType: "estimate", qbId, entityId: estimateIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "estimate upsert failed" };
    }

    const { data: row } = await this.supabase
      .from("estimates")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const estimateId = row?.id as string | undefined;
    let lineItemWriteMode: "replaced" | "preserved_existing_linked_lines" | "unresolved" =
      "unresolved";
    if (estimateId) {
      const preserveExistingLinkedLines =
        isAcceptedInQuickBooks &&
        (await this.hasExistingEstimateLines(connection.company_id, estimateId));
      if (preserveExistingLinkedLines) {
        lineItemWriteMode = "preserved_existing_linked_lines";
      } else {
        await this.replaceLineItems(connection.company_id, { estimateId }, norm.lines);
        lineItemWriteMode = "replaced";
      }
    }

    if (estimateId && isAcceptedInQuickBooks) {
      let acceptanceResult: QuickBooksEstimateAcceptanceResult;
      try {
        acceptanceResult = await new QuickBooksEstimateAcceptanceService(this.supabase).acceptFromQuickBooks({
          companyId: connection.company_id,
          connectionId: connection.id,
          estimateId,
          qbEstimateId: qbId,
          qbUpdatedAt: qbMetaUpdatedAt(record),
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "accepted estimate bridge failed";
        return {
          status: "error",
          logEntityType: "estimate",
          qbId,
          entityId: estimateId,
          qbUpdatedAt: qbMetaUpdatedAt(record),
          afterSnapshot: {
            estimateStatus: status,
            quickbooksTxnStatus: rawTxnStatus,
            lineItemWriteMode,
            acceptance: { status: "failed", reason: message },
          },
          detail: "accepted estimate bridge failed",
        };
      }

      const needsReview = acceptanceResult.status === "needs_review";
      return {
        status: needsReview ? "needs_review" : "success",
        logEntityType: "estimate",
        qbId,
        entityId: estimateId,
        qbUpdatedAt: qbMetaUpdatedAt(record),
        afterSnapshot: {
          estimateStatus: status,
          quickbooksTxnStatus: rawTxnStatus,
          lineItemWriteMode,
          acceptance: acceptanceResult,
        },
        detail: needsReview
          ? acceptanceResult.reason ?? "accepted estimate needs review"
          : null,
      };
    }

    return { status: "success", logEntityType: "estimate", qbId, entityId: estimateId ?? estimateIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: null };
  }

  private async hasExistingEstimateLines(companyId: string, estimateId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("line_items")
      .select("id")
      .eq("company_id", companyId)
      .eq("estimate_id", estimateId)
      .limit(1);

    if (error) {
      throw new Error(`line item lineage lookup failed: ${error.message}`);
    }

    return ((data ?? []) as Array<Record<string, unknown>>).length > 0;
  }

  // ── Invoice ─────────────────────────────────────────────────────────────────
  // Mirrors applyImport STEP 2 (invoice header) + STEP 3 (lines) + STEP 5
  // (reconcile to QB Balance). Voided / zero-total invoices are NEVER applied.

  private async applyInvoice(
    connection: ConnectionRow,
    qbId: string,
    record: QbRecordLike,
    pull: QuickBooksPullService
  ): Promise<ApplyEntityResult> {
    const now = new Date();
    const norm = normalizeInvoice(record, now);
    const staging = norm.staging;

    // C2: skip voided / zero-total invoices (never apply, mirroring applyImport).
    if (norm.skipped || staging.derived_status === "skipped") {
      return {
        status: "skipped",
        logEntityType: "invoice",
        qbId,
        qbUpdatedAt: qbMetaUpdatedAt(record),
        detail: norm.skipReason ?? "skipped invoice",
      };
    }

    const clientId = await this.ensureClientForCustomer(connection, staging.customer_qb_id, pull);
    if (!clientId) {
      return { status: "skipped", logEntityType: "invoice", qbId, detail: "customer unresolved" };
    }

    const total = Number(staging.total ?? 0);
    const balance = Number(staging.balance ?? 0);
    // C3: due_date is NOT NULL — fall back to txn_date when QB omits it.
    const dueDate = staging.due_date ?? staging.txn_date;
    const provisionalStatus = deriveInvoiceStatus(balance, total, dueDate, now);

    // Link to an OPS estimate only if that estimate already exists for this company.
    let estimateId: string | null = null;
    if (staging.estimate_qb_id) {
      const { data: est } = await this.supabase
        .from("estimates")
        .select("id")
        .eq("company_id", connection.company_id)
        .eq("qb_id", staging.estimate_qb_id)
        .maybeSingle();
      estimateId = (est?.id as string) ?? null;
    }

    // C3: invoice_number/due_date/subtotal/tax_amount/total are NOT NULL.
    const invoiceNumber = staging.doc_number ?? `QB-${qbId}`;
    const { data: existingInvoice } = await this.supabase
      .from("invoices")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const invoiceIdForWrite = (existingInvoice?.id as string | undefined) ?? crypto.randomUUID();
    const invoiceRow: Record<string, unknown> = {
      id: invoiceIdForWrite,
      company_id: connection.company_id,
      qb_id: qbId,
      client_id: clientId,
      estimate_id: estimateId,
      invoice_number: invoiceNumber,
      subtotal: Number(staging.subtotal ?? 0),
      tax_rate: staging.tax_rate ?? null,
      tax_amount: Number(staging.tax_amount ?? 0),
      total,
      status: provisionalStatus, // reconciled below to QB-authoritative Balance
      due_date: dueDate,
    };
    if (staging.txn_date) invoiceRow.issue_date = staging.txn_date;

    await this.suppressAccountingSync(connection.company_id, "invoice", invoiceIdForWrite);
    const { error: upsertErr } = await this.supabase
      .from("invoices")
      .upsert(invoiceRow, { onConflict: "company_id,qb_id" });
    if (upsertErr) {
      return { status: "error", logEntityType: "invoice", qbId, entityId: invoiceIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "invoice upsert failed" };
    }

    const { data: row } = await this.supabase
      .from("invoices")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const invoiceId = row?.id as string | undefined;
    if (!invoiceId) {
      return { status: "error", logEntityType: "invoice", qbId, entityId: invoiceIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "invoice id not resolved" };
    }

    // STEP 3: replace line items (line_total is GENERATED — never inserted).
    await this.replaceLineItems(connection.company_id, { invoiceId }, norm.lines);

    // STEP 5: reconcile to QB-authoritative Balance (parity with applyImport).
    const amountPaid = round2(total - balance);
    const reconciledStatus = deriveInvoiceStatus(balance, total, dueDate, now);
    await this.suppressAccountingSync(connection.company_id, "invoice", invoiceId);
    await this.supabase
      .from("invoices")
      .update({
        amount_paid: amountPaid,
        balance_due: balance,
        status: reconciledStatus,
        paid_at: balance <= 0 ? new Date().toISOString() : null,
      })
      .eq("id", invoiceId);

    return { status: "success", logEntityType: "invoice", qbId, entityId: invoiceId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: null };
  }

  // ── Payment ───────────────────────────────────────────────────────────────
  // Mirrors applyImport STEP 4: one OPS payment row per linked invoice line,
  // composite qb_id `${paymentQbId}:${invoiceQbId}`. Each upsert fires the
  // invoice-balance trigger; we then reconcile each touched invoice to its QB
  // Balance so the trigger's window-based recompute is overridden by QB truth.

  private async applyPayment(
    connection: ConnectionRow,
    qbId: string,
    record: QbRecordLike,
    pull: QuickBooksPullService
  ): Promise<ApplyEntityResult> {
    const split = splitPaymentLines(record);
    const clientId = await this.ensureClientForCustomer(connection, split.customer_qb_id, pull);

    let applied = 0;
    let firstPaymentId: string | null = null;
    for (const line of split.applied) {
      // The payment references an invoice — make sure that invoice exists in OPS
      // first (fetch + apply it), exactly as a batch import would have staged it.
      const invoiceId = await this.ensureInvoice(connection, line.invoice_qb_id, pull);
      if (!invoiceId) continue;

      const compositeQbId = `${qbId}:${line.invoice_qb_id}`;
      await this.suppressAccountingSync(connection.company_id, "invoice", invoiceId);
      const { data: existingPayment } = await this.supabase
        .from("payments")
        .select("id")
        .eq("company_id", connection.company_id)
        .eq("qb_id", compositeQbId)
        .maybeSingle();
      const paymentId = (existingPayment?.id as string | undefined) ?? crypto.randomUUID();
      firstPaymentId ??= paymentId;
      await this.suppressAccountingSync(connection.company_id, "payment", paymentId);
      const { error } = await this.supabase.from("payments").upsert(
        {
          id: paymentId,
          company_id: connection.company_id,
          qb_id: compositeQbId,
          invoice_id: invoiceId,
          client_id: clientId,
          amount: line.amount,
          payment_date: split.txn_date ?? null,
          reference_number: line.reference_number ?? null,
          payment_method: split.payment_method ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      if (error) {
        return { status: "error", logEntityType: "payment", qbId, entityId: paymentId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "payment upsert failed" };
      }
      applied += 1;

      // Reconcile the touched invoice to QB-authoritative Balance (the payment
      // trigger recomputes from in-window OPS payments; QB Balance is truth).
      await this.reconcileInvoiceToQb(connection, line.invoice_qb_id, pull);
    }

    if (applied === 0) {
      return { status: "skipped", logEntityType: "payment", qbId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "no applicable invoice lines" };
    }
    return { status: "success", logEntityType: "payment", qbId, entityId: firstPaymentId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: null };
  }

  /** Resolve (fetch+apply if needed) the OPS invoice id for a QB invoice id. */
  private async ensureInvoice(
    connection: ConnectionRow,
    invoiceQbId: string,
    pull: QuickBooksPullService
  ): Promise<string | null> {
    const { data: existing } = await this.supabase
      .from("invoices")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", invoiceQbId)
      .maybeSingle();
    if (existing?.id) return existing.id as string;

    const invRecord = await pull.fetchEntityById("Invoice", invoiceQbId);
    if (pull.qbWriteCalls !== 0) {
      throw new Error(`Read-only violation: QB write calls = ${pull.qbWriteCalls}`);
    }
    if (!invRecord) return null;
    const res = await this.applyInvoice(connection, invoiceQbId, invRecord, pull);
    if (res.status !== "success") return null;

    const { data: created } = await this.supabase
      .from("invoices")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", invoiceQbId)
      .maybeSingle();
    return (created?.id as string) ?? null;
  }

  /** Re-pull one invoice (GET) and force its OPS balance/status to QB truth. */
  private async reconcileInvoiceToQb(
    connection: ConnectionRow,
    invoiceQbId: string,
    pull: QuickBooksPullService
  ): Promise<void> {
    const invRecord = await pull.fetchEntityById("Invoice", invoiceQbId);
    if (pull.qbWriteCalls !== 0) {
      throw new Error(`Read-only violation: QB write calls = ${pull.qbWriteCalls}`);
    }
    if (!invRecord) return;
    const now = new Date();
    const norm = normalizeInvoice(invRecord, now);
    const staging = norm.staging;
    if (norm.skipped || staging.derived_status === "skipped") return;

    const { data: row } = await this.supabase
      .from("invoices")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", invoiceQbId)
      .maybeSingle();
    const invoiceId = row?.id as string | undefined;
    if (!invoiceId) return;

    const total = Number(staging.total ?? 0);
    const balance = Number(staging.balance ?? 0);
    const dueDate = staging.due_date ?? staging.txn_date;
    const status = deriveInvoiceStatus(balance, total, dueDate, now);
    await this.suppressAccountingSync(connection.company_id, "invoice", invoiceId);
    await this.supabase
      .from("invoices")
      .update({
        amount_paid: round2(total - balance),
        balance_due: balance,
        status,
        paid_at: balance <= 0 ? new Date().toISOString() : null,
      })
      .eq("id", invoiceId);
  }

  // ── Line items (delete-by-parent then reinsert) ──────────────────────────────
  // line_total is GENERATED — never inserted. Mirrors applyImport STEP 3 exactly.

  private async replaceLineItems(
    companyId: string,
    parent: { invoiceId?: string; estimateId?: string },
    lines: Array<{
      name: string;
      description: string | null;
      quantity: number;
      unit_price: number;
      is_taxable: boolean;
      qb_item_type: string | null;
      sort_order: number;
    }>
  ): Promise<void> {
    if (parent.invoiceId) {
      await this.suppressAccountingSync(companyId, "invoice", parent.invoiceId);
      const { error } = await this.supabase.from("line_items").delete().eq("invoice_id", parent.invoiceId);
      if (error) {
        throw new Error(`line item delete failed: ${error.message}`);
      }
    } else if (parent.estimateId) {
      await this.suppressAccountingSync(companyId, "estimate", parent.estimateId);
      const { error } = await this.supabase.from("line_items").delete().eq("estimate_id", parent.estimateId);
      if (error) {
        throw new Error(`line item delete failed: ${error.message}`);
      }
    }

    for (const line of lines) {
      const opsType =
        line.qb_item_type === "Inventory" || line.qb_item_type === "NonInventory"
          ? "MATERIAL"
          : line.qb_item_type === "Service" || (!line.qb_item_type && Boolean(parent.estimateId))
            ? "LABOR"
          : "OTHER";
      if (parent.invoiceId) {
        await this.suppressAccountingSync(companyId, "invoice", parent.invoiceId);
      } else if (parent.estimateId) {
        await this.suppressAccountingSync(companyId, "estimate", parent.estimateId);
      }
      const { error } = await this.supabase.from("line_items").insert({
        company_id: companyId,
        estimate_id: parent.estimateId ?? null,
        invoice_id: parent.invoiceId ?? null,
        product_id: null,
        name: line.name ?? "Line item",
        description: line.description ?? null,
        quantity: line.quantity ?? 1,
        unit: null,
        unit_price: line.unit_price ?? 0,
        // line_total intentionally omitted — GENERATED column.
        is_taxable: line.is_taxable ?? false,
        sort_order: line.sort_order ?? 0,
        type: opsType,
      });
      if (error) {
        throw new Error(`line item insert failed: ${error.message}`);
      }
    }
  }

  // ── Delete / Void (soft handling) ────────────────────────────────────────────

  private async applyDeleteOrVoid(
    connection: ConnectionRow,
    entity: QboEntityName,
    qbId: string,
    logEntityType: ApplyEntityResult["logEntityType"],
    operation: QboOperation
  ): Promise<ApplyEntityResult> {
    if (entity === "Invoice") {
      const { data: invoice } = await this.supabase
        .from("invoices")
        .select("id")
        .eq("company_id", connection.company_id)
        .eq("qb_id", qbId)
        .maybeSingle();
      if (invoice?.id) {
        await this.suppressAccountingSync(connection.company_id, "invoice", invoice.id as string);
      }
      // Mark the OPS invoice void — a valid invoice status (state machine 5.2).
      const { error } = await this.supabase
        .from("invoices")
        .update({ status: "void" })
        .eq("company_id", connection.company_id)
        .eq("qb_id", qbId);
      if (error) {
        return { status: "error", logEntityType, qbId, entityId: (invoice?.id as string | undefined) ?? null, detail: `${operation.toLowerCase()} failed` };
      }
      return { status: "success", logEntityType, qbId, entityId: (invoice?.id as string | undefined) ?? null, detail: `invoice ${operation.toLowerCase()}` };
    }

    if (entity === "Customer") {
      const { data: client } = await this.supabase
        .from("clients")
        .select("id")
        .eq("company_id", connection.company_id)
        .eq("qb_id", qbId)
        .maybeSingle();
      if (client?.id) {
        await this.suppressAccountingSync(connection.company_id, "customer", client.id as string);
      }
      // Soft-delete the OPS client (deleted_at). Never hard-delete.
      const { error } = await this.supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() })
        .eq("company_id", connection.company_id)
        .eq("qb_id", qbId);
      if (error) {
        return { status: "error", logEntityType, qbId, entityId: (client?.id as string | undefined) ?? null, detail: `${operation.toLowerCase()} failed` };
      }
      return { status: "success", logEntityType, qbId, entityId: (client?.id as string | undefined) ?? null, detail: `client ${operation.toLowerCase()}` };
    }

    // Estimate / Payment deletion has no unambiguous soft-state in OPS — skip+log
    // rather than guess (a hard delete could orphan linked records).
    return {
      status: "skipped",
      logEntityType,
      qbId,
      detail: `${operation.toLowerCase()} not soft-handled for ${entity}`,
    };
  }
}

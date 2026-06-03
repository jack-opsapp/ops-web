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
  type QbRecordLike,
} from "./qbo-normalize";

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
  status: "success" | "skipped" | "error";
  /** Lowercase singular OPS entity for accounting_sync_log.entity_type. */
  logEntityType: "client" | "estimate" | "invoice" | "payment";
  /** The QB id we acted on (for the log). */
  qbId: string;
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
  // Upsert by (company_id, qb_id). Mapping mirrors applyImport STEP 1 "create".

  private async applyCustomer(
    connection: ConnectionRow,
    qbId: string,
    record: QbRecordLike
  ): Promise<ApplyEntityResult> {
    const n = normalizeCustomer(record);
    const { error } = await this.supabase.from("clients").upsert(
      {
        company_id: connection.company_id,
        qb_id: n.qb_id,
        name: n.display_name ?? "QuickBooks customer",
        email: n.email ?? null,
        phone_number: n.phone ?? null,
        address: n.address ?? null,
      },
      { onConflict: "company_id,qb_id" }
    );
    if (error) {
      return { status: "error", logEntityType: "client", qbId, detail: "client upsert failed" };
    }
    return { status: "success", logEntityType: "client", qbId, detail: null };
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

    const status = mapEstimateStatus(staging.txn_status, staging.expiration_date, now);
    // C3: estimate_number/subtotal/tax_amount/total are NOT NULL.
    const estimateNumber = staging.doc_number ?? `QB-${qbId}`;
    const estimateRow: Record<string, unknown> = {
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

    const { error: upsertErr } = await this.supabase
      .from("estimates")
      .upsert(estimateRow, { onConflict: "company_id,qb_id" });
    if (upsertErr) {
      return { status: "error", logEntityType: "estimate", qbId, detail: "estimate upsert failed" };
    }

    const { data: row } = await this.supabase
      .from("estimates")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const estimateId = row?.id as string | undefined;
    if (estimateId) {
      await this.replaceLineItems(connection.company_id, { estimateId }, norm.lines);
    }

    return { status: "success", logEntityType: "estimate", qbId, detail: null };
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
    const invoiceRow: Record<string, unknown> = {
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

    const { error: upsertErr } = await this.supabase
      .from("invoices")
      .upsert(invoiceRow, { onConflict: "company_id,qb_id" });
    if (upsertErr) {
      return { status: "error", logEntityType: "invoice", qbId, detail: "invoice upsert failed" };
    }

    const { data: row } = await this.supabase
      .from("invoices")
      .select("id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const invoiceId = row?.id as string | undefined;
    if (!invoiceId) {
      return { status: "error", logEntityType: "invoice", qbId, detail: "invoice id not resolved" };
    }

    // STEP 3: replace line items (line_total is GENERATED — never inserted).
    await this.replaceLineItems(connection.company_id, { invoiceId }, norm.lines);

    // STEP 5: reconcile to QB-authoritative Balance (parity with applyImport).
    const amountPaid = round2(total - balance);
    const reconciledStatus = deriveInvoiceStatus(balance, total, dueDate, now);
    await this.supabase
      .from("invoices")
      .update({
        amount_paid: amountPaid,
        balance_due: balance,
        status: reconciledStatus,
        paid_at: balance <= 0 ? new Date().toISOString() : null,
      })
      .eq("id", invoiceId);

    return { status: "success", logEntityType: "invoice", qbId, detail: null };
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
    for (const line of split.applied) {
      // The payment references an invoice — make sure that invoice exists in OPS
      // first (fetch + apply it), exactly as a batch import would have staged it.
      const invoiceId = await this.ensureInvoice(connection, line.invoice_qb_id, pull);
      if (!invoiceId) continue;

      const compositeQbId = `${qbId}:${line.invoice_qb_id}`;
      const { error } = await this.supabase.from("payments").upsert(
        {
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
        return { status: "error", logEntityType: "payment", qbId, detail: "payment upsert failed" };
      }
      applied += 1;

      // Reconcile the touched invoice to QB-authoritative Balance (the payment
      // trigger recomputes from in-window OPS payments; QB Balance is truth).
      await this.reconcileInvoiceToQb(connection, line.invoice_qb_id, pull);
    }

    if (applied === 0) {
      return { status: "skipped", logEntityType: "payment", qbId, detail: "no applicable invoice lines" };
    }
    return { status: "success", logEntityType: "payment", qbId, detail: null };
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
      await this.supabase.from("line_items").delete().eq("invoice_id", parent.invoiceId);
    } else if (parent.estimateId) {
      await this.supabase.from("line_items").delete().eq("estimate_id", parent.estimateId);
    }

    for (const line of lines) {
      const opsType =
        line.qb_item_type === "Inventory" || line.qb_item_type === "NonInventory"
          ? "MATERIAL"
          : "OTHER";
      await this.supabase.from("line_items").insert({
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
      // Mark the OPS invoice void — a valid invoice status (state machine 5.2).
      const { error } = await this.supabase
        .from("invoices")
        .update({ status: "void" })
        .eq("company_id", connection.company_id)
        .eq("qb_id", qbId);
      if (error) {
        return { status: "error", logEntityType, qbId, detail: `${operation.toLowerCase()} failed` };
      }
      return { status: "success", logEntityType, qbId, detail: `invoice ${operation.toLowerCase()}` };
    }

    if (entity === "Customer") {
      // Soft-delete the OPS client (deleted_at). Never hard-delete.
      const { error } = await this.supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() })
        .eq("company_id", connection.company_id)
        .eq("qb_id", qbId);
      if (error) {
        return { status: "error", logEntityType, qbId, detail: `${operation.toLowerCase()} failed` };
      }
      return { status: "success", logEntityType, qbId, detail: `client ${operation.toLowerCase()}` };
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

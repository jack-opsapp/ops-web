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
import {
  buildQboLineReplacementPayload,
  formatQboItemMappingWarning,
  getMissingQboItemMappings,
  type MissingQboItemMapping,
} from "./qbo-line-item-mapping-service";

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

function qboEntityTypeFor(entity: QboEntityName): "customer" | "invoice" | "payment" | "estimate" {
  switch (entity) {
    case "Customer":
      return "customer";
    case "Invoice":
      return "invoice";
    case "Payment":
      return "payment";
    case "Estimate":
      return "estimate";
  }
}

function sameQboInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  return Math.abs(aMs - bMs) <= 1000;
}

interface ConnectionRow {
  id: string;
  company_id: string;
}

interface OutboundEchoMatch {
  eventId: string;
  entityId: string | null;
  qbUpdatedAt: string | null;
}

type QboMappedTable = "clients" | "sub_clients" | "estimates" | "invoices" | "payments";

type SupabaseWriteError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function withoutId(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  delete next.id;
  return next;
}

function isUniqueConstraintError(error: SupabaseWriteError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("duplicate key") || message.includes("unique constraint");
}

function qboPaymentCompositeId(paymentQbId: string, invoiceQbId: string): string {
  return `${paymentQbId}:${invoiceQbId}`;
}

export class QuickBooksWebhookApplyService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = getServiceRoleClient()) {
    this.supabase = supabase;
  }

  /** Build a GET-only pull service from a freshly-resolved (decrypted) token. */
  private async buildPull(connectionId: string): Promise<QuickBooksPullService> {
    const { accessToken, realmId, providerEnvironment } = await AccountingTokenService.getValidToken(
      this.supabase,
      connectionId
    );
    if (!realmId) {
      throw new Error("QuickBooks realmId not found on connection");
    }
    return new QuickBooksPullService(realmId, accessToken, providerEnvironment);
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

  private async resolveQboMappedRowId(
    table: QboMappedTable,
    companyId: string,
    qbId: string
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from(table)
      .select("id")
      .eq("company_id", companyId)
      .eq("qb_id", qbId)
      .maybeSingle();
    if (error) {
      throw new Error(`QuickBooks ${table} id lookup failed: ${error.message}`);
    }
    return typeof data?.id === "string" ? data.id : null;
  }

  private async ensureQboEstimateOpportunity(args: {
    companyId: string;
    connectionId: string;
    clientId: string;
    qbEstimateId: string;
    estimateId: string | null;
    estimateNumber: string;
    title: string | null;
    total: number;
  }): Promise<string> {
    const { data, error } = await this.supabase.rpc("ensure_qbo_estimate_opportunity", {
      p_company_id: args.companyId,
      p_connection_id: args.connectionId,
      p_client_id: args.clientId,
      p_qb_estimate_id: args.qbEstimateId,
      p_estimate_id: args.estimateId,
      p_estimate_number: args.estimateNumber,
      p_title: args.title,
      p_total: args.total,
    });
    if (error) {
      throw new Error(`QuickBooks estimate opportunity link failed: ${error.message}`);
    }
    if (typeof data !== "string" || data.trim() === "") {
      throw new Error("QuickBooks estimate opportunity link failed: empty opportunity id");
    }
    return data;
  }

  /**
   * Persist a QuickBooks-mapped row without ever mutating its primary key.
   *
   * PostgREST `.upsert(..., { onConflict: "company_id,qb_id" })` updates every
   * supplied column on conflict, including `id`. Under duplicate webhooks, one
   * request can insert a parent while another conflict-upsert changes that
   * parent's primary key before child line/payment writes land. Financial rows
   * need stable parent IDs, so this path uses insert-first and falls back to a
   * normal update that deliberately excludes `id`.
   */
  private async persistQboMappedRow(args: {
    table: QboMappedTable;
    row: Record<string, unknown>;
    existingId: string | null;
    syncEntityType: "customer" | "invoice" | "estimate" | "payment";
  }): Promise<{ id: string; error: SupabaseWriteError | null }> {
    const companyId = String(args.row.company_id ?? "");
    const qbId = String(args.row.qb_id ?? "");
    const generatedId = String(args.row.id ?? "");
    if (!companyId || !qbId || !generatedId) {
      return { id: generatedId, error: { message: "missing QuickBooks row identity" } };
    }

    const patch = withoutId(args.row);
    if (args.existingId) {
      await this.suppressAccountingSync(companyId, args.syncEntityType, args.existingId);
      const { error } = await this.supabase
        .from(args.table)
        .update(patch)
        .eq("company_id", companyId)
        .eq("qb_id", qbId);
      return { id: args.existingId, error: error as SupabaseWriteError | null };
    }

    await this.suppressAccountingSync(companyId, args.syncEntityType, generatedId);
    const { error: insertError } = await this.supabase.from(args.table).insert(args.row);
    if (!insertError) {
      return { id: generatedId, error: null };
    }
    if (!isUniqueConstraintError(insertError as SupabaseWriteError)) {
      return { id: generatedId, error: insertError as SupabaseWriteError };
    }

    const raceWinnerId = await this.resolveQboMappedRowId(args.table, companyId, qbId);
    if (!raceWinnerId) {
      return {
        id: generatedId,
        error: { message: "QuickBooks duplicate row id was not resolved after insert conflict" },
      };
    }

    await this.suppressAccountingSync(companyId, args.syncEntityType, raceWinnerId);
    const { error: updateError } = await this.supabase
      .from(args.table)
      .update(patch)
      .eq("company_id", companyId)
      .eq("qb_id", qbId);
    return { id: raceWinnerId, error: updateError as SupabaseWriteError | null };
  }

  private async findExistingPaymentLine(
    companyId: string,
    rawPaymentQbId: string,
    invoiceQbId: string,
    invoiceId: string
  ): Promise<{ id: string; qb_id: string | null } | null> {
    const compositeQbId = qboPaymentCompositeId(rawPaymentQbId, invoiceQbId);
    const { data: composite, error: compositeError } = await this.supabase
      .from("payments")
      .select("id, qb_id")
      .eq("company_id", companyId)
      .eq("qb_id", compositeQbId)
      .maybeSingle();
    if (compositeError) {
      throw new Error(`QuickBooks payment lookup failed: ${compositeError.message}`);
    }
    if (composite?.id) {
      return { id: composite.id as string, qb_id: (composite.qb_id as string | null) ?? null };
    }

    const { data: legacy, error: legacyError } = await this.supabase
      .from("payments")
      .select("id, qb_id")
      .eq("company_id", companyId)
      .eq("invoice_id", invoiceId)
      .eq("qb_id", rawPaymentQbId)
      .maybeSingle();
    if (legacyError) {
      throw new Error(`QuickBooks payment legacy lookup failed: ${legacyError.message}`);
    }
    if (!legacy?.id) return null;
    return { id: legacy.id as string, qb_id: (legacy.qb_id as string | null) ?? null };
  }

  private async persistPaymentLine(args: {
    companyId: string;
    rawPaymentQbId: string;
    invoiceQbId: string;
    row: Record<string, unknown>;
  }): Promise<{ id: string; error: SupabaseWriteError | null }> {
    const compositeQbId = qboPaymentCompositeId(args.rawPaymentQbId, args.invoiceQbId);
    const existing = await this.findExistingPaymentLine(
      args.companyId,
      args.rawPaymentQbId,
      args.invoiceQbId,
      String(args.row.invoice_id)
    );
    const row: Record<string, unknown> = { ...args.row, qb_id: compositeQbId };
    const patch = withoutId(row);

    if (existing) {
      await this.suppressAccountingSync(args.companyId, "payment", existing.id);
      const { error } = await this.supabase
        .from("payments")
        .update(patch)
        .eq("id", existing.id)
        .eq("company_id", args.companyId);
      return { id: existing.id, error: error as SupabaseWriteError | null };
    }

    await this.suppressAccountingSync(args.companyId, "payment", String(row.id));
    const { error: insertError } = await this.supabase.from("payments").insert(row);
    if (!insertError) {
      return { id: String(row.id), error: null };
    }
    if (!isUniqueConstraintError(insertError as SupabaseWriteError)) {
      return { id: String(row.id), error: insertError as SupabaseWriteError };
    }

    const raceWinner = await this.findExistingPaymentLine(
      args.companyId,
      args.rawPaymentQbId,
      args.invoiceQbId,
      String(args.row.invoice_id)
    );
    if (!raceWinner) {
      return {
        id: String(row.id),
        error: { message: "QuickBooks payment duplicate row id was not resolved after insert conflict" },
      };
    }
    await this.suppressAccountingSync(args.companyId, "payment", raceWinner.id);
    const { error: updateError } = await this.supabase
      .from("payments")
      .update(patch)
      .eq("id", raceWinner.id)
      .eq("company_id", args.companyId);
    return { id: raceWinner.id, error: updateError as SupabaseWriteError | null };
  }

  private async findOutboundEcho(
    connection: ConnectionRow,
    entity: QboEntityName,
    qbId: string,
    record: QbRecordLike
  ): Promise<OutboundEchoMatch | null> {
    const qbUpdatedAt = qbMetaUpdatedAt(record);
    if (!qbUpdatedAt) return null;

    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from("accounting_sync_events")
      .select("id, entity_id, qb_updated_at")
      .eq("company_id", connection.company_id)
      .eq("connection_id", connection.id)
      .eq("provider", "quickbooks")
      .eq("direction", "ops_to_qb")
      .eq("entity_type", qboEntityTypeFor(entity))
      .eq("external_id", qbId)
      .eq("status", "succeeded")
      .eq("source", "worker")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) return null;

    const match = ((data ?? []) as Array<Record<string, unknown>>).find((row) =>
      sameQboInstant(row.qb_updated_at as string | null | undefined, qbUpdatedAt)
    );
    if (!match) return null;

    return {
      eventId: String(match.id),
      entityId: typeof match.entity_id === "string" ? match.entity_id : null,
      qbUpdatedAt,
    };
  }

  private async findOutboundDeleteOrVoidEcho(
    connection: ConnectionRow,
    entity: QboEntityName,
    qbId: string,
    operation: QboOperation
  ): Promise<OutboundEchoMatch | null> {
    const operationCandidates =
      operation === "Void"
        ? new Set(["void"])
        : new Set(["delete_soft", "inactivate", "void"]);
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from("accounting_sync_events")
      .select("id, entity_id, operation")
      .eq("company_id", connection.company_id)
      .eq("connection_id", connection.id)
      .eq("provider", "quickbooks")
      .eq("direction", "ops_to_qb")
      .eq("entity_type", qboEntityTypeFor(entity))
      .eq("external_id", qbId)
      .eq("status", "succeeded")
      .eq("source", "worker")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) return null;

    const match = ((data ?? []) as Array<Record<string, unknown>>).find((row) =>
      operationCandidates.has(String(row.operation))
    );
    if (!match) return null;

    return {
      eventId: String(match.id),
      entityId: typeof match.entity_id === "string" ? match.entity_id : null,
      qbUpdatedAt: null,
    };
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
      const outboundEcho = await this.findOutboundDeleteOrVoidEcho(connection, entity, qbId, operation);
      if (outboundEcho) {
        return {
          status: "skipped",
          logEntityType,
          qbId,
          entityId: outboundEcho.entityId,
          detail: `outbound ${operation.toLowerCase()} echo skipped`,
          afterSnapshot: { echoEventId: outboundEcho.eventId },
        };
      }
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

    const outboundEcho = await this.findOutboundEcho(connection, entity, qbId, record);
    if (outboundEcho) {
      return {
        status: "skipped",
        logEntityType,
        qbId,
        entityId: outboundEcho.entityId,
        qbUpdatedAt: outboundEcho.qbUpdatedAt,
        detail: "outbound echo skipped",
        afterSnapshot: { echoEventId: outboundEcho.eventId },
      };
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
    const clientIdForWrite = (existingClient?.id as string | undefined) ?? crypto.randomUUID();
    const clientWrite = await this.persistQboMappedRow({
      table: "clients",
      existingId: (existingClient?.id as string | undefined) ?? null,
      syncEntityType: "customer",
      row: {
        id: clientIdForWrite,
        company_id: connection.company_id,
        qb_id: n.qb_id,
        ...clientFieldsFromCustomer(n),
      },
    });
    const clientId = clientWrite.id;
    if (clientWrite.error) {
      return { status: "error", logEntityType: "client", qbId, entityId: clientId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "client upsert failed" };
    }

    // Company-type customers also get a contact sub_client (parity with
    // applyImport STEP 1b). Null for individuals, contact-less companies, and Jobs.
    const subFields = subClientFieldsFromCustomer(n);
    if (subFields) {
      const { data: existingSubClient } = await this.supabase
        .from("sub_clients")
        .select("id")
        .eq("company_id", connection.company_id)
        .eq("qb_id", n.qb_id)
        .maybeSingle();
      const subClientIdForWrite = (existingSubClient?.id as string | undefined) ?? crypto.randomUUID();
      const subClientWrite = await this.persistQboMappedRow({
        table: "sub_clients",
        existingId: (existingSubClient?.id as string | undefined) ?? null,
        syncEntityType: "customer",
        row: {
          id: subClientIdForWrite,
          company_id: connection.company_id,
          client_id: clientId,
          qb_id: n.qb_id,
          ...subFields,
        },
      });
      if (subClientWrite.error) {
        return { status: "error", logEntityType: "client", qbId, entityId: clientId, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "sub_client upsert failed" };
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
      .select("id, opportunity_id")
      .eq("company_id", connection.company_id)
      .eq("qb_id", qbId)
      .maybeSingle();
    const estimateIdForWrite = (existingEstimate?.id as string | undefined) ?? crypto.randomUUID();
    const existingOpportunityId = (existingEstimate?.opportunity_id as string | null | undefined) ?? null;
    const opportunityId =
      existingOpportunityId ??
      (await this.ensureQboEstimateOpportunity({
        companyId: connection.company_id,
        connectionId: connection.id,
        clientId,
        qbEstimateId: qbId,
        estimateId: (existingEstimate?.id as string | undefined) ?? null,
        estimateNumber,
        title: staging.doc_number ? `QuickBooks estimate ${staging.doc_number}` : null,
        total: Number(staging.total ?? 0),
      }));
    const estimateRow: Record<string, unknown> = {
      id: estimateIdForWrite,
      company_id: connection.company_id,
      qb_id: qbId,
      client_id: clientId,
      opportunity_id: opportunityId,
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

    const estimateWrite = await this.persistQboMappedRow({
      table: "estimates",
      row: estimateRow,
      existingId: (existingEstimate?.id as string | undefined) ?? null,
      syncEntityType: "estimate",
    });
    if (estimateWrite.error) {
      return { status: "error", logEntityType: "estimate", qbId, entityId: estimateIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "estimate upsert failed" };
    }

    const estimateId = estimateWrite.id;
    if (estimateId && !existingOpportunityId) {
      await this.ensureQboEstimateOpportunity({
        companyId: connection.company_id,
        connectionId: connection.id,
        clientId,
        qbEstimateId: qbId,
        estimateId,
        estimateNumber,
        title: staging.doc_number ? `QuickBooks estimate ${staging.doc_number}` : null,
        total: Number(staging.total ?? 0),
      });
    }

    let lineItemWriteMode: "replaced" | "preserved_existing_linked_lines" | "unresolved" =
      "unresolved";
    let missingQboItemMappings: MissingQboItemMapping[] = [];
    if (estimateId) {
      const preserveExistingLinkedLines =
        isAcceptedInQuickBooks &&
        (await this.hasExistingEstimateLines(connection.company_id, estimateId));
      if (preserveExistingLinkedLines) {
        lineItemWriteMode = "preserved_existing_linked_lines";
      } else {
        const replacement = await this.replaceLineItems(
          connection.company_id,
          connection.id,
          { estimateId },
          norm.lines
        );
        missingQboItemMappings = replacement.missingQboItemMappings;
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

      const missingMappingWarning = formatQboItemMappingWarning(missingQboItemMappings);
      const needsReview = acceptanceResult.status === "needs_review" || missingQboItemMappings.length > 0;
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
          missingQboItemMappings,
          acceptance: acceptanceResult,
        },
        detail: needsReview
          ? acceptanceResult.reason ?? missingMappingWarning ?? "accepted estimate needs review"
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

    const invoiceWrite = await this.persistQboMappedRow({
      table: "invoices",
      row: invoiceRow,
      existingId: (existingInvoice?.id as string | undefined) ?? null,
      syncEntityType: "invoice",
    });
    if (invoiceWrite.error) {
      return { status: "error", logEntityType: "invoice", qbId, entityId: invoiceIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "invoice upsert failed" };
    }

    const invoiceId = invoiceWrite.id;
    if (!invoiceId) {
      return { status: "error", logEntityType: "invoice", qbId, entityId: invoiceIdForWrite, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "invoice id not resolved" };
    }

    // STEP 3: replace line items (line_total is GENERATED — never inserted).
    await this.replaceLineItems(connection.company_id, connection.id, { invoiceId }, norm.lines);

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

      await this.suppressAccountingSync(connection.company_id, "invoice", invoiceId);
      const paymentWrite = await this.persistPaymentLine({
        companyId: connection.company_id,
        rawPaymentQbId: qbId,
        invoiceQbId: line.invoice_qb_id,
        row: {
          id: crypto.randomUUID(),
          company_id: connection.company_id,
          invoice_id: invoiceId,
          client_id: clientId,
          amount: line.amount,
          payment_date: split.txn_date ?? null,
          reference_number: line.reference_number ?? null,
          payment_method: split.payment_method ?? null,
        },
      });
      firstPaymentId ??= paymentWrite.id;
      if (paymentWrite.error) {
        return { status: "error", logEntityType: "payment", qbId, entityId: paymentWrite.id, qbUpdatedAt: qbMetaUpdatedAt(record), detail: "payment upsert failed" };
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
    connectionId: string | null,
    parent: { invoiceId?: string; estimateId?: string },
    lines: Array<{
      name: string;
      description: string | null;
      quantity: number;
      unit_price: number;
      is_taxable: boolean;
      qb_item_id: string | null;
      qb_item_name: string | null;
      qb_item_type: string | null;
      sort_order: number;
    }>
  ): Promise<{ missingQboItemMappings: MissingQboItemMapping[] }> {
    if (parent.invoiceId) {
      await this.suppressAccountingSync(companyId, "invoice", parent.invoiceId);
    } else if (parent.estimateId) {
      await this.suppressAccountingSync(companyId, "estimate", parent.estimateId);
    } else {
      throw new Error("line item replacement failed: parent missing");
    }

    const pLines = await buildQboLineReplacementPayload({
      supabase: this.supabase,
      companyId,
      connectionId,
      parent,
      lines,
    });
    const missingQboItemMappings = getMissingQboItemMappings(pLines);

    const { error } = await this.supabase.rpc("replace_qbo_line_items_locked", {
      p_company_id: companyId,
      p_invoice_id: parent.invoiceId ?? null,
      p_estimate_id: parent.estimateId ?? null,
      p_lines: pLines,
    });
    if (error) {
      throw new Error(`line item replacement failed: ${error.message}`);
    }
    return { missingQboItemMappings };
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

    if (entity === "Payment") {
      const { data: payments, error: lookupError } = await this.supabase
        .from("payments")
        .select("id, invoice_id")
        .eq("company_id", connection.company_id)
        .or(`qb_id.eq.${qbId},qb_id.like.${qbId}:%`);

      if (lookupError) {
        return { status: "error", logEntityType, qbId, detail: `${operation.toLowerCase()} lookup failed` };
      }

      const rows = (payments ?? []) as Array<{ id?: string; invoice_id?: string | null }>;
      if (rows.length === 0) {
        return { status: "skipped", logEntityType, qbId, detail: "payment not found in OPS" };
      }

      for (const payment of rows) {
        if (payment.id) {
          await this.suppressAccountingSync(connection.company_id, "payment", payment.id);
        }
        if (payment.invoice_id) {
          await this.suppressAccountingSync(connection.company_id, "invoice", payment.invoice_id);
        }
      }

      const { error } = await this.supabase
        .from("payments")
        .update({ voided_at: new Date().toISOString() })
        .eq("company_id", connection.company_id)
        .or(`qb_id.eq.${qbId},qb_id.like.${qbId}:%`)
        .is("voided_at", null);

      if (error) {
        return { status: "error", logEntityType, qbId, entityId: rows[0]?.id ?? null, detail: `${operation.toLowerCase()} failed` };
      }

      return {
        status: "success",
        logEntityType,
        qbId,
        entityId: rows[0]?.id ?? null,
        afterSnapshot: { voidedPayments: rows.length },
        detail: `payment ${operation.toLowerCase()}`,
      };
    }

    // Estimate deletion has no unambiguous soft-state in OPS — skip+log rather
    // than guess (a hard delete could orphan linked records).
    return {
      status: "skipped",
      logEntityType,
      qbId,
      detail: `${operation.toLowerCase()} not soft-handled for ${entity}`,
    };
  }
}

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";
import { AccountingSyncQueueService } from "@/lib/api/services/accounting-sync-queue-service";
import type {
  AccountingSyncAuditInput,
  AccountingSyncQueueRow,
} from "@/lib/api/services/accounting-sync-queue-types";
import {
  AccountingTokenService,
  ReconnectRequiredError,
} from "@/lib/api/services/accounting-token-service";
import {
  mapClientToQboCustomer,
  mapEstimateToQboEstimate,
  mapInvoiceToQboInvoice,
  mapPaymentToQboPayment,
  type OpsClientForQbo,
  type OpsContactForQbo,
  type OpsEstimateForQbo,
  type OpsInvoiceForQbo,
  type OpsInvoiceLinkForQbo,
  type OpsLineItemForQbo,
  type OpsPaymentForQbo,
  type QboFallbackServiceItemRef,
} from "@/lib/api/services/qbo-push-mappers";
import {
  QuickBooksWriteService,
  type QboWriteEntity,
  type QuickBooksWriteResult,
} from "@/lib/api/services/quickbooks-write-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_LIMIT = 25;
const NOTIFICATION_ACTION_URL = "/settings?tab=accounting";
const NOTIFICATION_ACTION_LABEL = "Review";

type DbRow = Record<string, unknown>;
type FailureKind = "retry" | "blocked" | "needs_review";

interface PreparedPush {
  table: "clients" | "invoices" | "estimates" | "payments";
  qboEntity: QboWriteEntity;
  payload: Record<string, unknown>;
  existingQbId: string | null;
  localQbIdMissing: boolean;
  opsUpdatedAt: string | null;
  qbUpdatedAt: string | null;
}

interface RowResult {
  queueId: string;
  entityType: AccountingSyncQueueRow["entityType"];
  entityId: string;
  status: "succeeded" | FailureKind | "failed";
  externalId?: string | null;
  error?: string;
  notificationCreated?: boolean;
}

class QueueDecisionError extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = "QueueDecisionError";
    this.kind = kind;
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringValue(value: unknown): string {
  return String(value ?? "");
}

function numberOrString(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown QuickBooks push worker error";
}

function decision(kind: FailureKind, message: string): never {
  throw new QueueDecisionError(kind, message);
}

function deterministicBlock(message: string): never {
  return decision("blocked", message);
}

function needsReview(message: string): never {
  return decision("needs_review", message);
}

function retryable(message: string): never {
  return decision("retry", message);
}

function providerStatus(message: string): number | null {
  const match =
    /QuickBooks (?:write|fetch) failed: (\d+)/.exec(message) ??
    /QuickBooks token refresh failed \(HTTP (\d+)\)/.exec(message);
  return match ? Number(match[1]) : null;
}

function classifyError(error: unknown): { kind: FailureKind; message: string } {
  if (error instanceof QueueDecisionError) {
    return { kind: error.kind, message: error.message };
  }

  if (error instanceof ReconnectRequiredError) {
    return { kind: "needs_review", message: "QuickBooks reconnect required" };
  }

  const message = errorMessage(error);
  const status = providerStatus(message);

  if (status === 429 || (status !== null && status >= 500)) {
    return { kind: "retry", message };
  }

  if (status === 401 || status === 403) {
    return { kind: "needs_review", message: "QuickBooks authorization failed; reconnect required" };
  }

  if (status !== null && status >= 400) {
    return { kind: "needs_review", message };
  }

  if (message.startsWith("Connection not found:")) {
    return { kind: "needs_review", message: "QuickBooks connection not found" };
  }

  if (message === "Invalid QuickBooks id" || message.startsWith("Invalid QuickBooks ")) {
    return { kind: "blocked", message };
  }

  return { kind: "retry", message };
}

function qboBody(raw: Record<string, unknown>, entity: QboWriteEntity): DbRow {
  const body = raw[entity];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    deterministicBlock(`QuickBooks ${entity} SyncToken required`);
  }
  return body as DbRow;
}

function qboSyncToken(raw: Record<string, unknown>, entity: QboWriteEntity): string {
  const token = cleanString(qboBody(raw, entity).SyncToken);
  if (!token) deterministicBlock(`QuickBooks ${entity} SyncToken required`);
  return token;
}

function qboMetaUpdatedAt(raw: Record<string, unknown>, entity: QboWriteEntity): string | null {
  const meta = qboBody(raw, entity).MetaData;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return cleanString((meta as DbRow).LastUpdatedTime);
}

async function maybeSingle(
  supabase: SupabaseClient,
  table: string,
  filters: Array<[string, unknown]>,
): Promise<DbRow | null> {
  let query = supabase.from(table).select("*");
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) retryable(`Failed to fetch ${table}: ${error.message}`);
  return (data as DbRow | null) ?? null;
}

async function selectRows(
  supabase: SupabaseClient,
  table: string,
  filters: Array<[string, unknown]>,
  orderColumn?: string,
): Promise<DbRow[]> {
  let query = supabase.from(table).select("*");
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  if (orderColumn) {
    query = query.order(orderColumn, { ascending: true });
  }
  const { data, error } = await query;
  if (error) retryable(`Failed to fetch ${table}: ${error.message}`);
  return ((data ?? []) as DbRow[]) ?? [];
}

function mapClient(row: DbRow, syncToken?: string | null): OpsClientForQbo {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    email: cleanString(row.email),
    phoneNumber: cleanString(row.phone_number),
    address: cleanString(row.address),
    qbId: cleanString(row.qb_id),
    syncToken: syncToken ?? null,
  };
}

function mapContact(row: DbRow | null): OpsContactForQbo | null {
  if (!row) return null;
  const name = cleanString(row.name);
  const [firstName, ...rest] = name ? name.split(/\s+/) : [];
  return {
    firstName: firstName ?? null,
    lastName: rest.length > 0 ? rest.join(" ") : null,
    email: cleanString(row.email),
    phoneNumber: cleanString(row.phone_number),
  };
}

function mapLineItem(row: DbRow): OpsLineItemForQbo {
  return {
    id: stringValue(row.id),
    name: cleanString(row.name),
    description: cleanString(row.description),
    quantity: numberOrString(row.quantity),
    unitPrice: numberOrString(row.unit_price),
    amount: numberOrString(row.line_total ?? row.amount),
    qbItemId: cleanString(row.qb_item_id ?? row.qbo_item_id ?? row.qb_item_ref),
  };
}

function normalizedProviderEnvironment(environment: string | null | undefined): "production" | "sandbox" {
  return cleanString(environment)?.toLowerCase() === "production" ? "production" : "sandbox";
}

function environmentFallbackEnvNames(environment: "production" | "sandbox", suffix: "ID" | "NAME"): string[] {
  if (environment === "sandbox") {
    return [
      `QBO_SANDBOX_FALLBACK_SERVICE_ITEM_${suffix}`,
      `QB_SANDBOX_FALLBACK_SERVICE_ITEM_${suffix}`,
      `QBO_FALLBACK_SERVICE_ITEM_${suffix}`,
      `QB_FALLBACK_SERVICE_ITEM_${suffix}`,
    ];
  }

  return [
    `QBO_FALLBACK_SERVICE_ITEM_${suffix}`,
    `QB_FALLBACK_SERVICE_ITEM_${suffix}`,
    `QBO_PRODUCTION_FALLBACK_SERVICE_ITEM_${suffix}`,
    `QB_PRODUCTION_FALLBACK_SERVICE_ITEM_${suffix}`,
  ];
}

function firstConfiguredEnv(names: string[]): string | null {
  for (const name of names) {
    const value = cleanString(process.env[name]);
    if (value) return value;
  }
  return null;
}

function fallbackServiceItem(environment: string | null | undefined): QboFallbackServiceItemRef | null {
  const providerEnvironment = normalizedProviderEnvironment(environment);
  const qbItemId = firstConfiguredEnv(environmentFallbackEnvNames(providerEnvironment, "ID"));
  if (!qbItemId) return null;
  return {
    qbItemId,
    name: firstConfiguredEnv(environmentFallbackEnvNames(providerEnvironment, "NAME")) ?? "OPS Service",
  };
}

function invoiceClientId(row: DbRow): string | null {
  return cleanString(row.client_id) ?? cleanString(row.client_ref);
}

function estimateClientId(row: DbRow): string | null {
  return cleanString(row.client_id) ?? cleanString(row.client_ref);
}

async function currentQboState(
  writeService: QuickBooksWriteService,
  entity: QboWriteEntity,
  qbId: string | null,
): Promise<{ syncToken: string | null; qbUpdatedAt: string | null }> {
  if (!qbId) return { syncToken: null, qbUpdatedAt: null };
  const raw = await writeService.fetchCurrent(entity, qbId);
  return {
    syncToken: qboSyncToken(raw, entity),
    qbUpdatedAt: qboMetaUpdatedAt(raw, entity),
  };
}

function assertSupportedOperation(row: AccountingSyncQueueRow): void {
  if (row.operation === "link" || row.operation === "reconcile") {
    needsReview(`QuickBooks outbound ${row.operation} operation requires operator review`);
  }

  if (row.operation === "void") {
    needsReview(`QuickBooks ${row.entityType} void requires operator review`);
  }

  if (row.operation === "delete_soft" && row.entityType !== "customer") {
    needsReview(`QuickBooks ${row.entityType} delete_soft requires operator review`);
  }
}

async function assertConnectionWritable(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
): Promise<void> {
  const connection = await maybeSingle(supabase, "accounting_connections", [
    ["id", row.connectionId],
    ["company_id", row.companyId],
    ["provider", "quickbooks"],
  ]);

  if (!connection) {
    needsReview("QuickBooks connection not found");
  }

  if (connection.is_connected !== true) {
    needsReview("QuickBooks connection is disconnected");
  }

  if (connection.sync_enabled === false) {
    needsReview("QuickBooks connection sync is disabled");
  }

  if (connection.sync_direction === "pull_only") {
    needsReview("QuickBooks connection is pull_only; outbound writes are disabled");
  }
}

async function prepareCustomerPush(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  writeService: QuickBooksWriteService,
): Promise<PreparedPush> {
  const client = await maybeSingle(supabase, "clients", [
    ["id", row.entityId],
    ["company_id", row.companyId],
  ]);
  if (!client) deterministicBlock("OPS customer row not found");

  const contactRows = await selectRows(supabase, "sub_clients", [
    ["client_id", row.entityId],
    ["company_id", row.companyId],
  ], "created_at");
  const entity = "Customer";
  const localQbId = cleanString(client.qb_id);
  const existingQbId = localQbId ?? cleanString(row.externalId);
  const current = await currentQboState(writeService, entity, existingQbId);
  const payload = mapClientToQboCustomer({
    client: mapClient({ ...client, qb_id: existingQbId }, current.syncToken),
    primaryContact: mapContact(contactRows[0] ?? null),
  });

  if (row.operation === "inactivate" || row.operation === "delete_soft") {
    payload.Active = false;
  }

  return {
    table: "clients",
    qboEntity: entity,
    payload,
    existingQbId,
    localQbIdMissing: !localQbId,
    opsUpdatedAt: cleanString(client.updated_at),
    qbUpdatedAt: current.qbUpdatedAt,
  };
}

async function prepareInvoicePush(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  writeService: QuickBooksWriteService,
  providerEnvironment: string | null | undefined,
): Promise<PreparedPush> {
  const invoice = await maybeSingle(supabase, "invoices", [
    ["id", row.entityId],
    ["company_id", row.companyId],
  ]);
  if (!invoice) deterministicBlock("OPS invoice row not found");

  const clientId = invoiceClientId(invoice);
  if (!clientId) deterministicBlock("OPS invoice client link missing");
  const client = await maybeSingle(supabase, "clients", [
    ["id", clientId],
    ["company_id", row.companyId],
  ]);
  if (!client) deterministicBlock("OPS invoice customer row not found");

  const lineItems = (await selectRows(supabase, "line_items", [
    ["invoice_id", row.entityId],
    ["company_id", row.companyId],
  ], "sort_order")).map(mapLineItem);
  const entity = "Invoice";
  const localQbId = cleanString(invoice.qb_id);
  const existingQbId = localQbId ?? cleanString(row.externalId);
  const current = await currentQboState(writeService, entity, existingQbId);

  try {
    return {
      table: "invoices",
      qboEntity: entity,
      payload: mapInvoiceToQboInvoice({
        invoice: {
          id: stringValue(invoice.id),
          qbId: existingQbId,
          syncToken: current.syncToken,
          docNumber: cleanString(invoice.invoice_number),
          total: numberOrString(invoice.total),
          issueDate: cleanString(invoice.issue_date),
          dueDate: cleanString(invoice.due_date),
        } satisfies OpsInvoiceForQbo,
        client: {
          id: stringValue(client.id),
          name: stringValue(client.name),
          qbId: cleanString(client.qb_id),
        },
        lineItems,
        fallbackServiceItem: fallbackServiceItem(providerEnvironment),
      }),
      existingQbId,
      localQbIdMissing: !localQbId,
      opsUpdatedAt: cleanString(invoice.updated_at),
      qbUpdatedAt: current.qbUpdatedAt,
    };
  } catch (error) {
    deterministicBlock(errorMessage(error));
  }
}

async function prepareEstimatePush(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  writeService: QuickBooksWriteService,
  providerEnvironment: string | null | undefined,
): Promise<PreparedPush> {
  const estimate = await maybeSingle(supabase, "estimates", [
    ["id", row.entityId],
    ["company_id", row.companyId],
  ]);
  if (!estimate) deterministicBlock("OPS estimate row not found");

  const clientId = estimateClientId(estimate);
  if (!clientId) deterministicBlock("OPS estimate client link missing");
  const client = await maybeSingle(supabase, "clients", [
    ["id", clientId],
    ["company_id", row.companyId],
  ]);
  if (!client) deterministicBlock("OPS estimate customer row not found");

  const lineItems = (await selectRows(supabase, "line_items", [
    ["estimate_id", row.entityId],
    ["company_id", row.companyId],
  ], "sort_order")).map(mapLineItem);
  const entity = "Estimate";
  const localQbId = cleanString(estimate.qb_id);
  const existingQbId = localQbId ?? cleanString(row.externalId);
  const current = await currentQboState(writeService, entity, existingQbId);

  try {
    return {
      table: "estimates",
      qboEntity: entity,
      payload: mapEstimateToQboEstimate({
        estimate: {
          id: stringValue(estimate.id),
          qbId: existingQbId,
          syncToken: current.syncToken,
          docNumber: cleanString(estimate.estimate_number),
          total: numberOrString(estimate.total),
          issueDate: cleanString(estimate.issue_date),
          expirationDate: cleanString(estimate.expiration_date),
        } satisfies OpsEstimateForQbo,
        client: {
          id: stringValue(client.id),
          name: stringValue(client.name),
          qbId: cleanString(client.qb_id),
        },
        lineItems,
        fallbackServiceItem: fallbackServiceItem(providerEnvironment),
      }),
      existingQbId,
      localQbIdMissing: !localQbId,
      opsUpdatedAt: cleanString(estimate.updated_at),
      qbUpdatedAt: current.qbUpdatedAt,
    };
  } catch (error) {
    deterministicBlock(errorMessage(error));
  }
}

async function preparePaymentPush(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  writeService: QuickBooksWriteService,
): Promise<PreparedPush> {
  const payment = await maybeSingle(supabase, "payments", [
    ["id", row.entityId],
    ["company_id", row.companyId],
  ]);
  if (!payment) deterministicBlock("OPS payment row not found");

  const clientId = cleanString(payment.client_id);
  if (!clientId) deterministicBlock("OPS payment customer link missing");
  const client = await maybeSingle(supabase, "clients", [
    ["id", clientId],
    ["company_id", row.companyId],
  ]);
  if (!client) deterministicBlock("OPS payment customer row not found");

  let invoiceLink: OpsInvoiceLinkForQbo | null = null;
  const invoiceId = cleanString(payment.invoice_id);
  if (invoiceId) {
    const invoice = await maybeSingle(supabase, "invoices", [
      ["id", invoiceId],
      ["company_id", row.companyId],
    ]);
    if (!invoice) deterministicBlock("OPS payment invoice row not found");
    invoiceLink = {
      id: stringValue(invoice.id),
      qbId: cleanString(invoice.qb_id),
      balanceDue: numberOrString(invoice.balance_due),
    };
  }

  const entity = "Payment";
  const localQbId = cleanString(payment.qb_id);
  const existingQbId = localQbId ?? cleanString(row.externalId);
  const current = await currentQboState(writeService, entity, existingQbId);

  try {
    return {
      table: "payments",
      qboEntity: entity,
      payload: mapPaymentToQboPayment({
        payment: {
          id: stringValue(payment.id),
          qbId: existingQbId,
          syncToken: current.syncToken,
          amount: numberOrString(payment.amount) ?? "",
          paymentDate: cleanString(payment.payment_date),
          referenceNumber: cleanString(payment.reference_number),
        } satisfies OpsPaymentForQbo,
        client: {
          id: stringValue(client.id),
          qbId: cleanString(client.qb_id),
        },
        invoice: invoiceLink,
      }),
      existingQbId,
      localQbIdMissing: !localQbId,
      opsUpdatedAt: cleanString(payment.created_at),
      qbUpdatedAt: current.qbUpdatedAt,
    };
  } catch (error) {
    deterministicBlock(errorMessage(error));
  }
}

async function preparePush(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  writeService: QuickBooksWriteService,
  providerEnvironment: string | null | undefined,
): Promise<PreparedPush> {
  assertSupportedOperation(row);

  switch (row.entityType) {
    case "customer":
      return prepareCustomerPush(supabase, row, writeService);
    case "invoice":
      return prepareInvoicePush(supabase, row, writeService, providerEnvironment);
    case "estimate":
      return prepareEstimatePush(supabase, row, writeService, providerEnvironment);
    case "payment":
      return preparePaymentPush(supabase, row, writeService);
  }
}

async function suppressThenWriteQbId(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  prepared: PreparedPush,
  qbId: string,
): Promise<void> {
  const { error: suppressError } = await supabase.rpc("suppress_accounting_sync", {
    p_company_id: row.companyId,
    p_provider: "quickbooks",
    p_entity_type: row.entityType,
    p_entity_id: row.entityId,
    p_source: "quickbooks",
    p_ttl_seconds: 600,
  });

  if (suppressError) {
    throw new Error(`sync suppression failed: ${suppressError.message}`);
  }

  const { error: updateError } = await supabase
    .from(prepared.table)
    .update({ qb_id: qbId })
    .eq("id", row.entityId)
    .eq("company_id", row.companyId);

  if (updateError) {
    throw new Error(`OPS qb_id writeback failed: ${updateError.message}`);
  }
}

async function performProviderWrite(input: {
  row: AccountingSyncQueueRow;
  prepared: PreparedPush;
  writeService: QuickBooksWriteService;
}): Promise<QuickBooksWriteResult> {
  const { row, prepared, writeService } = input;

  if (row.operation === "create" && !prepared.existingQbId) {
    return writeService.create(prepared.qboEntity, prepared.payload);
  }

  if (!prepared.existingQbId) {
    deterministicBlock(
      `QuickBooks ${row.entityType} ${row.operation} requires an existing qb_id or queue external_id`,
    );
  }

  return writeService.update(prepared.qboEntity, prepared.payload);
}

function auditBase(row: AccountingSyncQueueRow): Omit<AccountingSyncAuditInput, "status" | "source"> {
  return {
    queueId: row.id,
    companyId: row.companyId,
    connectionId: row.connectionId,
    provider: "quickbooks",
    direction: "ops_to_qb",
    entityType: row.entityType,
    entityId: row.entityId,
    externalId: row.externalId,
    operation: row.operation,
    opsUpdatedAt: row.sourceUpdatedAt,
  };
}

async function recordSuccess(
  audit: AccountingSyncAuditService,
  row: AccountingSyncQueueRow,
  prepared: PreparedPush,
  result: QuickBooksWriteResult,
): Promise<void> {
  await audit.record({
    ...auditBase(row),
    externalId: result.qbId,
    status: "succeeded",
    source: "worker",
    decision: "ops_won",
    opsUpdatedAt: prepared.opsUpdatedAt ?? row.sourceUpdatedAt,
    qbUpdatedAt: result.metaUpdatedAt,
    beforeSnapshot: {
      queueExternalId: row.externalId,
      operation: row.operation,
    },
    afterSnapshot: {
      qbId: result.qbId,
      syncToken: result.syncToken,
      metaUpdatedAt: result.metaUpdatedAt,
    },
  });
}

async function recordFailure(
  audit: AccountingSyncAuditService,
  row: AccountingSyncQueueRow,
  kind: FailureKind,
  message: string,
): Promise<void> {
  await audit.record({
    ...auditBase(row),
    status: kind === "retry" ? "failed" : kind,
    source: "worker",
    decision: kind === "retry" ? "retry" : kind,
    error: message,
    beforeSnapshot: {
      queueExternalId: row.externalId,
      operation: row.operation,
    },
  });
}

async function recordFailureBestEffort(
  audit: AccountingSyncAuditService,
  row: AccountingSyncQueueRow,
  kind: FailureKind,
  message: string,
): Promise<void> {
  try {
    await recordFailure(audit, row, kind, message);
  } catch {
    // Queue state is the durable recovery path; audit cannot block it.
  }
}

async function markPostProviderFinalizationFailed(input: {
  supabase: SupabaseClient;
  queue: AccountingSyncQueueService;
  audit: AccountingSyncAuditService;
  row: AccountingSyncQueueRow;
  workerId: string;
  qbId: string;
  message: string;
}): Promise<boolean> {
  const { supabase, queue, audit, row, workerId, qbId, message } = input;

  await recordFailureBestEffort(audit, row, "needs_review", message);

  let notificationCreated = false;
  try {
    await queue.markNeedsReview(row.id, message, { workerId, externalId: qbId });
    notificationCreated = await createReviewNotification(supabase, row, "needs_review");
  } catch {
    // Provider write already succeeded. Never schedule retry from this path.
  }

  return notificationCreated;
}

function firstAdminId(adminIds: unknown): string | null {
  if (Array.isArray(adminIds)) {
    return cleanString(adminIds[0]);
  }

  const raw = cleanString(adminIds);
  if (!raw) return null;

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return cleanString(parsed[0]);
    } catch {
      return null;
    }
  }

  return cleanString(raw.split(",")[0]);
}

async function createReviewNotification(
  supabase: SupabaseClient,
  row: AccountingSyncQueueRow,
  kind: "blocked" | "needs_review",
): Promise<boolean> {
  try {
    const company = await maybeSingle(supabase, "companies", [["id", row.companyId]]);
    const userId = firstAdminId(company?.admin_ids);
    if (!userId) return false;

    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      company_id: row.companyId,
      type: "accounting_sync",
      title: kind === "blocked" ? "QuickBooks sync blocked" : "QuickBooks sync needs review",
      body: "Open accounting settings to review the record.",
      is_read: false,
      persistent: true,
      action_url: NOTIFICATION_ACTION_URL,
      action_label: NOTIFICATION_ACTION_LABEL,
      dedupe_key: `qbo-sync:${row.companyId}:${row.entityType}:${row.entityId}:${kind}`,
      resolved_at: null,
    });

    return !error;
  } catch {
    return false;
  }
}

async function processQueueRow(input: {
  supabase: SupabaseClient;
  queue: AccountingSyncQueueService;
  audit: AccountingSyncAuditService;
  row: AccountingSyncQueueRow;
  workerId: string;
}): Promise<RowResult> {
  const { supabase, queue, audit, row, workerId } = input;

  try {
    await assertConnectionWritable(supabase, row);
    const { accessToken, realmId, providerEnvironment } =
      await AccountingTokenService.getValidToken(supabase, row.connectionId);
    if (!cleanString(accessToken)) needsReview("QuickBooks access token missing");
    if (!cleanString(realmId)) needsReview("QuickBooks realm id missing");

    const writeService = new QuickBooksWriteService({
      realmId: stringValue(realmId),
      accessToken: stringValue(accessToken),
      environment: providerEnvironment,
    });
    const prepared = await preparePush(supabase, row, writeService, providerEnvironment);
    const result = await performProviderWrite({ row, prepared, writeService });

    try {
      if (prepared.localQbIdMissing && cleanString(result.qbId)) {
        await suppressThenWriteQbId(supabase, row, prepared, result.qbId);
      }

      await recordSuccess(audit, row, prepared, result);
      await queue.markSucceeded(row.id, { externalId: result.qbId, workerId });
    } catch (finalizationError) {
      const message = `QuickBooks write succeeded but worker finalization failed: ${errorMessage(finalizationError)}`;
      const notificationCreated = await markPostProviderFinalizationFailed({
        supabase,
        queue,
        audit,
        row,
        workerId,
        qbId: result.qbId,
        message,
      });

      return {
        queueId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: "needs_review",
        externalId: result.qbId,
        error: message,
        notificationCreated,
      };
    }

    return {
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: "succeeded",
      externalId: result.qbId,
    };
  } catch (error) {
    const classified = classifyError(error);
    await recordFailureBestEffort(audit, row, classified.kind, classified.message);

    if (classified.kind === "retry") {
      await queue.scheduleRetry(row, classified.message, { workerId });
      return {
        queueId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: "retry",
        error: classified.message,
      };
    }

    if (classified.kind === "blocked") {
      await queue.markBlocked(row.id, classified.message, { workerId });
    } else {
      await queue.markNeedsReview(row.id, classified.message, { workerId });
    }

    const notificationCreated = await createReviewNotification(supabase, row, classified.kind);
    return {
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: classified.kind,
      error: classified.message,
      notificationCreated,
    };
  }
}

function summarize(workerId: string, results: RowResult[]) {
  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const retry = results.filter((result) => result.status === "retry").length;
  const blocked = results.filter((result) => result.status === "blocked").length;
  const needsReview = results.filter((result) => result.status === "needs_review").length;
  const failed = results.filter((result) => result.status !== "succeeded").length;
  const notificationsCreated = results.filter((result) => result.notificationCreated).length;

  return {
    ok: true,
    workerId,
    claimed: results.length,
    processed: results.length,
    succeeded,
    retry,
    blocked,
    needsReview,
    failed,
    notificationsCreated,
    results,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ACCOUNTING_WRITE_ENABLED !== "true") {
    return NextResponse.json(
      {
        code: "ACCOUNTING_WRITE_DISABLED",
        error: "Accounting writes are disabled",
      },
      { status: 409 },
    );
  }

  const supabase = getServiceRoleClient();
  const queue = new AccountingSyncQueueService(supabase);
  const audit = new AccountingSyncAuditService(supabase);
  const workerId = `qbo-push-${Date.now()}-${randomUUID()}`;
  const rows = await queue.claimDue({ provider: "quickbooks", limit: BATCH_LIMIT, workerId });
  const results: RowResult[] = [];

  for (const row of rows) {
    try {
      results.push(await processQueueRow({ supabase, queue, audit, row, workerId }));
    } catch (error) {
      results.push({
        queueId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }

  return NextResponse.json(summarize(workerId, results));
}

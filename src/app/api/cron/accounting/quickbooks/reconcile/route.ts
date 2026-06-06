import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";
import type { AccountingSyncEntityType } from "@/lib/api/services/accounting-sync-queue-types";
import {
  QuickBooksReconcileService,
  type ReconcileEnqueueInput,
  type ReconcileLinkedRecordResult,
} from "@/lib/api/services/quickbooks-reconcile-service";
import {
  QuickBooksWebhookApplyService,
  type ApplyEntityResult,
  type QboEntityName,
} from "@/lib/api/services/quickbooks-webhook-apply-service";
import { AccountingTokenService } from "@/lib/api/services/accounting-token-service";
import { getQuickBooksEnvironment } from "@/lib/api/services/quickbooks-config";
import { QuickBooksPullService } from "@/lib/api/services/quickbooks-pull-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROVIDER = "quickbooks";
const BATCH_LIMIT = 25;
const CONNECTION_LIMIT = 50;

type DbRow = Record<string, unknown>;

interface ConnectionRow {
  id: string;
  companyId: string;
  lastSyncAt: string | null;
}

interface LinkedRecord {
  entityType: AccountingSyncEntityType;
  sourceTable: "clients" | "invoices" | "estimates" | "payments";
  entityId: string;
  externalId: string;
  opsUpdatedAt: string | null;
  moneyTouched: boolean;
}

interface LatestAudit {
  opsUpdatedAt: string | null;
  qbUpdatedAt: string | null;
}

const ENTITY_TABLES: Array<{
  entityType: AccountingSyncEntityType;
  sourceTable: LinkedRecord["sourceTable"];
  moneyTouched: boolean;
}> = [
  { entityType: "customer", sourceTable: "clients", moneyTouched: false },
  { entityType: "invoice", sourceTable: "invoices", moneyTouched: true },
  { entityType: "estimate", sourceTable: "estimates", moneyTouched: true },
  { entityType: "payment", sourceTable: "payments", moneyTouched: true },
];

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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  if (typeof error === "string" && error.trim()) return error.slice(0, 500);
  return "QuickBooks reconcile failed";
}

function sourceTableFor(entityType: AccountingSyncEntityType): LinkedRecord["sourceTable"] {
  const config = ENTITY_TABLES.find((entry) => entry.entityType === entityType);
  if (!config) throw new Error(`Unsupported QuickBooks reconcile entity type: ${entityType}`);
  return config.sourceTable;
}

function qboEntityFor(entityType: AccountingSyncEntityType): QboEntityName {
  switch (entityType) {
    case "customer":
      return "Customer";
    case "invoice":
      return "Invoice";
    case "estimate":
      return "Estimate";
    case "payment":
      return "Payment";
  }
}

async function selectConnections(supabase: SupabaseClient): Promise<ConnectionRow[]> {
  const { data, error } = await supabase
    .from("accounting_connections")
    .select("id, company_id, last_sync_at")
    .eq("provider", PROVIDER)
    .eq("is_connected", true)
    .eq("sync_enabled", true)
    .eq("sync_direction", "bidirectional")
    .limit(CONNECTION_LIMIT);

  if (error) {
    throw new Error(`Failed to fetch QuickBooks connections: ${error.message}`);
  }

  return ((data ?? []) as DbRow[])
    .map((row) => ({
      id: stringValue(row.id),
      companyId: stringValue(row.company_id),
      lastSyncAt: cleanString(row.last_sync_at),
    }))
    .filter((row) => row.id && row.companyId);
}

async function recordWriteDisabledAudit(
  audit: AccountingSyncAuditService,
  connections: ConnectionRow[],
): Promise<void> {
  for (const connection of connections) {
    try {
      await audit.record({
        companyId: connection.companyId,
        connectionId: connection.id,
        provider: PROVIDER,
        direction: "system",
        entityType: "customer",
        entityId: null,
        externalId: null,
        operation: "reconcile",
        status: "blocked",
        source: "system",
        decision: "blocked",
        beforeSnapshot: {
          syncDirection: "bidirectional",
        },
        afterSnapshot: {
          accountingWriteEnabled: false,
        },
        error: "Accounting writes are disabled",
      });
    } catch {
      // The write gate remains closed even if audit persistence is unavailable.
    }
  }
}

async function selectLinkedRows(
  supabase: SupabaseClient,
  companyId: string,
  config: (typeof ENTITY_TABLES)[number],
  limit: number,
): Promise<LinkedRecord[]> {
  if (limit <= 0) return [];

  const { data, error } = await supabase
    .from(config.sourceTable)
    .select("id, qb_id, updated_at")
    .eq("company_id", companyId)
    .not("qb_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch linked ${config.sourceTable}: ${error.message}`);
  }

  return ((data ?? []) as DbRow[])
    .map((row) => ({
      entityType: config.entityType,
      sourceTable: config.sourceTable,
      entityId: stringValue(row.id),
      externalId: cleanString(row.qb_id) ?? "",
      opsUpdatedAt: cleanString(row.updated_at),
      moneyTouched: config.moneyTouched,
    }))
    .filter((row) => row.entityId && row.externalId);
}

async function latestAuditFor(
  supabase: SupabaseClient,
  connection: ConnectionRow,
  record: LinkedRecord,
): Promise<LatestAudit | null> {
  const { data, error } = await supabase
    .from("accounting_sync_events")
    .select("ops_updated_at, qb_updated_at, created_at")
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .eq("provider", PROVIDER)
    .eq("entity_type", record.entityType)
    .eq("external_id", record.externalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest QuickBooks audit event: ${error.message}`);
  }

  if (!data) return null;
  const row = data as DbRow;
  return {
    opsUpdatedAt: cleanString(row.ops_updated_at),
    qbUpdatedAt: cleanString(row.qb_updated_at),
  };
}

async function enqueueReconcileUpdate(
  supabase: SupabaseClient,
  input: ReconcileEnqueueInput,
): Promise<void> {
  const sourceTable = sourceTableFor(input.entityType);
  const idempotencyKey = `${input.entityType}:${input.entityId}`;
  const { data: existing, error: existingError } = await supabase
    .from("accounting_sync_queue")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("provider", PROVIDER)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .eq("operation", input.operation)
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "pending")
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check QuickBooks reconcile queue: ${existingError.message}`);
  }

  if (existing) return;

  const { error } = await supabase.from("accounting_sync_queue").insert({
    company_id: input.companyId,
    connection_id: input.connectionId,
    provider: PROVIDER,
    entity_type: input.entityType,
    entity_id: input.entityId,
    external_id: input.externalId,
    operation: input.operation,
    source_table: sourceTable,
    source_action: "update",
    source_updated_at: input.sourceUpdatedAt,
    idempotency_key: idempotencyKey,
    payload_snapshot: {
      source: "reconcile",
      table: sourceTable,
      entityType: input.entityType,
      entityId: input.entityId,
      qbId: input.externalId,
      updatedAt: input.sourceUpdatedAt,
    },
  });

  if (error) {
    if ((error as { code?: string }).code === "23505") return;
    throw new Error(`Failed to enqueue QuickBooks reconcile update: ${error.message}`);
  }
}

function auditStatusFor(result: ApplyEntityResult): "succeeded" | "failed" | "needs_review" | "skipped" {
  switch (result.status) {
    case "success":
      return "succeeded";
    case "skipped":
      return "skipped";
    case "needs_review":
      return "needs_review";
    case "error":
      return "failed";
  }
}

function auditDecisionFor(result: ApplyEntityResult): "qb_won" | "skipped" | "needs_review" {
  if (result.status === "success") return "qb_won";
  if (result.status === "skipped") return "skipped";
  return "needs_review";
}

function qboMetaUpdatedAt(record: Record<string, unknown> | null): string | null {
  const meta = record?.MetaData;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return cleanString((meta as DbRow).LastUpdatedTime);
}

async function fetchCurrentQbUpdatedAt(
  supabase: SupabaseClient,
  connection: ConnectionRow,
  record: LinkedRecord,
): Promise<string | null> {
  const { accessToken, realmId } = await AccountingTokenService.getValidToken(
    supabase,
    connection.id,
  );
  if (!realmId) {
    throw new Error("QuickBooks realmId not found on connection");
  }

  const pull = new QuickBooksPullService(realmId, accessToken, getQuickBooksEnvironment());
  const qbRecord = await pull.fetchEntityById(qboEntityFor(record.entityType), record.externalId);
  if (pull.qbWriteCalls !== 0) {
    throw new Error(`Read-only violation: QB write calls = ${pull.qbWriteCalls}`);
  }
  return qboMetaUpdatedAt(qbRecord as Record<string, unknown> | null);
}

async function applyQbEntityFromReconcile(
  applyService: QuickBooksWebhookApplyService,
  audit: AccountingSyncAuditService,
  connection: ConnectionRow,
  record: LinkedRecord,
): Promise<void> {
  const result = await applyService.applyEntity(
    { id: connection.id, company_id: connection.companyId },
    qboEntityFor(record.entityType),
    record.externalId,
    "Update",
  );
  await audit.record({
    companyId: connection.companyId,
    connectionId: connection.id,
    provider: PROVIDER,
    direction: "qb_to_ops",
    entityType: record.entityType,
    entityId: result.entityId ?? record.entityId,
    externalId: record.externalId,
    operation: "update",
    status: auditStatusFor(result),
    source: "reconcile",
    decision: auditDecisionFor(result),
    opsUpdatedAt: record.opsUpdatedAt,
    qbUpdatedAt: result.qbUpdatedAt ?? null,
    afterSnapshot: {
      status: result.status,
      detail: result.detail,
      ...(result.afterSnapshot ?? {}),
    },
    error:
      result.status === "error" || result.status === "needs_review" ? result.detail : null,
  });

  if (result.status === "error" || result.status === "needs_review") {
    throw new Error(result.detail ?? "QuickBooks estimate reconcile needs review");
  }
}

function materialDiff(
  record: LinkedRecord,
  latestAudit: LatestAudit | null,
  currentQbUpdatedAt: string | null,
): boolean {
  if (!latestAudit) return true;
  if (!latestAudit.opsUpdatedAt || !record.opsUpdatedAt) return true;
  if (latestAudit.opsUpdatedAt !== record.opsUpdatedAt) return true;
  if (!latestAudit.qbUpdatedAt) return true;
  return latestAudit.qbUpdatedAt !== currentQbUpdatedAt;
}

function applySummary(
  summary: { processed: number; opsWon: number; qbWon: number; needsReview: number },
  result: ReconcileLinkedRecordResult,
): void {
  summary.processed += 1;
  if (result.decision === "ops_won") summary.opsWon += 1;
  if (result.decision === "qb_won") summary.qbWon += 1;
  if (result.decision === "needs_review") summary.needsReview += 1;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const audit = new AccountingSyncAuditService(supabase);
  const connections = await selectConnections(supabase);

  if (process.env.ACCOUNTING_WRITE_ENABLED !== "true") {
    await recordWriteDisabledAudit(audit, connections);
    return NextResponse.json(
      {
        code: "ACCOUNTING_WRITE_DISABLED",
        error: "Accounting writes are disabled",
        processed: 0,
        opsWon: 0,
        qbWon: 0,
        needsReview: 0,
      },
      { status: 409 },
    );
  }

  const service = new QuickBooksReconcileService({
    audit,
    enqueue: (input) => enqueueReconcileUpdate(supabase, input),
  });
  const applyService = new QuickBooksWebhookApplyService(supabase);
  const summary = { processed: 0, opsWon: 0, qbWon: 0, needsReview: 0 };
  let remaining = BATCH_LIMIT;

  for (const connection of connections) {
    if (remaining <= 0) break;

    for (const config of ENTITY_TABLES) {
      if (remaining <= 0) break;

      const rows = await selectLinkedRows(supabase, connection.companyId, config, remaining);
      for (const record of rows) {
        if (remaining <= 0) break;

        try {
          const latestAudit = await latestAuditFor(supabase, connection, record);
          const currentQbUpdatedAt = await fetchCurrentQbUpdatedAt(supabase, connection, record);
          const result = await service.reconcileLinkedRecord({
            companyId: connection.companyId,
            connectionId: connection.id,
            entityType: record.entityType,
            entityId: record.entityId,
            externalId: record.externalId,
            opsUpdatedAt: record.opsUpdatedAt,
            qbUpdatedAt: currentQbUpdatedAt,
            materialDiff: materialDiff(record, latestAudit, currentQbUpdatedAt),
            moneyTouched: record.moneyTouched,
          });
          applySummary(summary, result);
          if (result.decision === "qb_won") {
            await applyQbEntityFromReconcile(applyService, audit, connection, record);
          }
        } catch (error) {
          summary.processed += 1;
          summary.needsReview += 1;
          try {
            await audit.record({
              companyId: connection.companyId,
              connectionId: connection.id,
              provider: PROVIDER,
              direction: "reconcile",
              entityType: record.entityType,
              entityId: record.entityId,
              externalId: record.externalId,
              operation: "reconcile",
              status: "needs_review",
              source: "reconcile",
              decision: "needs_review",
              opsUpdatedAt: record.opsUpdatedAt,
              qbUpdatedAt: null,
              error: errorMessage(error),
            });
          } catch {
            // Keep the bounded reconcile moving; the route summary remains visible to cron.
          }
        }

        remaining -= 1;
      }
    }
  }

  return NextResponse.json(summary);
}

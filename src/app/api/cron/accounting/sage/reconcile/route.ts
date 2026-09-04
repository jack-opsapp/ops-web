import { NextResponse } from "next/server";

import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";
import type { AccountingSyncQueueEntityType } from "@/lib/api/services/accounting-sync-queue-types";
import { AccountingTokenService } from "@/lib/api/services/accounting-token-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { createSageReadClient } from "@/lib/api/services/sage-api-client";
import { getSageProviderEnvironment } from "@/lib/api/services/sage-config";
import { SageInboundApplyService } from "@/lib/api/services/sage-inbound-apply-service";
import { normalizeSageRecord } from "@/lib/api/services/sage-normalize";
import {
  SageReconcileService,
  type SageReconcileCandidate,
} from "@/lib/api/services/sage-reconcile-service";
import { decryptToken } from "@/lib/api/services/token-cipher";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROVIDER = "sage";
const BATCH_LIMIT = 25;

type DbRow = Record<string, unknown>;

const ENTITY_CONFIG: Record<
  AccountingSyncQueueEntityType,
  { sourceTable: string; resources: readonly string[] }
> = {
  customer: { sourceTable: "clients", resources: ["contacts"] },
  invoice: { sourceTable: "invoices", resources: ["sales_invoices"] },
  estimate: {
    sourceTable: "estimates",
    resources: ["sales_quotes", "sales_estimates"],
  },
  payment: { sourceTable: "payments", resources: ["contact_payments"] },
  supplier: { sourceTable: "suppliers", resources: ["contacts"] },
  supplier_bill: {
    sourceTable: "supplier_bills",
    resources: ["purchase_invoices"],
  },
  supplier_bill_payment: {
    sourceTable: "supplier_bill_payments",
    resources: ["contact_payments"],
  },
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`
  );
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function required(value: unknown, label: string): string {
  const normalized = clean(value);
  if (!normalized) throw new Error(`Sage reconcile ${label} is missing.`);
  return normalized;
}

function entityType(value: unknown): AccountingSyncQueueEntityType {
  const normalized = required(value, "entity type");
  if (normalized in ENTITY_CONFIG) {
    return normalized as AccountingSyncQueueEntityType;
  }
  throw new Error(`Unsupported Sage reconcile entity type: ${normalized}`);
}

function direction(value: unknown): "pull_only" | "bidirectional" {
  if (value === "pull_only" || value === "bidirectional") return value;
  throw new Error("Sage reconcile direction is invalid.");
}

function parseCandidate(row: DbRow): SageReconcileCandidate {
  const parsedType = entityType(row.entity_type);
  const config = ENTITY_CONFIG[parsedType];
  const sourceTable = required(row.source_table, "source table");
  const resource = required(row.resource, "resource");
  if (
    sourceTable !== config.sourceTable ||
    !config.resources.includes(resource)
  ) {
    throw new Error(`Sage reconcile route mismatch for ${parsedType}.`);
  }

  return {
    companyId: required(row.company_id, "company identity"),
    connectionId: required(row.connection_id, "connection identity"),
    entityType: parsedType,
    entityId: required(row.entity_id, "entity identity"),
    externalId: required(row.external_id, "provider identity"),
    resource,
    opsUpdatedAt: clean(row.ops_updated_at),
    moneyTouched: row.money_touched === true,
    syncDirection: direction(row.sync_direction),
    propagateDeletes: row.propagate_deletes === true,
    latestAudit: clean(row.last_reconciled_at)
      ? {
          opsUpdatedAt: clean(row.last_audit_ops_updated_at),
          sageUpdatedAt: clean(row.last_audit_sage_updated_at),
        }
      : null,
  };
}

async function candidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  environment: "production" | "sandbox"
): Promise<SageReconcileCandidate[]> {
  const { data, error } = await db.rpc("list_sage_reconcile_candidates", {
    p_provider_environment: environment,
    p_limit: BATCH_LIMIT,
  });
  if (error) throw error;
  return ((data ?? []) as DbRow[]).map(parseCandidate);
}

async function businessBoundClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  candidate: SageReconcileCandidate,
  environment: "production" | "sandbox"
) {
  const { data: connection, error } = await db
    .from("accounting_connections")
    .select(
      "id, company_id, provider, provider_environment, is_connected, sync_enabled, sync_direction, propagate_deletes, sage_business_id"
    )
    .eq("id", candidate.connectionId)
    .eq("company_id", candidate.companyId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw error;
  if (
    !connection ||
    connection.provider_environment !== environment ||
    connection.is_connected !== true ||
    connection.sync_enabled !== true ||
    connection.sync_direction !== candidate.syncDirection ||
    connection.propagate_deletes !== candidate.propagateDeletes
  ) {
    throw new Error("Exact Sage reconciliation connection changed.");
  }

  const businessId = decryptToken(clean(connection.sage_business_id));
  if (!businessId) {
    throw new Error("Exact Sage business identity is unavailable.");
  }
  const token = await AccountingTokenService.getValidToken(
    db,
    candidate.connectionId
  );
  if (token.providerEnvironment !== environment) {
    throw new Error("Sage token and active provider environments differ.");
  }
  let accessToken = token.accessToken;
  return createSageReadClient({
    businessId,
    getAccessToken: async () => accessToken,
    refreshAccessToken: async () => {
      accessToken = await AccountingTokenService.forceRefresh(
        db,
        candidate.connectionId
      );
      return accessToken;
    },
    onDisconnect: () =>
      AccountingTokenService.disconnectGrant(
        db,
        candidate.connectionId,
        PROVIDER
      ),
  });
}

async function enqueue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  candidate: SageReconcileCandidate,
  environment: "production" | "sandbox"
): Promise<void> {
  const idempotencyKey = `${candidate.entityType}:${candidate.entityId}`;
  const { data: existing, error: existingError } = await db
    .from("accounting_sync_queue")
    .select("id")
    .eq("connection_id", candidate.connectionId)
    .eq("provider", PROVIDER)
    .eq("entity_type", candidate.entityType)
    .eq("entity_id", candidate.entityId)
    .eq("operation", "update")
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "pending")
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const { error } = await db.from("accounting_sync_queue").insert({
    company_id: candidate.companyId,
    connection_id: candidate.connectionId,
    provider: PROVIDER,
    entity_type: candidate.entityType,
    entity_id: candidate.entityId,
    external_id: candidate.externalId,
    operation: "update",
    source_table: ENTITY_CONFIG[candidate.entityType].sourceTable,
    source_action: "update",
    source_updated_at: candidate.opsUpdatedAt,
    idempotency_key: idempotencyKey,
    payload_snapshot: {
      source: "reconcile",
      providerEnvironment: environment,
      resource: candidate.resource,
    },
  });
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

function materiallyChanged(
  candidate: SageReconcileCandidate,
  providerUpdatedAt: string | null
): boolean {
  if (!candidate.latestAudit) return true;
  return !(
    candidate.latestAudit.opsUpdatedAt === candidate.opsUpdatedAt &&
    candidate.latestAudit.sageUpdatedAt === providerUpdatedAt
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : "Sage reconciliation failed.";
}

function increment(
  summary: {
    processed: number;
    opsWon: number;
    sageWon: number;
    skipped: number;
    needsReview: number;
  },
  decision: "ops_won" | "sage_won" | "skipped" | "needs_review"
) {
  summary.processed += 1;
  if (decision === "ops_won") summary.opsWon += 1;
  if (decision === "sage_won") summary.sageWon += 1;
  if (decision === "skipped") summary.skipped += 1;
  if (decision === "needs_review") summary.needsReview += 1;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: db,
      workloadKey: "sage-reconcile",
      leaseSeconds: 360,
      work: async () => {
        const environment = getSageProviderEnvironment();
        const audit = new AccountingSyncAuditService(db);
        const apply = new SageInboundApplyService(db);
        const service = new SageReconcileService({
          audit,
          enqueue: (candidate) => enqueue(db, candidate, environment),
          applyInbound: (candidate, provider) =>
            apply.apply(candidate, provider),
        });
        const summary = {
          ok: true,
          environment,
          processed: 0,
          opsWon: 0,
          sageWon: 0,
          skipped: 0,
          needsReview: 0,
        };

        for (const candidate of await candidates(db, environment)) {
          let serviceInvoked = false;
          try {
            const client = await businessBoundClient(
              db,
              candidate,
              environment
            );
            const raw = await client.get<Record<string, unknown>>(
              candidate.resource,
              candidate.externalId
            );
            const provider = raw
              ? normalizeSageRecord(
                  candidate.entityType,
                  candidate.resource,
                  raw
                )
              : null;
            serviceInvoked = true;
            const result = await service.reconcile({
              candidate,
              provider,
              materialDiff: materiallyChanged(
                candidate,
                provider?.updatedAt ?? null
              ),
              providerWritesEnabled:
                process.env.ACCOUNTING_WRITE_ENABLED === "true" &&
                process.env.SAGE_WRITE_ENABLED === "true",
            });
            increment(summary, result.decision);
          } catch (error) {
            summary.processed += 1;
            summary.needsReview += 1;
            if (!serviceInvoked) {
              try {
                await audit.record({
                  companyId: candidate.companyId,
                  connectionId: candidate.connectionId,
                  provider: PROVIDER,
                  direction: "reconcile",
                  entityType: candidate.entityType,
                  entityId: candidate.entityId,
                  externalId: candidate.externalId,
                  operation: "reconcile",
                  status: "needs_review",
                  source: "reconcile",
                  decision: "needs_review",
                  opsUpdatedAt: candidate.opsUpdatedAt,
                  error: errorMessage(error),
                });
              } catch {
                // Keep the bounded fair batch moving after an isolated failure.
              }
            }
          }
        }
        return NextResponse.json(summary);
      },
    });

    if (controlled.status === "skipped") {
      const held = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: held,
          ran: false,
          reason: held ? "already_running" : controlled.reason,
        },
        { status: held ? 200 : 503 }
      );
    }
    return controlled.value;
  } catch (error) {
    const detail = errorMessage(error);
    console.error("[cron/sage-reconcile]", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

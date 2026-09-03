import type { SupabaseClient } from "@supabase/supabase-js";

import { ProviderMappingError } from "@/lib/accounting/supplier-bills/provider-mappers";

import { AccountingSyncAuditService } from "./accounting-sync-audit-service";
import { AccountingSyncQueueService } from "./accounting-sync-queue-service";
import type {
  AccountingSyncQueueRow,
  SupplierBillSyncEntityType,
} from "./accounting-sync-queue-types";
import {
  AccountingTokenService,
  ReconnectRequiredError,
} from "./accounting-token-service";
import { SupplierBillProviderSyncService } from "./supplier-bill-provider-sync-service";

export type SupplierBillQueueRow =
  AccountingSyncQueueRow<SupplierBillSyncEntityType>;

export interface SupplierBillQueueResult {
  queueId: string;
  entityType: SupplierBillSyncEntityType;
  entityId: string;
  status: "succeeded" | "retry" | "blocked" | "needs_review";
  externalId?: string | null;
  error?: string;
}

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Supplier bill provider sync failed.";
}

async function recordAudit(
  audit: AccountingSyncAuditService,
  row: SupplierBillQueueRow,
  input: {
    status: "succeeded" | "blocked" | "needs_review" | "failed";
    decision: "ops_won" | "retry" | "blocked" | "needs_review";
    externalId?: string | null;
    error?: string | null;
  }
) {
  await audit.record({
    queueId: row.id,
    companyId: row.companyId,
    connectionId: row.connectionId,
    provider: row.provider,
    direction: row.provider === "quickbooks" ? "ops_to_qb" : "ops_to_sage",
    entityType: row.entityType,
    entityId: row.entityId,
    externalId: input.externalId,
    operation: row.operation,
    status: input.status,
    source: "worker",
    decision: input.decision,
    opsUpdatedAt: row.sourceUpdatedAt,
    afterSnapshot: input.externalId
      ? {
          externalId: input.externalId,
          finalized: input.status === "succeeded",
        }
      : {},
    error: input.error,
  });
}

export async function processSupplierBillQueueRow(input: {
  supabase: SupabaseClient;
  queue: AccountingSyncQueueService;
  audit: AccountingSyncAuditService;
  row: SupplierBillQueueRow;
  workerId: string;
}): Promise<SupplierBillQueueResult> {
  const { supabase, queue, audit, row, workerId } = input;
  try {
    const { data: connection, error: connectionError } = await supabase
      .from("accounting_connections")
      .select("provider, is_connected, sync_enabled, sync_direction")
      .eq("id", row.connectionId)
      .eq("company_id", row.companyId)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (
      !connection ||
      connection.provider !== row.provider ||
      connection.is_connected !== true ||
      connection.sync_enabled !== true ||
      !["push_only", "bidirectional"].includes(connection.sync_direction)
    ) {
      throw new ProviderMappingError(
        "accounting_connection_unavailable",
        "Accounting connection is not available for supplier bill writes."
      );
    }

    const token = await AccountingTokenService.getValidToken(
      supabase,
      row.connectionId
    );
    if (!token.accessToken) {
      throw new ProviderMappingError(
        "accounting_token_unavailable",
        "Accounting connection needs to be reconnected."
      );
    }
    if (row.provider === "quickbooks" && !token.realmId) {
      throw new ProviderMappingError(
        "qbo_realm_unavailable",
        "QuickBooks company identity is unavailable."
      );
    }

    const write = await new SupplierBillProviderSyncService(supabase, row, {
      accessToken: token.accessToken,
      realmId: token.realmId,
      providerEnvironment: token.providerEnvironment,
    }).write();

    const { data: finalized, error: finalizationError } = await supabase.rpc(
      "finalize_supplier_bill_provider_sync",
      {
        p_queue_id: row.id,
        p_worker_id: workerId,
        p_external_id: write.externalId,
        p_sync_token: write.syncToken,
        p_provider_updated_at: write.providerUpdatedAt,
      }
    );
    if (finalizationError || !finalized) {
      const failure = `Provider write succeeded but OPS finalization failed: ${message(finalizationError)}`;
      await queue.markNeedsReview(row.id, failure, {
        workerId,
        externalId: write.externalId,
      });
      await recordAudit(audit, row, {
        status: "needs_review",
        decision: "needs_review",
        externalId: write.externalId,
        error: failure,
      }).catch(() => undefined);
      return {
        queueId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: "needs_review",
        externalId: write.externalId,
        error: failure,
      };
    }

    await recordAudit(audit, row, {
      status: "succeeded",
      decision: "ops_won",
      externalId: write.externalId,
    }).catch(() => undefined);
    return {
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: "succeeded",
      externalId: write.externalId,
    };
  } catch (error) {
    const errorText = message(error);
    const needsReview =
      error instanceof ProviderMappingError ||
      error instanceof ReconnectRequiredError;
    if (needsReview) {
      await queue.markNeedsReview(row.id, errorText, { workerId });
      await recordAudit(audit, row, {
        status: "needs_review",
        decision: "needs_review",
        error: errorText,
      }).catch(() => undefined);
      return {
        queueId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: "needs_review",
        error: errorText,
      };
    }

    const retried = await queue.scheduleRetry(row, errorText, { workerId });
    const status = retried ? "retry" : "blocked";
    await recordAudit(audit, row, {
      status: retried ? "failed" : "blocked",
      decision: retried ? "retry" : "blocked",
      error: errorText,
    }).catch(() => undefined);
    return {
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status,
      error: errorText,
    };
  }
}

export function isSupplierBillQueueEntity(
  entityType: string
): entityType is SupplierBillSyncEntityType {
  return ["supplier", "supplier_bill", "supplier_bill_payment"].includes(
    entityType
  );
}

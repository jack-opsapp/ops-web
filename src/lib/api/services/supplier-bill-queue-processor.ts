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
import { createSageWriteClient } from "./sage-api-client";
import { assertSageWriteAllowed } from "./sage-config";
import { AcceptedWriteDurabilityError } from "./sage-queue-processor";
import { SupplierBillProviderSyncService } from "./supplier-bill-provider-sync-service";
import { decryptToken } from "./token-cipher";

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
      .select(
        "id, company_id, provider, provider_environment, is_connected, sync_enabled, sync_direction, sage_business_id"
      )
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

    const payloadEnvironment = row.payloadSnapshot.providerEnvironment;
    if (
      payloadEnvironment !== "sandbox" &&
      payloadEnvironment !== "production"
    ) {
      throw new ProviderMappingError(
        "accounting_queue_environment_invalid",
        "Accounting queue environment is unavailable."
      );
    }
    if (connection.provider_environment !== payloadEnvironment) {
      throw new ProviderMappingError(
        "accounting_queue_environment_mismatch",
        "Accounting queue and connection environments do not match."
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

    if (token.providerEnvironment !== connection.provider_environment) {
      throw new ProviderMappingError(
        "accounting_token_environment_mismatch",
        "Accounting token and connection environments do not match."
      );
    }

    let sageClient: ReturnType<typeof createSageWriteClient> | undefined;
    if (row.provider === "sage") {
      const businessId = decryptToken(connection.sage_business_id)?.trim();
      if (!businessId) {
        throw new ProviderMappingError(
          "sage_business_unavailable",
          "Sage business identity is unavailable."
        );
      }
      assertSageWriteAllowed({
        environment: token.providerEnvironment,
        businessId,
      });
      let accessToken = token.accessToken;
      sageClient = createSageWriteClient({
        businessId,
        getAccessToken: async () => accessToken,
        refreshAccessToken: async () => {
          accessToken = await AccountingTokenService.forceRefresh(
            supabase,
            row.connectionId
          );
          return accessToken;
        },
        onDisconnect: () =>
          AccountingTokenService.disconnectGrant(
            supabase,
            row.connectionId,
            "sage"
          ),
      });
    }

    const write = await new SupplierBillProviderSyncService(supabase, row, {
      accessToken: token.accessToken,
      realmId: token.realmId,
      providerEnvironment: token.providerEnvironment,
      sage: sageClient,
    }).write();

    if (row.provider === "sage") {
      if (!write.acceptedEvidence) {
        throw new AcceptedWriteDurabilityError(
          "Sage supplier write returned no acceptance evidence."
        );
      }
      const acceptedAt = Date.parse(write.acceptedEvidence.acceptedAt);
      if (!Number.isFinite(acceptedAt)) {
        throw new AcceptedWriteDurabilityError(
          "Sage supplier acceptance timestamp is invalid."
        );
      }
      try {
        await queue.recordProviderAcceptance({
          id: row.id,
          workerId,
          providerRequestId: write.acceptedEvidence.requestId ?? null,
          acceptedAt: write.acceptedEvidence.acceptedAt,
          idempotencyExpiresAt: new Date(
            acceptedAt + 7 * 24 * 60 * 60 * 1_000
          ).toISOString(),
        });
      } catch (cause) {
        throw new AcceptedWriteDurabilityError(
          "Sage supplier write was accepted but evidence could not be persisted.",
          { cause }
        );
      }
    }

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
    if (error instanceof AcceptedWriteDurabilityError) throw error;
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

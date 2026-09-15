import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProviderMappingError } from "@/lib/accounting/supplier-bills/provider-mappers";
import {
  expenseAccountingWritesEnabled,
  EXPENSE_ACCOUNTING_PAUSED_MESSAGE,
} from "@/lib/accounting/expenses/write-gate";
import { expenseMappingError } from "@/lib/accounting/expenses/provider-mappers";
import { AccountingSyncAuditService } from "./accounting-sync-audit-service";
import { AccountingSyncQueueService } from "./accounting-sync-queue-service";
import {
  AccountingTokenService,
  ReconnectRequiredError,
} from "./accounting-token-service";
import {
  ExpenseAccountingProviderService,
  type ExpenseProviderSession,
  type ExpenseQueueRow,
  type FrozenExpenseWrite,
} from "./expense-accounting-provider-service";
import { QuickBooksWriteService } from "./quickbooks-write-service";
import { createSageWriteClient, SageApiError } from "./sage-api-client";
import { assertSageWriteAllowed } from "./sage-config";
import { AcceptedWriteDurabilityError } from "./sage-queue-processor";
import { decryptToken } from "./token-cipher";
import { isDatabasePressureError } from "./cron-workload-error-contract";

const SAGE_REPLAY_MS = 7 * 24 * 60 * 60 * 1_000;
class ExpenseWriteGateError extends Error {}
type Connection = Record<string, unknown>;
type Token = {
  accessToken: string;
  realmId?: string | null;
  providerEnvironment: "sandbox" | "production";
};
type Acceptance = { acceptedAt: string; requestId?: string | null };
export interface ExpenseQueueResult {
  queueId: string;
  entityType: "expense";
  entityId: string;
  status: "succeeded" | "retry" | "blocked" | "needs_review";
  externalId?: string | null;
  error?: string;
}
export interface ExpenseQueueDependencies {
  loadConnection: () => Promise<Connection | null>;
  getToken: () => Promise<Token>;
  decryptBusinessId: (value: string) => string | null;
  assertSageAllowed: typeof assertSageWriteAllowed;
  createSession: (
    connection: Connection,
    token: Token,
    onAccepted: (evidence: Acceptance) => Promise<void>
  ) => Promise<ExpenseProviderSession>;
  prepare: (session: ExpenseProviderSession) => Promise<FrozenExpenseWrite>;
  finalize: (
    externalId: string,
    syncToken: string | null,
    updatedAt: string | null
  ) => Promise<boolean>;
  queue: Pick<
    AccountingSyncQueueService,
    "recordProviderAcceptance" | "markNeedsReview" | "markBlocked"
  > & {
    scheduleRetry: (
      row: ExpenseQueueRow,
      error: string,
      guard: { workerId: string }
    ) => Promise<ExpenseQueueRow | null>;
  };
  audit: (result: ExpenseQueueResult) => Promise<void>;
  now?: () => Date;
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String(
        (error as { message?: string })?.message ??
          "Expense accounting sync failed."
      );

export async function processExpenseQueueRow(input: {
  row: ExpenseQueueRow;
  workerId: string;
  dependencies: ExpenseQueueDependencies;
}): Promise<ExpenseQueueResult> {
  const { row, workerId, dependencies: deps } = input;
  if (
    row.status !== "claimed" ||
    row.lockedBy !== workerId ||
    row.entityType !== "expense" ||
    row.sourceTable !== "expense_accounting_events" ||
    row.operation !== "create"
  ) {
    throw new Error("Expense queue ownership or source is invalid.");
  }
  const base = {
    queueId: row.id,
    entityType: "expense" as const,
    entityId: row.entityId,
  };
  let accepted = false;
  let writeStarted = false;
  let externalId: string | null = null;
  const finish = async (result: ExpenseQueueResult) => {
    await deps.audit(result).catch(() => undefined);
    return result;
  };
  // Hold before connection/token reads or payload preparation. Keep this outside
  // the delivery catch: a failed guarded hold must propagate, never schedule a retry.
  if (!expenseAccountingWritesEnabled()) {
    const hasProviderEvidence = [
      row.providerAcceptedAt,
      row.providerRequestId,
      row.externalId,
      row.idempotencyExpiresAt,
    ].some((value) => value != null);
    if (hasProviderEvidence) {
      const error =
        "This expense has provider evidence. Reconcile its accounting result before retrying.";
      await deps.queue.markNeedsReview(row.id, error, { workerId });
      return finish({ ...base, status: "needs_review", error });
    }
    await deps.queue.markBlocked(row.id, EXPENSE_ACCOUNTING_PAUSED_MESSAGE, {
      workerId,
    });
    return finish({
      ...base,
      status: "blocked",
      error: EXPENSE_ACCOUNTING_PAUSED_MESSAGE,
    });
  }
  const acceptedEvidence = async (evidence: Acceptance) => {
    accepted = true;
    const acceptedMs = Date.parse(evidence.acceptedAt);
    if (!Number.isFinite(acceptedMs))
      throw new AcceptedWriteDurabilityError(
        "Expense provider acceptance timestamp is invalid."
      );
    try {
      await deps.queue.recordProviderAcceptance({
        id: row.id,
        workerId,
        acceptedAt: evidence.acceptedAt,
        providerRequestId: evidence.requestId ?? null,
        // Accepted writes never auto-replay. 1ms is QBO's local closed-replay cutoff,
        // not a claim about Intuit's retention; the shared RPC requires a positive interval.
        idempotencyExpiresAt: new Date(
          acceptedMs + (row.provider === "sage" ? SAGE_REPLAY_MS : 1)
        ).toISOString(),
      });
    } catch (cause) {
      throw new AcceptedWriteDurabilityError(
        "Expense provider accepted a write but OPS could not preserve its evidence.",
        { cause }
      );
    }
  };
  try {
    if (process.env.ACCOUNTING_WRITE_ENABLED !== "true") {
      const error = "Accounting writes are disabled.";
      await deps.queue.markBlocked(row.id, error, { workerId });
      return finish({ ...base, status: "blocked", error });
    }
    if (row.providerAcceptedAt)
      expenseMappingError(
        "expense_already_accepted",
        "This expense already has provider acceptance. Reconcile its accounting result before retrying."
      );
    const connection = await deps.loadConnection();
    const environment = row.payloadSnapshot.providerEnvironment;
    if (
      !connection ||
      connection.id !== row.connectionId ||
      connection.company_id !== row.companyId ||
      connection.provider !== row.provider ||
      connection.is_connected !== true ||
      connection.sync_enabled !== true ||
      !["push_only", "bidirectional"].includes(
        String(connection.sync_direction)
      ) ||
      !["sandbox", "production"].includes(String(environment)) ||
      connection.provider_environment !== environment
    ) {
      expenseMappingError(
        "expense_connection_unavailable",
        "The expense accounting connection is unavailable or its environment changed."
      );
    }
    const identity =
      row.provider === "quickbooks"
        ? connection.realm_id_lookup
        : connection.sage_business_id_lookup;
    if (!identity || row.payloadSnapshot.providerIdentitySnapshot !== identity)
      expenseMappingError(
        "expense_provider_identity_changed",
        "This expense was recorded for a different accounting company. Review its provider connection before syncing."
      );
    if (row.provider === "sage") {
      const businessId = deps.decryptBusinessId(
        String(connection.sage_business_id ?? "")
      );
      if (!businessId)
        expenseMappingError(
          "expense_sage_business_missing",
          "Reconnect Sage before syncing this expense."
        );
      try {
        deps.assertSageAllowed({
          environment: environment as "sandbox" | "production",
          businessId: businessId!,
        });
      } catch (cause) {
        throw new ExpenseWriteGateError(errorText(cause));
      }
    }
    const token = await deps.getToken();
    if (
      !token.accessToken ||
      token.providerEnvironment !== environment ||
      (row.provider === "quickbooks" && !token.realmId)
    ) {
      expenseMappingError(
        "expense_token_identity_invalid",
        "The accounting token or environment does not match this expense connection."
      );
    }
    const session = await deps.createSession(
      connection,
      token,
      acceptedEvidence
    );
    const frozen = await deps.prepare(session);
    if (
      row.provider === "sage" &&
      row.attempts > 1 &&
      (deps.now?.() ?? new Date()).getTime() - Date.parse(frozen.createdAt) >=
        SAGE_REPLAY_MS
    ) {
      expenseMappingError(
        "expense_replay_window_expired",
        "This expense exceeded Sage's safe replay window. Reconcile its provider history before retrying."
      );
    }
    writeStarted = true;
    let syncToken: string | null = null;
    let updatedAt: string | null = null;
    if (session.quickbooks) {
      if (
        frozen.payload.resource !== "JournalEntry" &&
        frozen.payload.resource !== "Purchase"
      )
        throw new Error("Invalid QuickBooks expense resource.");
      const result = await session.quickbooks.create(
        frozen.payload.resource,
        frozen.payload.body,
        frozen.payload.idempotencyId
      );
      externalId = result.qbId;
      syncToken = result.syncToken;
      updatedAt = result.metaUpdatedAt;
    } else if (session.sage) {
      if (
        frozen.payload.resource !== "journals" &&
        frozen.payload.resource !== "other_payments"
      )
        throw new Error("Invalid Sage expense resource.");
      const result = await session.sage.create<Record<string, unknown>>(
        frozen.payload.resource,
        frozen.payload.body,
        { resource: frozen.payload.resource, id: frozen.payload.idempotencyId }
      );
      const body = result.data;
      externalId = typeof body?.id === "string" ? body.id : null;
      updatedAt = typeof body?.updated_at === "string" ? body.updated_at : null;
    } else throw new Error("Expense provider session is unavailable.");
    if (!accepted)
      throw new AcceptedWriteDurabilityError(
        "Expense write returned without durable acceptance evidence."
      );
    if (!externalId?.trim())
      throw new Error(
        "Provider accepted the expense but returned no transaction identity."
      );
    if (!(await deps.finalize(externalId, syncToken, updatedAt)))
      throw new Error(
        "Provider accepted the expense but OPS could not finalize its accounting record."
      );
    return finish({ ...base, status: "succeeded", externalId });
  } catch (error) {
    if (error instanceof AcceptedWriteDurabilityError) throw error;
    if (!accepted && isDatabasePressureError(error)) throw error;
    const message = errorText(error);
    if (error instanceof ExpenseWriteGateError) {
      await deps.queue.markBlocked(row.id, message, { workerId });
      return finish({ ...base, status: "blocked", error: message });
    }
    const review =
      accepted ||
      row.providerAcceptedAt ||
      error instanceof ProviderMappingError ||
      error instanceof ReconnectRequiredError ||
      (error instanceof SageApiError && !error.retryable) ||
      (writeStarted && row.provider === "quickbooks");
    if (review) {
      try {
        await deps.queue.markNeedsReview(row.id, message, {
          workerId,
          externalId,
        });
      } catch (cause) {
        if (accepted)
          throw new AcceptedWriteDurabilityError(
            "Expense accepted-write review could not be saved.",
            { cause }
          );
        throw cause;
      }
      return finish({
        ...base,
        status: "needs_review",
        error: message,
        externalId,
      });
    }
    const retried = await deps.queue.scheduleRetry(row, message, { workerId });
    return finish({
      ...base,
      status: retried ? "retry" : "blocked",
      error: message,
    });
  }
}

export async function processExpenseAccountingQueueRow(input: {
  supabase: SupabaseClient;
  queue: AccountingSyncQueueService;
  audit: AccountingSyncAuditService;
  row: ExpenseQueueRow;
  workerId: string;
}): Promise<ExpenseQueueResult> {
  const { supabase, queue, audit, row, workerId } = input;
  const repository = new ExpenseAccountingProviderService(
    supabase,
    row,
    workerId
  );
  return processExpenseQueueRow({
    row,
    workerId,
    dependencies: {
      loadConnection: async () => {
        const { data, error } = await supabase
          .from("accounting_connections")
          .select(
            "id,company_id,provider,provider_environment,is_connected,sync_enabled,sync_direction,sage_business_id,realm_id_lookup,sage_business_id_lookup"
          )
          .eq("id", row.connectionId)
          .eq("company_id", row.companyId)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      getToken: () =>
        AccountingTokenService.getValidToken(supabase, row.connectionId),
      decryptBusinessId: decryptToken,
      assertSageAllowed: assertSageWriteAllowed,
      createSession: async (connection, token, onAccepted) => {
        if (row.provider === "quickbooks")
          return {
            providerTargetId: token.realmId!,
            environment: token.providerEnvironment,
            quickbooks: new QuickBooksWriteService({
              realmId: token.realmId!,
              accessToken: token.accessToken,
              environment: token.providerEnvironment,
              onAccepted,
            }),
          };
        const businessId = decryptToken(String(connection.sage_business_id))!;
        let accessToken = token.accessToken;
        return {
          providerTargetId: businessId,
          environment: token.providerEnvironment,
          sage: createSageWriteClient({
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
            onAccepted,
          }),
        };
      },
      prepare: (session) => repository.prepare(session),
      finalize: async (externalId, syncToken, updatedAt) => {
        const { data, error } = await supabase.rpc(
          "finalize_expense_accounting_sync",
          {
            p_queue_id: row.id,
            p_worker_id: workerId,
            p_external_id: externalId,
            p_sync_token: syncToken,
            p_provider_updated_at: updatedAt,
          }
        );
        if (error) throw error;
        return data === true;
      },
      queue,
      audit: async (result) => {
        await audit.record({
          queueId: row.id,
          companyId: row.companyId,
          connectionId: row.connectionId,
          provider: row.provider,
          direction:
            row.provider === "quickbooks" ? "ops_to_qb" : "ops_to_sage",
          entityType: "expense",
          entityId: row.entityId,
          operation: row.operation,
          externalId: result.externalId,
          status: result.status === "retry" ? "failed" : result.status,
          source: "worker",
          decision: result.status === "succeeded" ? "ops_won" : result.status,
          error: result.error,
        });
      },
    },
  });
}

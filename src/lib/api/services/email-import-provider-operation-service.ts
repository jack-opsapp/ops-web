import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runWithSupabase } from "@/lib/supabase/helpers";
import type { EmailConnection } from "@/lib/types/email-connection";
import {
  runWithEmailConnectionSyncLock,
  type EmailConnectionSyncLockRenewer,
  type EmailConnectionSyncLockRunResult,
} from "./email-connection-sync-lock";
import type { EmailProviderInterface } from "./email-provider";
import { EmailService } from "./email-service";

const OPS_PIPELINE_LABEL = "OPS Pipeline";
const DEFAULT_LIMIT = 5;
const DEFAULT_LEASE_SECONDS = 300;

export interface ClaimedEmailImportProviderOperation {
  id: string;
  importJobId: string;
  companyId: string;
  connectionId: string;
  providerThreadId: string;
  attemptCount: number;
}

export type EmailImportProviderLabelTransport = Pick<
  EmailProviderInterface,
  "listLabels" | "createLabel" | "applyLabel"
>;

export interface EmailImportProviderOperationStore {
  claim(input: {
    holder: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailImportProviderOperation[]>;
  authorize(input: { operationId: string; holder: string }): Promise<boolean>;
  persistOpsLabelId(input: {
    connectionId: string;
    companyId: string;
    providerLabelId: string;
  }): Promise<string>;
  complete(input: {
    operationId: string;
    holder: string;
    providerLabelId: string;
  }): Promise<boolean>;
  fail(input: {
    operationId: string;
    holder: string;
    error: string;
  }): Promise<boolean>;
}

export interface EmailImportProviderOperationDependencies extends EmailImportProviderOperationStore {
  loadConnection(connectionId: string): Promise<EmailConnection | null>;
  getLabelTransport(
    connection: EmailConnection
  ): EmailImportProviderLabelTransport;
  runWithMailboxLease<T>(input: {
    connectionId: string;
    run: (checkpoint: EmailConnectionSyncLockRenewer) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>>;
  workerId(): string;
}

export interface EmailImportProviderOperationOptions {
  limit?: number;
  leaseSeconds?: number;
}

export interface EmailImportProviderOperationResult {
  claimed: number;
  applied: number;
  failed: number;
  staleCompletions: number;
  staleFailures: number;
  errors: Array<{ operationId: string; error: string }>;
}

interface ProviderOperationRow {
  id: string;
  import_job_id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  operation_type: string;
  status: string;
  attempt_count: number | string;
  lease_holder: string | null;
  lease_expires_at: string | null;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

function firstBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value[0] === true;
  return false;
}

function mapClaimedOperation(
  row: ProviderOperationRow,
  holder: string
): ClaimedEmailImportProviderOperation {
  if (row.operation_type !== "apply_pipeline_label") {
    throw new Error("EMAIL_IMPORT_PROVIDER_OPERATION_UNSUPPORTED");
  }
  if (row.status !== "processing") {
    throw new Error("EMAIL_IMPORT_PROVIDER_OPERATION_NOT_PROCESSING");
  }
  if (
    row.lease_holder !== holder ||
    typeof row.lease_expires_at !== "string" ||
    !row.lease_expires_at.trim()
  ) {
    throw new Error("EMAIL_IMPORT_PROVIDER_OPERATION_LEASE_INVALID");
  }
  const attemptCount = Number(row.attempt_count);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new Error("EMAIL_IMPORT_PROVIDER_OPERATION_ATTEMPT_INVALID");
  }
  return {
    id: requiredString(row.id, "EMAIL_IMPORT_PROVIDER_OPERATION_ID_MISSING"),
    importJobId: requiredString(
      row.import_job_id,
      "EMAIL_IMPORT_PROVIDER_JOB_ID_MISSING"
    ),
    companyId: requiredString(
      row.company_id,
      "EMAIL_IMPORT_PROVIDER_COMPANY_ID_MISSING"
    ),
    connectionId: requiredString(
      row.connection_id,
      "EMAIL_IMPORT_PROVIDER_CONNECTION_ID_MISSING"
    ),
    providerThreadId: requiredString(
      row.provider_thread_id,
      "EMAIL_IMPORT_PROVIDER_THREAD_ID_MISSING"
    ),
    attemptCount,
  };
}

function validateConnection(
  operation: ClaimedEmailImportProviderOperation,
  connection: EmailConnection | null
): asserts connection is EmailConnection {
  if (
    !connection ||
    connection.id !== operation.connectionId ||
    connection.companyId !== operation.companyId ||
    connection.syncEnabled !== true ||
    !["active", "setup_incomplete"].includes(connection.status)
  ) {
    throw new Error("EMAIL_IMPORT_PROVIDER_CONNECTION_INVALID");
  }
}

function createLabelTransport(
  provider: EmailProviderInterface
): EmailImportProviderLabelTransport {
  // The worker receives this deliberately narrow facade. Sending, drafting,
  // archiving, and all other mailbox mutations are absent from its runtime
  // capability surface.
  return Object.freeze({
    listLabels: () => provider.listLabels(),
    createLabel: (name: string) => provider.createLabel(name),
    applyLabel: (threadId: string, labelId: string) =>
      provider.applyLabel(threadId, labelId),
  });
}

function emptyResult(): EmailImportProviderOperationResult {
  return {
    claimed: 0,
    applied: 0,
    failed: 0,
    staleCompletions: 0,
    staleFailures: 0,
    errors: [],
  };
}

export class EmailImportProviderOperationService {
  constructor(
    private readonly dependencies: EmailImportProviderOperationDependencies
  ) {}

  private async resolveLabelId(
    operation: ClaimedEmailImportProviderOperation,
    connection: EmailConnection,
    transport: EmailImportProviderLabelTransport,
    checkpoint: EmailConnectionSyncLockRenewer
  ): Promise<string> {
    const configuredLabelId = connection.opsLabelId?.trim();
    if (configuredLabelId) return configuredLabelId;

    await checkpoint();
    const labels = await transport.listLabels();
    await checkpoint();
    const existing = labels.find((label) => label.name === OPS_PIPELINE_LABEL);
    const discoveredLabelId = existing?.id?.trim();
    const providerLabelId =
      discoveredLabelId ||
      requiredString(
        await transport.createLabel(OPS_PIPELINE_LABEL),
        "EMAIL_IMPORT_PROVIDER_LABEL_ID_MISSING"
      );
    if (!discoveredLabelId) await checkpoint();

    return this.dependencies.persistOpsLabelId({
      connectionId: operation.connectionId,
      companyId: operation.companyId,
      providerLabelId,
    });
  }

  private async completeAfterProviderApply(input: {
    operationId: string;
    holder: string;
    providerLabelId: string;
  }): Promise<boolean> {
    try {
      return await this.dependencies.complete(input);
    } catch (firstError) {
      // The provider mutation is already accepted. Retry only the idempotent
      // database completion once; never call applyLabel a second time here.
      try {
        return await this.dependencies.complete(input);
      } catch (retryError) {
        throw new Error(
          `${errorMessage(firstError)}; completion retry failed: ${errorMessage(retryError)}`
        );
      }
    }
  }

  async process(
    options: EmailImportProviderOperationOptions = {}
  ): Promise<EmailImportProviderOperationResult> {
    const limit = boundedInteger(options.limit, DEFAULT_LIMIT, 1, 100);
    const leaseSeconds = boundedInteger(
      options.leaseSeconds,
      DEFAULT_LEASE_SECONDS,
      30,
      900
    );
    const holder = this.dependencies.workerId();
    const operations = await this.dependencies.claim({
      holder,
      limit,
      leaseSeconds,
    });
    const result = emptyResult();
    result.claimed = operations.length;

    for (const operation of operations) {
      try {
        const connection = await this.dependencies.loadConnection(
          operation.connectionId
        );
        validateConnection(operation, connection);
        const locked = await this.dependencies.runWithMailboxLease({
          connectionId: operation.connectionId,
          run: async (checkpoint) => {
            const authorizedBeforeProviderAccess =
              await this.dependencies.authorize({
                operationId: operation.id,
                holder,
              });
            if (!authorizedBeforeProviderAccess) {
              throw new Error("EMAIL_IMPORT_PROVIDER_OPERATION_FORBIDDEN");
            }
            await checkpoint();
            const transport = this.dependencies.getLabelTransport(connection);
            const providerLabelId = await this.resolveLabelId(
              operation,
              connection,
              transport,
              checkpoint
            );

            // Label discovery/creation can take long enough for the actor's
            // access or operation lease to change. Fence the exact operation
            // again at the last durable boundary before the provider thread is
            // mutated.
            const authorizedBeforeApply = await this.dependencies.authorize({
              operationId: operation.id,
              holder,
            });
            if (!authorizedBeforeApply) {
              throw new Error("EMAIL_IMPORT_PROVIDER_OPERATION_FORBIDDEN");
            }
            await checkpoint();
            await transport.applyLabel(
              operation.providerThreadId,
              providerLabelId
            );
            await checkpoint();
            const completed = await this.completeAfterProviderApply({
              operationId: operation.id,
              holder,
              providerLabelId,
            });
            return { completed, providerLabelId };
          },
        });
        if (!locked.acquired) {
          throw new Error("EMAIL_IMPORT_PROVIDER_MAILBOX_BUSY");
        }
        const { completed } = locked.value;
        if (!completed) {
          result.staleCompletions += 1;
          result.errors.push({
            operationId: operation.id,
            error: "EMAIL_IMPORT_PROVIDER_COMPLETION_STALE",
          });
          continue;
        }
        result.applied += 1;
      } catch (error) {
        const failure = errorMessage(error);
        result.failed += 1;
        try {
          const persisted = await this.dependencies.fail({
            operationId: operation.id,
            holder,
            error: failure,
          });
          if (!persisted) {
            result.staleFailures += 1;
            result.errors.push({
              operationId: operation.id,
              error: `${failure}; EMAIL_IMPORT_PROVIDER_FAILURE_WRITE_STALE`,
            });
            continue;
          }
        } catch (persistenceError) {
          result.errors.push({
            operationId: operation.id,
            error: `${failure}; failure persistence failed: ${errorMessage(persistenceError)}`,
          });
          continue;
        }
        result.errors.push({ operationId: operation.id, error: failure });
      }
    }

    return result;
  }
}

export function createSupabaseEmailImportProviderOperationStore(
  supabase: SupabaseClient
): EmailImportProviderOperationStore {
  return {
    async claim(input) {
      const { data, error } = await supabase.rpc(
        "claim_email_import_provider_operations",
        {
          p_holder: input.holder,
          p_limit: input.limit,
          p_lease_seconds: input.leaseSeconds,
        }
      );
      if (error) {
        throw new Error(
          `Email import provider operation claim failed: ${error.message}`
        );
      }
      return ((data ?? []) as ProviderOperationRow[]).map((row) =>
        mapClaimedOperation(row, input.holder)
      );
    },

    async authorize(input) {
      const { data, error } = await supabase.rpc(
        "authorize_email_import_provider_operation_as_system",
        {
          p_operation_id: input.operationId,
          p_holder: input.holder,
        }
      );
      if (error) {
        throw new Error(
          `Email import provider operation authorization failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async persistOpsLabelId(input) {
      const providerLabelId = requiredString(
        input.providerLabelId,
        "EMAIL_IMPORT_PROVIDER_LABEL_ID_MISSING"
      );
      const { data: updated, error: updateError } = await supabase
        .from("email_connections")
        .update({
          ops_label_id: providerLabelId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.connectionId)
        .eq("company_id", input.companyId)
        .eq("sync_enabled", true)
        .in("status", ["active", "setup_incomplete"])
        .is("ops_label_id", null)
        .select("id, company_id, ops_label_id")
        .maybeSingle();
      if (updateError) {
        throw new Error(
          `Email import provider label persistence failed: ${updateError.message}`
        );
      }
      if (
        updated?.id === input.connectionId &&
        updated.company_id === input.companyId &&
        updated.ops_label_id === providerLabelId
      ) {
        return providerLabelId;
      }

      // Another worker may have won the same mailbox-label race. Use only the
      // exact connection's now-canonical label; never overwrite it or borrow a
      // label from another connection.
      const { data: current, error: currentError } = await supabase
        .from("email_connections")
        .select("id, company_id, sync_enabled, status, ops_label_id")
        .eq("id", input.connectionId)
        .eq("company_id", input.companyId)
        .maybeSingle();
      if (currentError) {
        throw new Error(
          `Email import provider label reload failed: ${currentError.message}`
        );
      }
      if (
        !current ||
        current.id !== input.connectionId ||
        current.company_id !== input.companyId ||
        current.sync_enabled !== true ||
        !["active", "setup_incomplete"].includes(String(current.status))
      ) {
        throw new Error("EMAIL_IMPORT_PROVIDER_CONNECTION_INVALID");
      }
      return requiredString(
        current.ops_label_id,
        "EMAIL_IMPORT_PROVIDER_LABEL_PERSISTENCE_STALE"
      );
    },

    async complete(input) {
      const { data, error } = await supabase.rpc(
        "complete_email_import_provider_operation",
        {
          p_operation_id: input.operationId,
          p_holder: input.holder,
          p_provider_label_id: input.providerLabelId,
        }
      );
      if (error) {
        throw new Error(
          `Email import provider operation completion failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async fail(input) {
      const { data, error } = await supabase.rpc(
        "fail_email_import_provider_operation",
        {
          p_operation_id: input.operationId,
          p_holder: input.holder,
          p_error: input.error,
        }
      );
      if (error) {
        throw new Error(
          `Email import provider operation failure write failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },
  };
}

export async function runEmailImportProviderOperations(
  supabase: SupabaseClient,
  options: EmailImportProviderOperationOptions = {}
): Promise<EmailImportProviderOperationResult> {
  return runWithSupabase(supabase, async () => {
    const store = createSupabaseEmailImportProviderOperationStore(supabase);
    const service = new EmailImportProviderOperationService({
      ...store,
      loadConnection: (connectionId) =>
        EmailService.getConnection(connectionId),
      getLabelTransport: (connection) =>
        createLabelTransport(EmailService.getProvider(connection)),
      runWithMailboxLease: ({ connectionId, run }) =>
        runWithEmailConnectionSyncLock({
          connectionId,
          context: "email-import-provider-operation",
          client: supabase,
          run,
        }),
      workerId: () => randomUUID(),
    });
    return service.process(options);
  });
}

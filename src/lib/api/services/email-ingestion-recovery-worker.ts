import "server-only";

import type { EmailConnection } from "@/lib/types/email-connection";
import type { EmailConnectionSyncLockRunResult } from "./email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "./cron-workload-control-service";

const DEFAULT_LIMIT = 10;
const DEFAULT_LEASE_SECONDS = 360;

export type EmailIngestionRecoveryKind =
  "lead_classification" | "provider_label_apply";

export interface ClaimedEmailIngestionRecovery {
  id: string;
  companyId: string;
  connectionId: string;
  kind: EmailIngestionRecoveryKind;
  providerThreadId: string;
  providerMessageId: string | null;
  providerLabelId: string | null;
  attempts: number;
}

export type EmailIngestionRecoveryFailureDisposition =
  "retrying" | "failed" | "stale";

export interface EmailIngestionRecoveryDependencies {
  claim(input: {
    holder: string;
    companyIds: string[];
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailIngestionRecovery[]>;
  reauthorize(input: { queueId: string; holder: string }): Promise<boolean>;
  loadConnection(connectionId: string): Promise<EmailConnection | null>;
  runWithMailboxLease<T>(input: {
    connectionId: string;
    run: (
      checkpoint: EmailProviderMailboxCheckpoint,
      syncLockOwner: string
    ) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>>;
  applyProviderLabel(input: {
    job: ClaimedEmailIngestionRecovery;
    connection: EmailConnection;
    providerLockCheckpoint: EmailProviderMailboxCheckpoint;
    syncLockOwner: string;
  }): Promise<void>;
  recoverLeadClassification(input: {
    job: ClaimedEmailIngestionRecovery;
    connection: EmailConnection;
    providerLockCheckpoint: EmailProviderMailboxCheckpoint;
    syncLockOwner: string;
  }): Promise<"promoted" | "resolved">;
  complete(input: {
    queueId: string;
    holder: string;
    outcome:
      "classification_recovered" | "label_applied" | "stale_configuration";
  }): Promise<boolean>;
  fail(input: {
    queueId: string;
    holder: string;
    error: string;
  }): Promise<EmailIngestionRecoveryFailureDisposition>;
  workerId(): string;
}

export interface EmailIngestionRecoveryWorkerOptions {
  companyIds: string[];
  limit?: number;
  leaseSeconds?: number;
}

export interface EmailIngestionRecoveryWorkerResult {
  claimed: number;
  classificationsRecovered: number;
  promoted: number;
  labelsApplied: number;
  retrying: number;
  failed: number;
  stale: number;
  staleCompletions: number;
  errors: Array<{ queueId: string; error: string }>;
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

function emptyResult(): EmailIngestionRecoveryWorkerResult {
  return {
    claimed: 0,
    classificationsRecovered: 0,
    promoted: 0,
    labelsApplied: 0,
    retrying: 0,
    failed: 0,
    stale: 0,
    staleCompletions: 0,
    errors: [],
  };
}

function validateConnection(
  job: ClaimedEmailIngestionRecovery,
  connection: EmailConnection | null
): asserts connection is EmailConnection {
  if (
    !connection ||
    connection.id !== job.connectionId ||
    connection.companyId !== job.companyId ||
    connection.status !== "active" ||
    connection.syncEnabled !== true
  ) {
    throw new Error("EMAIL_INGESTION_RECOVERY_CONNECTION_INVALID");
  }
}

function validateJob(job: ClaimedEmailIngestionRecovery): void {
  if (!job.providerThreadId.trim()) {
    throw new Error("EMAIL_INGESTION_RECOVERY_THREAD_ID_MISSING");
  }
  if (!job.providerMessageId?.trim()) {
    throw new Error("EMAIL_INGESTION_RECOVERY_MESSAGE_ID_MISSING");
  }
  if (job.kind === "provider_label_apply" && !job.providerLabelId?.trim()) {
    throw new Error("EMAIL_INGESTION_RECOVERY_LABEL_ID_MISSING");
  }
}

async function databaseOperation<T>(
  operation: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isDatabasePressureError(error)) {
      throw error instanceof CronDatabaseOperationError
        ? error
        : new CronDatabaseOperationError(
            `${operation}: ${errorMessage(error)}`,
            { cause: error }
          );
    }
    throw error;
  }
}

export class EmailIngestionRecoveryWorker {
  constructor(
    private readonly dependencies: EmailIngestionRecoveryDependencies
  ) {}

  private async recordFailure(
    result: EmailIngestionRecoveryWorkerResult,
    job: ClaimedEmailIngestionRecovery,
    holder: string,
    error: string
  ): Promise<void> {
    const disposition = await databaseOperation(
      "Email ingestion recovery failure persistence failed",
      () =>
        this.dependencies.fail({
          queueId: job.id,
          holder,
          error,
        })
    );
    result[disposition] += 1;
    if (disposition !== "stale") {
      result.errors.push({ queueId: job.id, error });
    }
  }

  async process(
    options: EmailIngestionRecoveryWorkerOptions
  ): Promise<EmailIngestionRecoveryWorkerResult> {
    const result = emptyResult();
    const companyIds = Array.from(
      new Set(options.companyIds.map((id) => id.trim()).filter(Boolean))
    );
    if (companyIds.length === 0) return result;

    const holder = this.dependencies.workerId();
    const jobs = await databaseOperation(
      "Email ingestion recovery claim failed",
      () =>
        this.dependencies.claim({
          holder,
          companyIds,
          limit: boundedInteger(options.limit, DEFAULT_LIMIT, 1, 50),
          leaseSeconds: boundedInteger(
            options.leaseSeconds,
            DEFAULT_LEASE_SECONDS,
            60,
            900
          ),
        })
    );
    result.claimed = jobs.length;

    for (const job of jobs) {
      try {
        validateJob(job);
        const connection = await databaseOperation(
          "Email ingestion recovery mailbox read failed",
          () => this.dependencies.loadConnection(job.connectionId)
        );
        validateConnection(job, connection);

        const mailboxLease = await this.dependencies.runWithMailboxLease({
          connectionId: job.connectionId,
          run: async (checkpoint, syncLockOwner) => {
            if (
              !(await databaseOperation(
                "Email ingestion recovery reauthorization failed",
                () =>
                  this.dependencies.reauthorize({
                    queueId: job.id,
                    holder,
                  })
              ))
            ) {
              throw new Error("EMAIL_INGESTION_RECOVERY_AUTHORIZATION_STALE");
            }

            if (
              job.kind === "provider_label_apply" &&
              connection.opsLabelId !== job.providerLabelId
            ) {
              return "stale_configuration" as const;
            }

            await checkpoint();
            if (job.kind === "provider_label_apply") {
              await this.dependencies.applyProviderLabel({
                job,
                connection,
                providerLockCheckpoint: checkpoint,
                syncLockOwner,
              });
              await checkpoint();
              return "label_applied" as const;
            }

            const classification =
              await this.dependencies.recoverLeadClassification({
                job,
                connection,
                providerLockCheckpoint: checkpoint,
                syncLockOwner,
              });
            await checkpoint();
            return classification === "promoted"
              ? ("classification_promoted" as const)
              : ("classification_recovered" as const);
          },
        });
        if (!mailboxLease.acquired) {
          throw new Error("EMAIL_INGESTION_RECOVERY_MAILBOX_BUSY");
        }

        const leaseOutcome = mailboxLease.value;
        const completionOutcome =
          leaseOutcome === "classification_promoted"
            ? "classification_recovered"
            : leaseOutcome;
        const completed = await databaseOperation(
          "Email ingestion recovery completion failed",
          () =>
            this.dependencies.complete({
              queueId: job.id,
              holder,
              outcome: completionOutcome,
            })
        );
        if (!completed) {
          result.staleCompletions += 1;
          continue;
        }
        if (leaseOutcome === "label_applied") {
          result.labelsApplied += 1;
        } else if (leaseOutcome === "stale_configuration") {
          result.stale += 1;
        } else {
          result.classificationsRecovered += 1;
          if (leaseOutcome === "classification_promoted") {
            result.promoted += 1;
          }
        }
      } catch (error) {
        if (isDatabasePressureError(error)) throw error;
        await this.recordFailure(result, job, holder, errorMessage(error));
      }
    }

    return result;
  }
}

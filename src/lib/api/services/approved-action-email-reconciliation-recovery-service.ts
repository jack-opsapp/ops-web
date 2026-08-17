import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailConnection } from "@/lib/types/email-connection";
import type { ApprovedActionEmailIntent } from "./approved-action-email-delivery-service";
import { ApprovedActionEmailIntentService } from "./approved-action-email-intent-service";
import { reconcileApprovedActionEmail } from "./approved-action-email-reconciliation-service";
import { isDatabasePressureError } from "./cron-workload-control-service";
import {
  runWithEmailConnectionSyncLock,
  type EmailConnectionSyncLockRunResult,
} from "./email-connection-sync-lock";
import type { EmailProviderInterface } from "./email-provider";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";
import { EmailService } from "./email-service";

type ApprovedActionReconciliationProvider = Pick<
  EmailProviderInterface,
  "applyLabel"
>;

interface ApprovedActionReconciliationIntentStore {
  finalizeExpiredReconciliations(input: { limit: number }): Promise<number>;
  claimNextReconciliation(input: {
    failedBefore: Date | string;
    leaseSeconds: number;
  }): Promise<ApprovedActionEmailIntent | null>;
  renewReconciliation(input: {
    intentId: string;
    leaseToken: string;
    leaseSeconds: number;
  }): Promise<ApprovedActionEmailIntent>;
  completeReconciliation(input: {
    intentId: string;
    leaseToken: string;
    activityId: string;
  }): Promise<ApprovedActionEmailIntent>;
  failReconciliation(input: {
    intentId: string;
    leaseToken: string;
    error: string;
  }): Promise<ApprovedActionEmailIntent>;
  releaseReconciliation(input: {
    intentId: string;
    leaseToken: string;
    error: string;
  }): Promise<ApprovedActionEmailIntent>;
  projectNextAlert(): Promise<{
    processed: boolean;
    succeeded: boolean;
    error: string | null;
  }>;
}

export interface ApprovedActionEmailReconciliationRecoveryDependencies {
  intentStore: ApprovedActionReconciliationIntentStore;
  getConnection: (connectionId: string) => Promise<EmailConnection | null>;
  getProvider: (
    connection: EmailConnection
  ) => ApprovedActionReconciliationProvider;
  reconcile: (
    intent: ApprovedActionEmailIntent,
    connection: EmailConnection,
    provider: ApprovedActionReconciliationProvider,
    checkpoint: EmailProviderMailboxCheckpoint
  ) => Promise<{ activityId: string }>;
  runWithMailboxLease<T>(input: {
    connectionId: string;
    run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>>;
  now?: () => Date;
}

export interface ApprovedActionEmailReconciliationRecoveryOptions {
  limit?: number;
  failureCooldownSeconds?: number;
  leaseSeconds?: number;
}

export interface ApprovedActionEmailReconciliationRecoveryResult {
  claimed: number;
  reconciled: number;
  failed: number;
  /** Final-budget failures. This is a subset of `failed`. */
  exhausted: number;
  errors: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReconciliationLeaseInvalid(error: unknown): boolean {
  return message(error).includes(
    "APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID"
  );
}

/**
 * Scheduled recovery for provider-accepted approved actions. The worker owns
 * no provider-delivery capability: it receives only an `applyLabel` wrapper
 * and can therefore replay OPS persistence without ever sending another email.
 */
export class ApprovedActionEmailReconciliationRecoveryService {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: ApprovedActionEmailReconciliationRecoveryDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async process(
    options: ApprovedActionEmailReconciliationRecoveryOptions = {}
  ): Promise<ApprovedActionEmailReconciliationRecoveryResult> {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const failureCooldownSeconds = Math.min(
      Math.max(options.failureCooldownSeconds ?? 60, 1),
      3600
    );
    const leaseSeconds = Math.min(
      Math.max(options.leaseSeconds ?? 300, 30),
      900
    );
    const failedBefore = new Date(
      this.now().getTime() - failureCooldownSeconds * 1000
    ).toISOString();
    let claimed = 0;
    let reconciled = 0;
    let failed = 0;
    let exhausted = 0;
    const errors: string[] = [];

    try {
      const finalized =
        await this.dependencies.intentStore.finalizeExpiredReconciliations({
          limit,
        });
      if (finalized > 0) {
        failed += finalized;
        exhausted += finalized;
        errors.push(
          `${finalized} expired approved-action email reconciliations exhausted their retry budget`
        );
      }
    } catch (error) {
      if (isDatabasePressureError(error)) throw error;
      failed += 1;
      errors.push(
        `approved-action email reconciliation finalization failed: ${message(error)}`
      );
    }

    for (let index = 0; index < limit; index += 1) {
      const intent =
        await this.dependencies.intentStore.claimNextReconciliation({
          failedBefore,
          leaseSeconds,
        });
      if (!intent) break;
      claimed += 1;

      const leaseToken = intent.reconciliationLeaseToken;
      if (!leaseToken) {
        failed += 1;
        errors.push(
          `${intent.id}: APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_MISSING`
        );
        continue;
      }

      try {
        const connection = await this.dependencies.getConnection(
          intent.connectionId
        );
        if (
          !connection ||
          connection.id !== intent.connectionId ||
          connection.companyId !== intent.companyId
        ) {
          throw new Error(
            "APPROVED_ACTION_EMAIL_RECONCILIATION_CONNECTION_INVALID"
          );
        }

        const provider = this.dependencies.getProvider(connection);
        const recoveryProvider: ApprovedActionReconciliationProvider = {
          applyLabel: provider.applyLabel.bind(provider),
        };
        const locked = await this.dependencies.runWithMailboxLease({
          connectionId: intent.connectionId,
          run: async (mailboxCheckpoint) => {
            const reconciliationCheckpoint: EmailProviderMailboxCheckpoint =
              async (force = false) => {
                await mailboxCheckpoint(force);
                await this.dependencies.intentStore.renewReconciliation({
                  intentId: intent.id,
                  leaseToken,
                  leaseSeconds,
                });
                await mailboxCheckpoint(force);
              };

            await reconciliationCheckpoint(true);
            const result = await this.dependencies.reconcile(
              intent,
              connection,
              recoveryProvider,
              reconciliationCheckpoint
            );
            await reconciliationCheckpoint(true);
            await this.dependencies.intentStore.completeReconciliation({
              intentId: intent.id,
              leaseToken,
              activityId: result.activityId,
            });
            return result;
          },
        });
        if (!locked.acquired) {
          const busyError = "APPROVED_ACTION_EMAIL_RECONCILIATION_MAILBOX_BUSY";
          await this.dependencies.intentStore.releaseReconciliation({
            intentId: intent.id,
            leaseToken,
            error: busyError,
          });
          failed += 1;
          errors.push(`${intent.id}: ${busyError}`);
          continue;
        }
        reconciled += 1;
      } catch (error) {
        const failure = message(error);
        if (isReconciliationLeaseInvalid(error)) {
          failed += 1;
          errors.push(`${intent.id}: ${failure}`);
          continue;
        }
        if (isDatabasePressureError(error)) {
          try {
            await this.dependencies.intentStore.releaseReconciliation({
              intentId: intent.id,
              leaseToken,
              error: failure,
            });
          } catch {
            // The lease expires without spending retry budget if pressure also
            // prevents release. Preserve the original classified error so the
            // shared workload circuit opens with the right evidence.
          }
          throw error;
        }

        try {
          const failedIntent =
            await this.dependencies.intentStore.failReconciliation({
              intentId: intent.id,
              leaseToken,
              error: failure,
            });
          if (failedIntent.reconciliationExhaustedAt) exhausted += 1;
        } catch (leaseError) {
          if (isDatabasePressureError(leaseError)) throw leaseError;
          errors.push(
            `${intent.id}: ${failure}; recovery lease update failed: ${message(leaseError)}`
          );
          failed += 1;
          continue;
        }

        errors.push(`${intent.id}: ${failure}`);
        failed += 1;
      }
    }

    for (let index = 0; index < limit; index += 1) {
      try {
        const projection =
          await this.dependencies.intentStore.projectNextAlert();
        if (!projection.processed) break;
        if (!projection.succeeded) {
          failed += 1;
          errors.push(
            `approved-action email reconciliation alert projection failed: ${projection.error ?? "unknown error"}`
          );
          break;
        }
      } catch (error) {
        if (isDatabasePressureError(error)) throw error;
        failed += 1;
        errors.push(
          `approved-action email reconciliation alert projection failed: ${message(error)}`
        );
        break;
      }
    }

    return { claimed, reconciled, failed, exhausted, errors };
  }
}

export async function runApprovedActionEmailReconciliationRecovery(
  supabase: SupabaseClient,
  options: ApprovedActionEmailReconciliationRecoveryOptions = {}
): Promise<ApprovedActionEmailReconciliationRecoveryResult> {
  const service = new ApprovedActionEmailReconciliationRecoveryService({
    intentStore: new ApprovedActionEmailIntentService(supabase),
    getConnection: (connectionId) => EmailService.getConnection(connectionId),
    getProvider: (connection) => EmailService.getProvider(connection),
    reconcile: (intent, connection, provider, checkpoint) =>
      reconcileApprovedActionEmail({
        supabase,
        intent,
        connection,
        provider,
        providerLockCheckpoint: checkpoint,
      }),
    runWithMailboxLease: ({ connectionId, run }) =>
      runWithEmailConnectionSyncLock({
        connectionId,
        context: "approved-action-email-reconciliation-recovery",
        client: supabase,
        abortOnDatabaseError: true,
        run,
      }),
  });
  return service.process(options);
}

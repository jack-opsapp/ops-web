import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailConnection } from "@/lib/types/email-connection";
import type { EmailProviderInterface } from "./email-provider";
import {
  EmailSendIntentService,
  type EmailSendIntent,
} from "./email-send-intent-service";
import { reconcileEmailSend } from "./email-send-reconciliation-service";
import { EmailService } from "./email-service";

interface ReconciliationIntentStore {
  claimNextReconciliation(input: {
    failedBefore: Date | string;
    leaseSeconds: number;
  }): Promise<EmailSendIntent | null>;
  completeReconciliation(input: {
    intentId: string;
    leaseToken: string;
    activityId: string;
  }): Promise<EmailSendIntent>;
  failReconciliation(input: {
    intentId: string;
    leaseToken: string;
    error: string;
  }): Promise<EmailSendIntent>;
}

export interface EmailSendReconciliationRecoveryDependencies {
  intentStore: ReconciliationIntentStore;
  getConnection: (connectionId: string) => Promise<EmailConnection | null>;
  getProvider: (connection: EmailConnection) => EmailProviderInterface;
  reconcile: (
    intent: EmailSendIntent,
    connection: EmailConnection,
    provider: EmailProviderInterface
  ) => Promise<{ activityId: string }>;
  now?: () => Date;
}

export interface EmailSendReconciliationRecoveryOptions {
  limit?: number;
  failureCooldownSeconds?: number;
  leaseSeconds?: number;
}

export interface EmailSendReconciliationRecoveryResult {
  claimed: number;
  reconciled: number;
  failed: number;
  errors: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Scheduled post-provider recovery. This class only leases accepted intents
 * and resumes OPS persistence; provider delivery is intentionally absent.
 */
export class EmailSendReconciliationRecoveryService {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: EmailSendReconciliationRecoveryDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async process(
    options: EmailSendReconciliationRecoveryOptions = {}
  ): Promise<EmailSendReconciliationRecoveryResult> {
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
    const errors: string[] = [];

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
        errors.push(`${intent.id}: EMAIL_SEND_RECONCILIATION_LEASE_MISSING`);
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
          throw new Error("EMAIL_SEND_RECONCILIATION_CONNECTION_INVALID");
        }
        const provider = this.dependencies.getProvider(connection);
        const result = await this.dependencies.reconcile(
          intent,
          connection,
          provider
        );
        await this.dependencies.intentStore.completeReconciliation({
          intentId: intent.id,
          leaseToken,
          activityId: result.activityId,
        });
        reconciled += 1;
      } catch (error) {
        const failure = message(error);
        try {
          await this.dependencies.intentStore.failReconciliation({
            intentId: intent.id,
            leaseToken,
            error: failure,
          });
        } catch (leaseError) {
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

    return { claimed, reconciled, failed, errors };
  }
}

export async function runEmailSendReconciliationRecovery(
  supabase: SupabaseClient,
  options: EmailSendReconciliationRecoveryOptions = {}
): Promise<EmailSendReconciliationRecoveryResult> {
  const service = new EmailSendReconciliationRecoveryService({
    intentStore: new EmailSendIntentService(supabase),
    getConnection: (connectionId) => EmailService.getConnection(connectionId),
    getProvider: (connection) => EmailService.getProvider(connection),
    reconcile: (intent, connection, provider) =>
      reconcileEmailSend({ supabase, intent, connection, provider }),
  });
  return service.process(options);
}

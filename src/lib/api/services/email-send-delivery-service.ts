import "server-only";

import type { EmailProviderInterface } from "./email-provider";
import { isDefinitiveEmailProviderRejection } from "./email-provider-mutation-attempt-service";
import type {
  EmailSendIntent,
  PrepareEmailSendIntentInput,
} from "./email-send-intent-service";
import type { EmailConnectionSyncLockRunResult } from "./email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";

export interface EmailSendReconciliationResult {
  activityId: string;
}

interface EmailSendIntentStore {
  prepare(input: PrepareEmailSendIntentInput): Promise<EmailSendIntent>;
  claimProviderDelivery(intentId: string): Promise<EmailSendIntent | null>;
  persistProviderAcceptance(input: {
    intentId: string;
    providerMessageId: string;
    providerThreadId: string;
    acceptedAt: Date | string;
  }): Promise<EmailSendIntent>;
  markProviderRejected(input: {
    intentId: string;
    error: string;
  }): Promise<EmailSendIntent>;
  markDeliveryUnknown(
    intentId: string,
    error: string
  ): Promise<EmailSendIntent>;
  claimReconciliation(intentId: string): Promise<EmailSendIntent | null>;
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

interface EmailSendDeliveryDependencies {
  intentStore: EmailSendIntentStore;
  provider: Pick<EmailProviderInterface, "sendEmail">;
  reconcile: (
    intent: EmailSendIntent,
    providerLockCheckpoint: EmailProviderMailboxCheckpoint
  ) => Promise<EmailSendReconciliationResult>;
  runWithMailboxLease<T>(input: {
    connectionId: string;
    run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>>;
  now?: () => Date;
}

export interface EmailSendDeliveryOutcome {
  state: "reconciled" | "pending" | "rejected" | "delivery_unknown";
  delivered: boolean;
  intentId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  activityId: string | null;
  error: string | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcome(
  state: EmailSendDeliveryOutcome["state"],
  intent: EmailSendIntent,
  overrides: Partial<EmailSendDeliveryOutcome> = {}
): EmailSendDeliveryOutcome {
  return {
    state,
    delivered: Boolean(intent.providerMessageId),
    intentId: intent.id,
    providerMessageId: intent.providerMessageId,
    providerThreadId: intent.acceptedProviderThreadId,
    activityId: intent.reconciledActivityId,
    error: intent.lastError,
    ...overrides,
  };
}

/**
 * Provider-delivery state machine. The durable intent is the single authority:
 * only a freshly claimed `prepared` row may call the provider, while every
 * accepted retry resumes database reconciliation without another send.
 */
export class EmailSendDeliveryService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: EmailSendDeliveryDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(
    prepareInput: PrepareEmailSendIntentInput
  ): Promise<EmailSendDeliveryOutcome> {
    const prepared = await this.dependencies.intentStore.prepare(prepareInput);

    if (prepared.status === "reconciled") {
      return outcome("reconciled", prepared, { delivered: true });
    }
    if (prepared.status === "provider_rejected") {
      return outcome("rejected", prepared, { delivered: false });
    }
    if (
      prepared.status === "sending" ||
      prepared.status === "delivery_unknown" ||
      prepared.status === "reconciling"
    ) {
      return outcome("pending", prepared);
    }

    const locked = await this.dependencies.runWithMailboxLease({
      connectionId: prepared.connectionId,
      run: (checkpoint) => this.executeUnderMailboxLease(prepared, checkpoint),
    });
    if (!locked.acquired) {
      return outcome("pending", prepared, {
        delivered: false,
        error: "EMAIL_SEND_MAILBOX_BUSY",
      });
    }
    return locked.value;
  }

  private async executeUnderMailboxLease(
    prepared: EmailSendIntent,
    checkpoint: EmailProviderMailboxCheckpoint
  ): Promise<EmailSendDeliveryOutcome> {
    let accepted = prepared;
    if (
      prepared.status !== "provider_accepted" &&
      prepared.status !== "reconciliation_failed"
    ) {
      const claimed = await this.dependencies.intentStore.claimProviderDelivery(
        prepared.id
      );
      if (!claimed) return outcome("pending", prepared);

      let providerResult: { messageId: string; threadId: string };
      try {
        await checkpoint();
        providerResult = await this.dependencies.provider.sendEmail({
          to: claimed.toEmails,
          cc: claimed.ccEmails,
          subject: claimed.subject,
          body: claimed.renderedBody,
          contentType: claimed.contentType,
          inReplyTo: claimed.senderSwitched
            ? undefined
            : (claimed.inReplyTo ?? undefined),
          threadId: claimed.senderSwitched
            ? undefined
            : (claimed.replyProviderThreadId ?? undefined),
        });
      } catch (error) {
        if (isDefinitiveEmailProviderRejection(error)) {
          const rejected =
            await this.dependencies.intentStore.markProviderRejected({
              intentId: claimed.id,
              error: message(error),
            });
          return outcome("rejected", rejected, { delivered: false });
        }
        const unknown = await this.dependencies.intentStore.markDeliveryUnknown(
          claimed.id,
          message(error)
        );
        return outcome("delivery_unknown", unknown, { delivered: false });
      }

      if (
        !providerResult.messageId?.trim() ||
        !providerResult.threadId?.trim()
      ) {
        const unknown = await this.dependencies.intentStore.markDeliveryUnknown(
          claimed.id,
          "EMAIL_SEND_INVALID_PROVIDER_IDS"
        );
        return outcome("delivery_unknown", unknown, { delivered: true });
      }

      try {
        accepted =
          await this.dependencies.intentStore.persistProviderAcceptance({
            intentId: claimed.id,
            providerMessageId: providerResult.messageId,
            providerThreadId: providerResult.threadId,
            acceptedAt: this.now(),
          });
      } catch (error) {
        // Both idempotent acceptance-persistence attempts failed. The provider
        // result is known but the intent must remain non-resendable; sync or an
        // operator recovery can reconcile by immutable provider identity.
        try {
          await this.dependencies.intentStore.markDeliveryUnknown(
            claimed.id,
            `PROVIDER_ACCEPTED_PERSISTENCE_FAILED: ${message(error)}`
          );
        } catch {
          // Preserve the original persistence failure. The delivery claim is
          // already `sending`, so a retry still cannot invoke the provider.
        }
        return outcome("pending", claimed, {
          delivered: true,
          providerMessageId: providerResult.messageId,
          providerThreadId: providerResult.threadId,
          error: message(error),
        });
      }

      try {
        // The immutable provider identity is durable before this ownership
        // check. Lease loss pauses reconciliation but cannot cause a resend.
        await checkpoint();
      } catch (error) {
        return outcome("pending", accepted, {
          delivered: true,
          error: message(error),
        });
      }
    }

    return this.reconcileAccepted(accepted, checkpoint);
  }

  private async reconcileAccepted(
    accepted: EmailSendIntent,
    checkpoint: EmailProviderMailboxCheckpoint
  ): Promise<EmailSendDeliveryOutcome> {
    let lastError: string | null = null;

    // The first inline attempt covers the normal path; one immediate retry
    // covers transient persistence failures. Further retries are left to the
    // durable reconciliation worker and never revisit provider delivery.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const leased = await this.dependencies.intentStore.claimReconciliation(
        accepted.id
      );
      if (!leased?.reconciliationLeaseToken) {
        return outcome("pending", accepted, {
          delivered: true,
          error: lastError,
        });
      }

      try {
        await checkpoint();
        const reconciled = await this.dependencies.reconcile(
          leased,
          checkpoint
        );
        await checkpoint();
        const completed =
          await this.dependencies.intentStore.completeReconciliation({
            intentId: leased.id,
            leaseToken: leased.reconciliationLeaseToken,
            activityId: reconciled.activityId,
          });
        return outcome("reconciled", completed, { delivered: true });
      } catch (error) {
        lastError = message(error);
        await this.dependencies.intentStore.failReconciliation({
          intentId: leased.id,
          leaseToken: leased.reconciliationLeaseToken,
          error: lastError,
        });
      }
    }

    return outcome("pending", accepted, {
      delivered: true,
      error: lastError,
    });
  }
}

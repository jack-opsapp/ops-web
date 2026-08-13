import type { EmailProviderInterface } from "./email-provider";
import type { EmailConnectionSyncLockRunResult } from "./email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";
import { isDatabasePressureError } from "./cron-workload-control-service";
import { isDefinitiveEmailProviderRejection } from "./email-provider-mutation-attempt-service";

const APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_SECONDS = 300;

export type ApprovedActionEmailExecutionMode = "manual" | "autonomous";

export type ApprovedActionEmailIntentStatus =
  | "awaiting_signature"
  | "prepared"
  | "sending"
  | "provider_accepted"
  | "reconciling"
  | "reconciliation_failed"
  | "reconciled"
  | "provider_rejected"
  | "delivery_unknown";

export interface PrepareApprovedActionEmailIntentInput {
  actionId: string;
  executionMode: ApprovedActionEmailExecutionMode;
  signatureId: string;
  signatureContentHash: string;
  authoredBodyHash: string;
  renderedBody: string;
  renderedBodyHash: string;
}

export interface ApprovedActionEmailIntent {
  id: string;
  actionId: string;
  actionType: string;
  actionDataSnapshot: Record<string, unknown>;
  companyId: string;
  actorUserId: string;
  executionMode: ApprovedActionEmailExecutionMode;
  idempotencyKey: string;
  connectionId: string;
  opportunityId: string | null;
  assignmentVersion: number | null;
  assignmentEventId: string | null;
  clientId: string | null;
  projectId: string | null;
  invoiceId: string | null;
  sourceEmailThreadId: string | null;
  replyProviderThreadId: string | null;
  inReplyTo: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  authoredBody: string;
  renderedBody: string;
  contentType: "text" | "html";
  draftHistoryId: string | null;
  sourceDraftHistoryId: string | null;
  profileTypeSnapshot: string;
  learningAuthority: "operator_approved" | "autonomous";
  actorNameSnapshot: string;
  actorEmailSnapshot: string;
  clientFromAddressSnapshot: string;
  signatureId: string | null;
  signatureContentHash: string | null;
  renderedBodyHash: string | null;
  status: ApprovedActionEmailIntentStatus;
  providerMessageId: string | null;
  acceptedProviderThreadId: string | null;
  providerAcceptedAt: string | null;
  reconciliationAttempts: number;
  maxReconciliationAttempts: number;
  reconciliationLeaseToken: string | null;
  reconciliationLeaseExpiresAt: string | null;
  reconciliationExhaustedAt: string | null;
  reconciledActivityId: string | null;
  lastError: string | null;
}

export interface ApprovedActionEmailIntentStore {
  prepare(
    input: PrepareApprovedActionEmailIntentInput
  ): Promise<ApprovedActionEmailIntent>;
  claimProviderDelivery(
    intentId: string
  ): Promise<ApprovedActionEmailIntent | null>;
  persistProviderAcceptance(input: {
    intentId: string;
    providerMessageId: string;
    providerThreadId: string;
    acceptedAt: Date | string;
  }): Promise<ApprovedActionEmailIntent>;
  markProviderRejected(input: {
    intentId: string;
    error: string;
  }): Promise<ApprovedActionEmailIntent>;
  markDeliveryUnknown(input: {
    intentId: string;
    error: string;
    providerMessageId?: string | null;
    providerThreadId?: string | null;
  }): Promise<ApprovedActionEmailIntent>;
  claimReconciliation(
    intentId: string
  ): Promise<ApprovedActionEmailIntent | null>;
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
}

export interface ApprovedActionEmailDeliveryOutcome {
  state:
    | "awaiting_signature"
    | "pending"
    | "reconciled"
    | "provider_rejected"
    | "delivery_unknown";
  delivered: boolean;
  intentId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  activityId: string | null;
  error: string | null;
}

interface ApprovedActionEmailDeliveryDependencies {
  store: ApprovedActionEmailIntentStore;
  provider: Pick<EmailProviderInterface, "sendEmail">;
  reconcile: (
    intent: ApprovedActionEmailIntent,
    providerLockCheckpoint: EmailProviderMailboxCheckpoint
  ) => Promise<{ activityId: string }>;
  runWithMailboxLease<T>(input: {
    connectionId: string;
    run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>>;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ApprovedActionEmailFailureDisposition =
  "pre_provider_retryable" | "provider_outcome_owned";

/**
 * Distinguishes a failure that happened before the durable provider claim from
 * one whose provider outcome is already owned by the intent state machine.
 * Callers may retry only the former; the latter must be reconciled and must
 * never be converted into a fresh send attempt.
 */
export class ApprovedActionEmailExecutionError extends Error {
  readonly failureDisposition: ApprovedActionEmailFailureDisposition;
  readonly cause: unknown;

  constructor(
    failureDisposition: ApprovedActionEmailFailureDisposition,
    cause: unknown
  ) {
    super(errorMessage(cause));
    this.name = "ApprovedActionEmailExecutionError";
    this.failureDisposition = failureDisposition;
    this.cause = cause;
  }
}

export function approvedActionEmailFailureDisposition(
  error: unknown
): ApprovedActionEmailFailureDisposition | null {
  return error instanceof ApprovedActionEmailExecutionError
    ? error.failureDisposition
    : null;
}

function statusOwnsProviderOutcome(
  status: ApprovedActionEmailIntentStatus
): boolean {
  return status !== "awaiting_signature" && status !== "prepared";
}

function outcome(
  state: ApprovedActionEmailDeliveryOutcome["state"],
  intent: ApprovedActionEmailIntent,
  overrides: Partial<ApprovedActionEmailDeliveryOutcome> = {}
): ApprovedActionEmailDeliveryOutcome {
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
 * Durable provider-delivery state machine for an agent action. Only a newly
 * claimed `prepared` intent may touch the provider. Every later invocation is
 * either terminal or resumes database reconciliation from the stored provider
 * identity, so an uncertain provider outcome can never become a duplicate.
 */
export class ApprovedActionEmailDeliveryService {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: ApprovedActionEmailDeliveryDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(
    input: PrepareApprovedActionEmailIntentInput
  ): Promise<ApprovedActionEmailDeliveryOutcome> {
    let providerOutcomeOwned = false;
    try {
      const prepared = await this.dependencies.store.prepare(input);
      providerOutcomeOwned = statusOwnsProviderOutcome(prepared.status);

      if (prepared.status === "awaiting_signature") {
        return outcome("awaiting_signature", prepared, { delivered: false });
      }
      if (prepared.status === "reconciled") {
        return outcome("reconciled", prepared, { delivered: true });
      }
      if (prepared.status === "provider_rejected") {
        return outcome("provider_rejected", prepared, { delivered: false });
      }
      if (prepared.status === "delivery_unknown") {
        return outcome("delivery_unknown", prepared);
      }
      if (prepared.status === "sending") {
        return outcome("pending", prepared);
      }

      const locked = await this.dependencies.runWithMailboxLease({
        connectionId: prepared.connectionId,
        run: (checkpoint) =>
          this.executeUnderMailboxLease(prepared, checkpoint, () => {
            providerOutcomeOwned = true;
          }),
      });
      if (!locked.acquired) {
        return outcome("pending", prepared, {
          delivered: false,
          error: "APPROVED_ACTION_EMAIL_MAILBOX_BUSY",
        });
      }
      return locked.value;
    } catch (error) {
      if (error instanceof ApprovedActionEmailExecutionError) throw error;
      throw new ApprovedActionEmailExecutionError(
        providerOutcomeOwned
          ? "provider_outcome_owned"
          : "pre_provider_retryable",
        error
      );
    }
  }

  private async executeUnderMailboxLease(
    prepared: ApprovedActionEmailIntent,
    checkpoint: EmailProviderMailboxCheckpoint,
    markProviderOutcomeOwned: () => void
  ): Promise<ApprovedActionEmailDeliveryOutcome> {
    let accepted = prepared;
    if (
      prepared.status !== "provider_accepted" &&
      prepared.status !== "reconciliation_failed" &&
      prepared.status !== "reconciling"
    ) {
      // Prove mailbox-lease ownership before the final database authorization
      // claim. A checkpoint failure therefore leaves the intent prepared and
      // safely retryable. Once the claim returns `sending`, every failure is
      // provider-outcome-owned and can never authorize a fresh send.
      await checkpoint();
      const claimed = await this.dependencies.store.claimProviderDelivery(
        prepared.id
      );
      if (!claimed) return outcome("pending", prepared);
      markProviderOutcomeOwned();

      let providerResult: { messageId: string; threadId: string };
      try {
        providerResult = await this.dependencies.provider.sendEmail({
          to: claimed.toEmails,
          cc: claimed.ccEmails,
          subject: claimed.subject,
          body: claimed.renderedBody,
          contentType: claimed.contentType,
          inReplyTo: claimed.inReplyTo ?? undefined,
          threadId: claimed.replyProviderThreadId ?? undefined,
        });
      } catch (error) {
        if (isDefinitiveEmailProviderRejection(error)) {
          const rejected = await this.dependencies.store.markProviderRejected({
            intentId: claimed.id,
            error: errorMessage(error),
          });
          return outcome("provider_rejected", rejected, { delivered: false });
        }

        const unknown = await this.dependencies.store.markDeliveryUnknown({
          intentId: claimed.id,
          error: errorMessage(error),
        });
        return outcome("delivery_unknown", unknown, { delivered: false });
      }

      const providerMessageId = providerResult.messageId?.trim();
      const providerThreadId = providerResult.threadId?.trim();
      if (!providerMessageId || !providerThreadId) {
        const unknown = await this.dependencies.store.markDeliveryUnknown({
          intentId: claimed.id,
          error: "APPROVED_ACTION_EMAIL_INVALID_PROVIDER_IDS",
          providerMessageId: providerMessageId || null,
          providerThreadId: providerThreadId || null,
        });
        return outcome("delivery_unknown", unknown, { delivered: true });
      }

      let acceptanceError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          accepted = await this.dependencies.store.persistProviderAcceptance({
            intentId: claimed.id,
            providerMessageId,
            providerThreadId,
            acceptedAt: this.now(),
          });
          acceptanceError = null;
          break;
        } catch (error) {
          acceptanceError = error;
        }
      }

      if (acceptanceError) {
        try {
          await this.dependencies.store.markDeliveryUnknown({
            intentId: claimed.id,
            error: `APPROVED_ACTION_EMAIL_ACCEPTANCE_PERSISTENCE_FAILED: ${errorMessage(acceptanceError)}`,
            providerMessageId,
            providerThreadId,
          });
        } catch {
          // The durable delivery claim already fences this intent in `sending`.
          // A retry therefore remains non-resendable even while the database is
          // unavailable to record the more specific unknown-delivery state.
        }
        return outcome("delivery_unknown", claimed, {
          delivered: true,
          providerMessageId,
          providerThreadId,
          error: errorMessage(acceptanceError),
        });
      }

      try {
        // Persist provider acceptance before proving lease ownership again.
        // A retry can now reconcile this exact send without resending it.
        await checkpoint();
      } catch (error) {
        return outcome("pending", accepted, {
          delivered: true,
          error: errorMessage(error),
        });
      }
    }

    return this.reconcileAccepted(accepted, checkpoint);
  }

  private async reconcileAccepted(
    accepted: ApprovedActionEmailIntent,
    checkpoint: EmailProviderMailboxCheckpoint
  ): Promise<ApprovedActionEmailDeliveryOutcome> {
    let lastError: string | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const leased = await this.dependencies.store.claimReconciliation(
        accepted.id
      );
      if (!leased?.reconciliationLeaseToken) {
        return outcome("pending", accepted, {
          delivered: true,
          error: lastError,
        });
      }

      const leaseToken = leased.reconciliationLeaseToken;
      const reconciliationCheckpoint: EmailProviderMailboxCheckpoint = async (
        force = false
      ) => {
        await checkpoint(force);
        await this.dependencies.store.renewReconciliation({
          intentId: leased.id,
          leaseToken,
          leaseSeconds: APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_SECONDS,
        });
        await checkpoint(force);
      };

      try {
        await reconciliationCheckpoint(true);
        const reconciled = await this.dependencies.reconcile(
          leased,
          reconciliationCheckpoint
        );
        await reconciliationCheckpoint(true);
        const completed = await this.dependencies.store.completeReconciliation({
          intentId: leased.id,
          leaseToken,
          activityId: reconciled.activityId,
        });
        return outcome("reconciled", completed, { delivered: true });
      } catch (error) {
        lastError = errorMessage(error);
        if (isDatabasePressureError(error)) {
          try {
            await this.dependencies.store.releaseReconciliation({
              intentId: leased.id,
              leaseToken,
              error: lastError,
            });
          } catch {
            // If pressure also prevents the owner-fenced release, expiry makes
            // the intent reclaimable without converting pressure into a real
            // reconciliation attempt.
          }
          return outcome("pending", accepted, {
            delivered: true,
            error: lastError,
          });
        }
        await this.dependencies.store.failReconciliation({
          intentId: leased.id,
          leaseToken,
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

import {
  ProviderApiError,
  ProviderAuthError,
  ProviderScopeError,
  type EmailProviderInterface,
} from "./email-provider";

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
  reconciliationLeaseToken: string | null;
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
    intent: ApprovedActionEmailIntent
  ) => Promise<{ activityId: string }>;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExplicitProviderRejection(error: unknown): boolean {
  return (
    error instanceof ProviderApiError ||
    error instanceof ProviderAuthError ||
    error instanceof ProviderScopeError
  );
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
    const prepared = await this.dependencies.store.prepare(input);

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

    let accepted = prepared;
    if (
      prepared.status !== "provider_accepted" &&
      prepared.status !== "reconciliation_failed" &&
      prepared.status !== "reconciling"
    ) {
      const claimed = await this.dependencies.store.claimProviderDelivery(
        prepared.id
      );
      if (!claimed) return outcome("pending", prepared);

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
        if (isExplicitProviderRejection(error)) {
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
    }

    return this.reconcileAccepted(accepted);
  }

  private async reconcileAccepted(
    accepted: ApprovedActionEmailIntent
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

      try {
        const reconciled = await this.dependencies.reconcile(leased);
        const completed = await this.dependencies.store.completeReconciliation({
          intentId: leased.id,
          leaseToken: leased.reconciliationLeaseToken,
          activityId: reconciled.activityId,
        });
        return outcome("reconciled", completed, { delivered: true });
      } catch (error) {
        lastError = errorMessage(error);
        await this.dependencies.store.failReconciliation({
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

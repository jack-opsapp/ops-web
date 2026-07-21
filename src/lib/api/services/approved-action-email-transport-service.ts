import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ApprovedActionEmailDeliveryService,
  type ApprovedActionEmailDeliveryOutcome,
  type ApprovedActionEmailExecutionMode,
  type ApprovedActionEmailIntent,
  type PrepareApprovedActionEmailIntentInput,
} from "./approved-action-email-delivery-service";
import { ApprovedActionEmailIntentService } from "./approved-action-email-intent-service";
import { reconcileApprovedActionEmail } from "./approved-action-email-reconciliation-service";
import { runWithEmailConnectionSyncLock } from "./email-connection-sync-lock";
import { EmailService } from "./email-service";
import { renderEmailBodyWithSignature } from "./email-signature-service";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { requireSupabase } from "@/lib/supabase/helpers";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prepareInputFromIntent(
  intent: ApprovedActionEmailIntent
): PrepareApprovedActionEmailIntentInput {
  if (
    !intent.signatureId ||
    !intent.signatureContentHash ||
    !intent.renderedBodyHash
  ) {
    throw new Error("EMAIL_SIGNATURE_REQUIRED");
  }
  return {
    actionId: intent.actionId,
    executionMode: intent.executionMode,
    signatureId: intent.signatureId,
    signatureContentHash: intent.signatureContentHash,
    authoredBodyHash: hash(intent.authoredBody),
    renderedBody: intent.renderedBody,
    renderedBodyHash: intent.renderedBodyHash,
  };
}

async function executeApprovedActionEmail(input: {
  actionId: string;
  executionMode: ApprovedActionEmailExecutionMode;
}): Promise<ApprovedActionEmailDeliveryOutcome> {
  const supabase = requireSupabase() as unknown as SupabaseClient;
  const store = new ApprovedActionEmailIntentService(supabase);
  const existing = await store.getByActionId(input.actionId);

  let authoritativeIntent: ApprovedActionEmailIntent;
  let prepareInput: PrepareApprovedActionEmailIntentInput;
  if (existing && existing.status !== "awaiting_signature") {
    authoritativeIntent = existing;
    prepareInput = prepareInputFromIntent(existing);
  } else {
    // The first database transition resolves and authorizes every source row
    // before any provider API is touched. Signature discovery can therefore
    // use only the immutable actor/mailbox/body returned by that transaction.
    authoritativeIntent = await store.prepareAwaitingSignature({
      actionId: input.actionId,
      executionMode: input.executionMode,
    });
    const connection = await EmailService.getConnection(
      authoritativeIntent.connectionId
    );
    if (
      !connection ||
      connection.companyId !== authoritativeIntent.companyId ||
      connection.status !== "active"
    ) {
      throw new Error("APPROVED_ACTION_EMAIL_CONNECTION_INVALID");
    }
    const signature = await resolveEmailSignatureForMessage({
      supabase,
      connection,
      userId: authoritativeIntent.actorUserId,
      refreshProviderIfMissing: true,
    });
    if (!signature) {
      return {
        state: "awaiting_signature",
        delivered: false,
        intentId: authoritativeIntent.id,
        providerMessageId: null,
        providerThreadId: null,
        activityId: null,
        error: "EMAIL_SIGNATURE_REQUIRED",
      };
    }
    const renderedBody = renderEmailBodyWithSignature({
      body: authoritativeIntent.authoredBody,
      contentType: "text",
      signature,
    });
    prepareInput = {
      actionId: input.actionId,
      executionMode: input.executionMode,
      signatureId: signature.recordId,
      signatureContentHash: signature.hash,
      authoredBodyHash: hash(authoritativeIntent.authoredBody),
      renderedBody,
      renderedBodyHash: hash(renderedBody),
    };
  }

  const connection = await EmailService.getConnection(
    authoritativeIntent.connectionId
  );
  // An active connection is mandatory until the provider has accepted the
  // message. After acceptance, reconciliation must continue from the durable
  // provider identity even if the mailbox is disabled in the meantime.
  const requiresActiveMailbox =
    authoritativeIntent.status === "awaiting_signature" ||
    authoritativeIntent.status === "prepared";
  if (
    !connection ||
    connection.companyId !== authoritativeIntent.companyId ||
    (requiresActiveMailbox && connection.status !== "active")
  ) {
    throw new Error("APPROVED_ACTION_EMAIL_CONNECTION_INVALID");
  }
  const provider = EmailService.getProvider(connection);
  const delivery = new ApprovedActionEmailDeliveryService({
    store,
    provider,
    reconcile: (intent, providerLockCheckpoint) =>
      reconcileApprovedActionEmail({
        supabase,
        intent,
        connection,
        provider,
        providerLockCheckpoint,
      }),
    runWithMailboxLease: ({ connectionId, run }) =>
      runWithEmailConnectionSyncLock({
        connectionId,
        context: "approved-action-email-delivery",
        client: supabase,
        run,
      }),
  });
  return delivery.execute(prepareInput);
}

export const ApprovedActionEmailTransportService = {
  executeManual(actionId: string): Promise<ApprovedActionEmailDeliveryOutcome> {
    return executeApprovedActionEmail({ actionId, executionMode: "manual" });
  },

  executeAutonomous(
    actionId: string
  ): Promise<ApprovedActionEmailDeliveryOutcome> {
    return executeApprovedActionEmail({
      actionId,
      executionMode: "autonomous",
    });
  },

  async recover(limit = 50): Promise<{
    quarantined: number;
    processed: number;
    failed: number;
  }> {
    const supabase = requireSupabase() as unknown as SupabaseClient;
    const store = new ApprovedActionEmailIntentService(supabase);
    const quarantined = await store.quarantineStaleDeliveries();
    const recoverable = await store.listRecoverable(limit);
    let processed = 0;
    let failed = 0;
    for (const intent of recoverable) {
      try {
        await executeApprovedActionEmail({
          actionId: intent.actionId,
          executionMode: intent.executionMode,
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error("[approved-action-email] recovery failed", {
          intentId: intent.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { quarantined, processed, failed };
  },
};

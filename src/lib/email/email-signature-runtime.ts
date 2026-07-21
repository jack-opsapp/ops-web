import type { SupabaseClient } from "@supabase/supabase-js";

import { EmailService } from "@/lib/api/services/email-service";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import {
  authoredMessageBody,
  cleanMessageBody,
} from "@/lib/api/services/conversation-state/message-cleaner";
import {
  EmailSignatureService,
  renderEmailBodyWithSignature,
  stripKnownRenderedEmailSignatures,
  type EmailSignatureRenderContent,
  type EffectiveEmailSignature,
} from "@/lib/api/services/email-signature-service";
import type { EmailConnection } from "@/lib/types/email-connection";
import { markdownToEmailHtml } from "@/lib/utils/markdown-to-email-html";

export const EMAIL_SIGNATURE_PROVIDER_MAILBOX_BUSY =
  "EMAIL_SIGNATURE_PROVIDER_MAILBOX_BUSY";

export type EmailSignatureProviderLockCheckpoint = (
  force?: boolean
) => Promise<void>;

export class EmailSignatureProviderMailboxBusyError extends Error {
  constructor() {
    super(EMAIL_SIGNATURE_PROVIDER_MAILBOX_BUSY);
    this.name = "EmailSignatureProviderMailboxBusyError";
  }
}

export function isEmailSignatureProviderMailboxBusyError(
  error: unknown
): error is EmailSignatureProviderMailboxBusyError {
  return (
    error instanceof EmailSignatureProviderMailboxBusyError ||
    (error instanceof Error &&
      error.message === EMAIL_SIGNATURE_PROVIDER_MAILBOX_BUSY)
  );
}

async function refreshProviderSignatureUnderLease(input: {
  connection: EmailConnection;
  userId: string;
  checkpoint: EmailSignatureProviderLockCheckpoint;
}): Promise<void> {
  // Keep ownership checks outside the provider-error boundary. Provider reads
  // remain a non-fatal signature fallback, but lease loss must fail closed.
  await input.checkpoint();
  try {
    await EmailSignatureService.refreshProvider({
      companyId: input.connection.companyId,
      connectionId: input.connection.id,
      scopeUserId: null,
      mailboxAddress: input.connection.email,
      provider: EmailService.getProvider(input.connection),
      actorUserId: input.userId,
      providerLockCheckpoint: input.checkpoint,
    });
  } catch (error) {
    console.error("[email-signature] provider refresh failed", {
      connectionId: input.connection.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await input.checkpoint();
}

export async function resolveEmailSignatureForMessage(input: {
  supabase: SupabaseClient;
  connection: EmailConnection;
  userId: string;
  refreshProviderIfMissing?: boolean;
  /** Reuse the caller's physical-mailbox lease; prevents nested acquisition. */
  providerLockCheckpoint?: EmailSignatureProviderLockCheckpoint;
}): Promise<EffectiveEmailSignature | null> {
  const scope = {
    companyId: input.connection.companyId,
    connectionId: input.connection.id,
    userId: input.userId,
    mailboxAddress: input.connection.email,
  };

  let signature = await EmailSignatureService.resolveEffective(scope);
  if (
    !signature &&
    input.refreshProviderIfMissing !== false &&
    input.connection.provider === "gmail"
  ) {
    if (input.providerLockCheckpoint) {
      await refreshProviderSignatureUnderLease({
        connection: input.connection,
        userId: input.userId,
        checkpoint: input.providerLockCheckpoint,
      });
    } else {
      const locked = await runWithEmailConnectionSyncLock({
        connectionId: input.connection.id,
        context: "email-signature-provider-refresh",
        client: input.supabase,
        run: (checkpoint) =>
          refreshProviderSignatureUnderLease({
            connection: input.connection,
            userId: input.userId,
            checkpoint,
          }),
      });
      if (!locked.acquired) {
        throw new EmailSignatureProviderMailboxBusyError();
      }
    }
    signature = await EmailSignatureService.resolveEffective(scope);
  }

  try {
    const { error } = await input.supabase.rpc(
      "sync_email_signature_notification_as_system",
      {
        p_actor_user_id: input.userId,
        p_connection_id: input.connection.id,
      }
    );
    if (error) throw error;
  } catch (error) {
    console.error("[email-signature] notification reconciliation failed", {
      connectionId: input.connection.id,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return signature;
}

export async function loadKnownEmailSignaturesForMessage(input: {
  connection: EmailConnection;
  scopeUserId?: string | null;
}): Promise<EmailSignatureRenderContent[]> {
  const rows = await EmailSignatureService.listKnown({
    companyId: input.connection.companyId,
    connectionId: input.connection.id,
  });
  const scopeUserId = input.scopeUserId?.trim() || null;
  const eligibleRows = scopeUserId
    ? rows.filter(
        (row) =>
          (row.scopeUserId ?? null) === null || row.scopeUserId === scopeUserId
      )
    : rows;

  // Provider drafts in a shared/company mailbox can be opened by a different
  // OPS operator than the person who originally saved them. Every revision is
  // tenant- and connection-scoped, and removal is exact + suffix-anchored, so
  // all known signatures for this mailbox are safe and necessary here.
  return eligibleRows.map((row) => ({
    html: row.contentHtml,
    text: row.contentText,
    hash: row.contentHash,
  }));
}

export function isPersonalHistoricalLearningConnection(
  connection: EmailConnection,
  userId: string
): boolean {
  const scopeUserId = userId.trim();
  return (
    Boolean(scopeUserId) &&
    connection.type === "individual" &&
    connection.userId === scopeUserId
  );
}

export function normalizeMailboxDraftAuthoredBody(
  body: string,
  signature: EffectiveEmailSignature | null,
  knownSignatures: EmailSignatureRenderContent[] = []
): string {
  const signatures = signature
    ? [signature, ...knownSignatures]
    : knownSignatures;
  if (signatures.length === 0) return body;
  return stripKnownRenderedEmailSignatures({
    body,
    contentType: "text",
    signatures,
  }).trimEnd();
}

export async function prepareHistoricalOutboundBodyForLearning(input: {
  connection: EmailConnection;
  userId: string;
  body: string;
  subject?: string | null;
}): Promise<{
  authoredBody: string;
  cleanBody: string;
  exactSignatureRemoved: boolean;
}> {
  // Historical provider bodies can contain an entire quoted thread after the
  // operator's signature. Remove quotes first, then normalize line endings so
  // normalization alone can never be mistaken for an exact signature match.
  const original = authoredMessageBody(input.body, {
    subject: input.subject ?? "",
  })
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!isPersonalHistoricalLearningConnection(input.connection, input.userId)) {
    return {
      authoredBody: original,
      cleanBody: original,
      exactSignatureRemoved: false,
    };
  }

  try {
    const knownSignatures = await loadKnownEmailSignaturesForMessage({
      connection: input.connection,
      scopeUserId: input.userId,
    });
    if (knownSignatures.length === 0) {
      return {
        authoredBody: original,
        cleanBody: original,
        exactSignatureRemoved: false,
      };
    }

    const authoredBody = normalizeMailboxDraftAuthoredBody(
      original,
      null,
      knownSignatures
    ).trim();
    const exactSignatureRemoved = Boolean(
      authoredBody && authoredBody !== original
    );

    if (!exactSignatureRemoved) {
      return {
        authoredBody: original,
        cleanBody: original,
        exactSignatureRemoved: false,
      };
    }

    return {
      authoredBody,
      cleanBody: cleanMessageBody(authoredBody, {
        subject: input.subject ?? "",
      }),
      exactSignatureRemoved: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "[email-signature] historical exact signature lookup failed; learning will retry",
      {
        companyId: input.connection.companyId,
        connectionId: input.connection.id,
        error: message,
      }
    );
    throw new Error(`Historical email signature lookup failed: ${message}`);
  }
}

export function renderMailboxDraftWithSignature(
  body: string,
  signature: EffectiveEmailSignature | null,
  knownSignatures: EmailSignatureRenderContent[] = []
): { body: string; contentType: "text" | "html" } {
  if (!signature) return { body, contentType: "text" };

  const authoredBody = normalizeMailboxDraftAuthoredBody(
    body,
    signature,
    knownSignatures
  );

  return {
    body: renderEmailBodyWithSignature({
      body: markdownToEmailHtml(authoredBody),
      contentType: "html",
      signature,
    }),
    contentType: "html",
  };
}

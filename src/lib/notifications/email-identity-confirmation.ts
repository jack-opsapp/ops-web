import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The rail's side of the identity gate.
 *
 * The contact-form worker raises this notification when it has to hold a
 * new-lead reply; nothing else closes it, because the gate opens on a human
 * act — confirming a signature — that happens on a completely different
 * surface. So the settings route calls this the moment that act lands.
 *
 * The type and key are duplicated here rather than imported from the draft
 * runtime: the runtime pulls the whole draft engine behind it, and a settings
 * route has no business loading that. A test asserts the two never drift.
 */
export const EMAIL_IDENTITY_CONFIRMATION_TYPE =
  "email_identity_confirmation_required";

export function emailIdentityConfirmationDedupeKey(input: {
  connectionId: string;
  userId: string;
}): string {
  return `email-identity-confirmation:${input.connectionId}:${input.userId}`;
}

/**
 * Closes the operator's outstanding prompt for this mailbox. Silent when there
 * is none — confirming an identity nobody was waiting on is the common case,
 * and a settings save must not fail because a notification did not exist.
 */
export async function resolveEmailIdentityConfirmationNotification(input: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId: string;
  userId: string;
}): Promise<void> {
  const { error } = await input.supabase
    .from("notifications")
    .update({
      is_read: true,
      resolved_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("user_id", input.userId)
    .eq("type", EMAIL_IDENTITY_CONFIRMATION_TYPE)
    .eq(
      "dedupe_key",
      emailIdentityConfirmationDedupeKey({
        connectionId: input.connectionId,
        userId: input.userId,
      })
    )
    .is("resolved_at", null);

  if (error) {
    throw new Error(
      `Failed to resolve the identity confirmation notification: ${error.message}`
    );
  }
}

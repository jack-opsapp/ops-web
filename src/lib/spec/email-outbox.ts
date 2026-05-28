/**
 * OPS Web — SPEC email-outbox writer (server-only).
 *
 * Writes a row to `public.spec_email_outbox` so the Stage H email send-cron
 * picks it up, renders the React Email template via the registry, and ships
 * via SendGrid. The cron is the only path that actually sends — the outbox is
 * the queue.
 *
 * Bible:
 *   - migrations/2026-05-26-01-spec-stage-c1-outboxes.sql (table shape)
 *   - SPEC/04_API_AND_INTEGRATION.md § Email outbox (Stage H consumer contract)
 *
 * The table is operator-only (RLS denies all access; service-role bypasses).
 * `template_id` must match an entry in
 * `src/lib/email/template-registry.ts` once Stage H lands.
 *
 * NEVER import from client-side code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export interface SpecEmailOutboxArgs {
  templateId: string;
  recipientEmail: string;
  recipientUserId: string | null;
  specProjectId: string;
  payload: Record<string, unknown>;
  isTest?: boolean;
  /**
   * Optional Supabase client override — primarily for tests. Production should
   * not pass this; the default service-role client is correct.
   */
  db?: SupabaseClient;
}

export async function writeSpecEmailOutbox(
  args: SpecEmailOutboxArgs,
): Promise<{ id: string } | { error: string }> {
  const db = args.db ?? getServiceRoleClient();
  const { data, error } = await db
    .from("spec_email_outbox")
    .insert({
      template_id: args.templateId,
      recipient_email: args.recipientEmail,
      recipient_user_id: args.recipientUserId,
      spec_project_id: args.specProjectId,
      payload: args.payload,
      is_test: args.isTest ?? false,
    })
    .select("id")
    .single();
  if (error) {
    console.error(
      `[writeSpecEmailOutbox] failed for template=${args.templateId}:`,
      error.message,
    );
    return { error: error.message };
  }
  return { id: (data as { id: string }).id };
}

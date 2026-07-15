import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultAutoSendSettings } from "@/lib/api/services/mailbox-draft-helpers";
import type {
  ConsumedEmailOAuthContext,
  EmailOAuthProvider,
} from "@/lib/email/email-oauth-state";

interface PersistEmailOAuthConnectionInput {
  state: ConsumedEmailOAuthContext;
  provider: EmailOAuthProvider;
  email: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
}

/**
 * Persist provider credentials without ever crossing provider or connection
 * identity boundaries. Alert reconnects update one pre-bound row; wizard
 * connects upsert only the matching provider/mailbox identity.
 */
export async function persistEmailOAuthConnection(
  supabase: SupabaseClient,
  input: PersistEmailOAuthConnectionInput
): Promise<void> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existingQuery = supabase
    .from("email_connections")
    .select(
      "id, email, auto_send_settings, refresh_token, status, sync_enabled"
    )
    .eq("company_id", input.state.companyId)
    .eq("provider", input.provider);

  if (input.state.source === "alert") {
    if (normalizedEmail !== input.state.expectedEmail) {
      throw new Error("Provider mailbox does not match bound OAuth state");
    }
    const { data: existingRow, error: existingError } = await existingQuery
      .eq("id", input.state.connectionId)
      .eq("type", input.state.type)
      .maybeSingle();
    if (existingError) {
      throw new Error(
        `Failed to read bound email connection: ${existingError.message}`
      );
    }
    if (!existingRow) {
      throw new Error("Bound email connection no longer matches OAuth state");
    }
    if (
      existingRow.sync_enabled !== true ||
      (existingRow.status !== "active" &&
        existingRow.status !== "needs_reconnect")
    ) {
      throw new Error("Bound email connection is no longer reconnectable");
    }
    if (existingRow.email.trim().toLowerCase() !== input.state.expectedEmail) {
      throw new Error("Bound email connection mailbox changed during OAuth");
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("email_connections")
      .update({
        access_token: input.accessToken,
        refresh_token: input.refreshToken || existingRow.refresh_token || "",
        expires_at: input.expiresAt,
        sync_enabled: true,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.state.connectionId)
      .eq("company_id", input.state.companyId)
      .eq("provider", input.provider)
      .eq("type", input.state.type)
      .eq("email", existingRow.email)
      .eq("status", existingRow.status)
      .eq("sync_enabled", true)
      .select("id")
      .maybeSingle();
    if (updateError) {
      throw new Error(
        `Failed to update bound email connection: ${updateError.message}`
      );
    }
    if (!updatedRow) {
      throw new Error("Bound email connection changed during OAuth callback");
    }
    return;
  }

  const { data: existingRow, error: existingError } = await existingQuery
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existingError) {
    throw new Error(
      `Failed to read provider email connection: ${existingError.message}`
    );
  }

  const upsertPayload: Record<string, unknown> = {
    company_id: input.state.companyId,
    user_id: input.state.userId,
    type: input.state.type,
    provider: input.provider,
    status: "setup_incomplete",
    email: normalizedEmail,
    access_token: input.accessToken,
    refresh_token: input.refreshToken || existingRow?.refresh_token || "",
    expires_at: input.expiresAt,
    sync_enabled: true,
    updated_at: new Date().toISOString(),
  };
  if (input.provider === "microsoft365") {
    upsertPayload.sync_interval_minutes = 60;
  }
  if (!existingRow) {
    upsertPayload.auto_send_settings = defaultAutoSendSettings();
  }

  const { error: upsertError } = await supabase
    .from("email_connections")
    .upsert(upsertPayload, { onConflict: "company_id,provider,email" });
  if (upsertError) {
    throw new Error(
      `Failed to upsert provider email connection: ${upsertError.message}`
    );
  }
}

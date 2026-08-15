import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultAutoSendSettings } from "@/lib/api/services/mailbox-draft-helpers";
import { PersonalEmailConnectionLifecycleService } from "@/lib/api/services/personal-email-connection-lifecycle-service";
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
  /**
   * Scope list reported by the provider's token response. Persisted whenever
   * present so `email_connections.granted_scopes` always states what the
   * stored refresh token can do (the calendar sync trigger and drain both
   * read it). Null/absent = provider omitted the field; leave the stored
   * record untouched.
   */
  grantedScopes?: string[] | null;
}

/**
 * Persist provider credentials without ever crossing provider or connection
 * identity boundaries. Alert reconnects update one pre-bound row; calendar
 * upgrades update one pre-bound row's credentials and grant only; wizard
 * connects upsert only the matching provider/mailbox identity.
 */
export async function persistEmailOAuthConnection(
  supabase: SupabaseClient,
  input: PersistEmailOAuthConnectionInput
): Promise<void> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const grantedScopes =
    input.grantedScopes && input.grantedScopes.length > 0
      ? input.grantedScopes
      : null;
  const existingQuery = supabase
    .from("email_connections")
    .select(
      "id, email, auto_send_settings, refresh_token, status, sync_enabled"
    )
    .eq("company_id", input.state.companyId)
    .eq("provider", input.provider);

  if (input.state.source === "calendar") {
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
      existingRow.status !== "active" &&
      existingRow.status !== "needs_reconnect"
    ) {
      throw new Error("Bound email connection is not upgradeable");
    }
    if (existingRow.email.trim().toLowerCase() !== input.state.expectedEmail) {
      throw new Error("Bound email connection mailbox changed during OAuth");
    }

    // Credentials and grant only. A scope upgrade must never resurrect
    // paused sync, reset auto-send configuration, or reassign ownership —
    // the mailbox keeps running exactly as the operator configured it.
    const upgradePayload: Record<string, unknown> = {
      access_token: input.accessToken,
      refresh_token: input.refreshToken || existingRow.refresh_token || "",
      expires_at: input.expiresAt,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    if (grantedScopes) {
      upgradePayload.granted_scopes = grantedScopes;
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("email_connections")
      .update(upgradePayload)
      .eq("id", input.state.connectionId)
      .eq("company_id", input.state.companyId)
      .eq("provider", input.provider)
      .eq("type", input.state.type)
      .eq("email", existingRow.email)
      .eq("status", existingRow.status)
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
        // Company connectors have no OPS-user owner. Reconnecting a legacy
        // row is also an opportunity to remove its obsolete connector value.
        user_id: input.state.type === "individual" ? input.state.userId : null,
        access_token: input.accessToken,
        refresh_token: input.refreshToken || existingRow.refresh_token || "",
        expires_at: input.expiresAt,
        sync_enabled: true,
        status: "active",
        updated_at: new Date().toISOString(),
        ...(grantedScopes ? { granted_scopes: grantedScopes } : {}),
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
    if (input.state.type === "individual") {
      await PersonalEmailConnectionLifecycleService.reconcile(
        input.state.connectionId,
        supabase
      );
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
    user_id: input.state.type === "individual" ? input.state.userId : null,
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
  if (grantedScopes) {
    upsertPayload.granted_scopes = grantedScopes;
  }
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

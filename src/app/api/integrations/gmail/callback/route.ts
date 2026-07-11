/**
 * OPS Web - Gmail OAuth Callback
 *
 * GET /api/integrations/gmail/callback?code=...&state=<base64>
 *
 * Exchanges auth code for tokens and persists the connection. The `state`
 * parameter carries a base64-encoded JSON `{companyId, userId, type}` set
 * by the OAuth initiation route — we decode it so the connection row gets
 * the correct user_id (critical for Phase C hooks to fire) and type
 * (company vs individual).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  buildReturnRedirect,
  sanitizeReturnTo,
} from "@/lib/utils/oauth-return";
import { defaultAutoSendSettings } from "@/lib/api/services/mailbox-draft-helpers";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET;

interface OAuthState {
  companyId: string;
  userId: string | null;
  type: "company" | "individual";
  /**
   * Where to land the user after the connection is written. `wizard` (default)
   * keeps the existing /settings landing for in-app reconnects. `alert` lands
   * them on /reconnect-inbox/success — the auth-aware confirmation page used
   * by the email-ingest-down alert flow.
   */
  source: "wizard" | "alert";
  /**
   * Optional app-internal path (allowlisted: must be a "/..." path) to land
   * on instead of /settings — set when the flow started somewhere else in
   * the app (e.g. the pipeline connect banner). Success appends
   * `?connected=gmail`, failure `?connect_error=1`, so the origin page can
   * fire its toast. Null keeps every legacy landing exactly as before.
   */
  returnTo: string | null;
}

/**
 * Decode the base64-encoded JSON state set by gmail/route.ts. Falls back
 * to treating the state as a plain companyId string for backward
 * compatibility with in-flight OAuth sessions that were initiated before
 * the state format was upgraded.
 */
function decodeState(raw: string): OAuthState | null {
  // Try the new base64-JSON format first.
  try {
    const json = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    if (json && typeof json === "object" && typeof json.companyId === "string") {
      return {
        companyId: json.companyId,
        userId: typeof json.userId === "string" ? json.userId : null,
        type: json.type === "individual" ? "individual" : "company",
        source: json.source === "alert" ? "alert" : "wizard",
        // Re-sanitize on the way back — state round-trips through Google
        // and must be treated as attacker-controlled.
        returnTo: sanitizeReturnTo(json.returnTo),
      };
    }
  } catch {
    // Not base64 JSON — fall through to legacy path.
  }

  // Legacy format: state was just the raw companyId string.
  if (raw && !raw.includes("=") && !raw.includes(":")) {
    return {
      companyId: raw,
      userId: null,
      type: "company",
      source: "wizard",
      returnTo: null,
    };
  }
  return null;
}

/**
 * Failure landing: when the flow carried a valid app-internal `returnTo`,
 * send the user back there with `?connect_error=1` so the origin page fires
 * its error toast. Flows without returnTo (settings wizard, alert email)
 * keep today's /settings error redirect exactly.
 */
function errorRedirect(returnTo: string | null, message: string) {
  if (returnTo) {
    const url = buildReturnRedirect(getAppUrl(), returnTo, {
      connect_error: "1",
    });
    if (url) return NextResponse.redirect(url);
  }
  return NextResponse.redirect(
    `${getAppUrl()}/settings?tab=integrations&status=error&message=${encodeURIComponent(message)}`
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const error = searchParams.get("error");

  // Decode state up-front (it arrives even on provider errors/denials) so
  // every failure path can honor a valid returnTo.
  const state = rawState ? decodeState(rawState) : null;
  const returnTo = state?.returnTo ?? null;

  // Handle user denial
  if (error) {
    return errorRedirect(returnTo, error);
  }

  if (!code || !rawState) {
    return errorRedirect(returnTo, "missing_params");
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return errorRedirect(returnTo, "not_configured");
  }

  if (!state) {
    console.error("[Gmail OAuth] Failed to decode state:", rawState);
    return errorRedirect(returnTo, "invalid_state");
  }

  // Individual connections MUST carry a userId. If the state came through
  // without one (legacy init or missing query param), we can't attribute
  // the connection correctly — reject rather than silently fall back to
  // company-scope, because Phase C depends on user_id being non-null.
  if (state.type === "individual" && !state.userId) {
    console.error("[Gmail OAuth] Individual connection missing userId");
    return errorRedirect(returnTo, "missing_user_id");
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${getAppUrl()}/api/integrations/gmail/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("[Gmail OAuth] Token exchange failed");
      console.error("[Gmail OAuth] Status:", tokenResponse.status);
      console.error("[Gmail OAuth] Response:", errorData);
      console.error("[Gmail OAuth] Redirect URI used:", `${getAppUrl()}/api/integrations/gmail/callback`);
      try {
        const parsed = JSON.parse(errorData);
        console.error("[Gmail OAuth] Error code:", parsed.error);
        console.error("[Gmail OAuth] Error description:", parsed.error_description);
      } catch { /* not JSON */ }
      return errorRedirect(returnTo, "token_exchange_failed");
    }

    const tokens = await tokenResponse.json();

    // Get user email from the access token
    let gmailEmail = "";
    try {
      const userInfoResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        gmailEmail = userInfo.email || "";
      }
    } catch {
      // Non-critical — email is nice to have
    }

    // Persist the connection with explicit user_id, type, provider, and
    // status. We write status='setup_incomplete' because the wizard has
    // additional steps (pattern detection, filter config, activate). The
    // activate endpoint flips it to 'active' when the user finishes.
    //
    // Auto-draft defaults are seeded only on a genuinely new connection —
    // reconnects must preserve whatever settings the user has already
    // configured, so we check existence before upserting.
    const supabase = getServiceRoleClient();

    const { data: existingRow } = await supabase
      .from("email_connections")
      .select("id, auto_send_settings")
      .eq("company_id", state.companyId)
      .eq("email", gmailEmail)
      .maybeSingle();

    const isNewConnection = !existingRow;

    const upsertPayload: Record<string, unknown> = {
      company_id: state.companyId,
      user_id: state.userId,
      type: state.type,
      provider: "gmail",
      status: "setup_incomplete",
      email: gmailEmail,
      access_token: tokens.access_token || "",
      refresh_token: tokens.refresh_token || "",
      expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
      sync_enabled: true,
      updated_at: new Date().toISOString(),
    };

    // Only seed defaults on initial creation — never overwrite a reconnect's
    // existing settings (user may have customised them via the settings UI).
    if (isNewConnection) {
      upsertPayload.auto_send_settings = defaultAutoSendSettings();
    }

    const { error: upsertError } = await supabase
      .from("email_connections")
      .upsert(upsertPayload, { onConflict: "company_id,email" });

    if (upsertError) {
      console.error("Failed to store Gmail tokens:", upsertError.message);
      return errorRedirect(returnTo, "storage_failed");
    }

    if (state.source === "alert") {
      const successParams = new URLSearchParams({
        companyId: state.companyId,
        email: gmailEmail,
        provider: "gmail",
      });
      return NextResponse.redirect(
        `${getAppUrl()}/reconnect-inbox/success?${successParams.toString()}`
      );
    }

    // App-initiated flows (e.g. the pipeline connect banner) land back where
    // they started with ?connected=gmail so the origin page fires its toast.
    if (returnTo) {
      const url = buildReturnRedirect(getAppUrl(), returnTo, {
        connected: "gmail",
      });
      if (url) return NextResponse.redirect(url);
    }

    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=connected&firstConnect=true`
    );
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    return errorRedirect(returnTo, "unexpected_error");
  }
}

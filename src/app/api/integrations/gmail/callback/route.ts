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

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET;

interface OAuthState {
  companyId: string;
  userId: string | null;
  type: "company" | "individual";
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
      };
    }
  } catch {
    // Not base64 JSON — fall through to legacy path.
  }

  // Legacy format: state was just the raw companyId string.
  if (raw && !raw.includes("=") && !raw.includes(":")) {
    return { companyId: raw, userId: null, type: "company" };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle user denial
  if (error) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !rawState) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=missing_params`
    );
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=not_configured`
    );
  }

  const state = decodeState(rawState);
  if (!state) {
    console.error("[Gmail OAuth] Failed to decode state:", rawState);
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=invalid_state`
    );
  }

  // Individual connections MUST carry a userId. If the state came through
  // without one (legacy init or missing query param), we can't attribute
  // the connection correctly — reject rather than silently fall back to
  // company-scope, because Phase C depends on user_id being non-null.
  if (state.type === "individual" && !state.userId) {
    console.error("[Gmail OAuth] Individual connection missing userId");
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=missing_user_id`
    );
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
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=token_exchange_failed`
      );
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
    const supabase = getServiceRoleClient();
    const { error: upsertError } = await supabase
      .from("email_connections")
      .upsert(
        {
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
        },
        { onConflict: "company_id,email" }
      );

    if (upsertError) {
      console.error("Failed to store Gmail tokens:", upsertError.message);
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=connected&firstConnect=true`
    );
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=unexpected_error`
    );
  }
}

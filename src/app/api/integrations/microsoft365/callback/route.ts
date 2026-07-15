/**
 * OPS Web - Microsoft 365 OAuth Callback
 *
 * GET /api/integrations/microsoft365/callback?code=...&state=...
 * Exchanges auth code for tokens, stores in email_connections table.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  buildReturnRedirect,
  sanitizeReturnTo,
} from "@/lib/utils/oauth-return";
import { defaultAutoSendSettings } from "@/lib/api/services/mailbox-draft-helpers";

interface M365OAuthState {
  companyId: string;
  userId: string | undefined;
  type: string | undefined;
  /** `alert` lands on /reconnect-inbox/success; `wizard` keeps /settings. */
  source: "wizard" | "alert";
  /**
   * Optional app-internal path (allowlisted: must be a "/..." path) to land
   * on instead of /settings — set when the flow started elsewhere in the app
   * (e.g. the pipeline connect banner). Success appends
   * `?connected=microsoft365`, failure `?connect_error=1`.
   */
  returnTo: string | null;
}

/** Decode the base64-JSON state set by microsoft365/route.ts. */
function decodeState(raw: string): M365OAuthState | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString());
    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof decoded.companyId !== "string"
    ) {
      return null;
    }
    return {
      companyId: decoded.companyId,
      userId: typeof decoded.userId === "string" ? decoded.userId : undefined,
      type: typeof decoded.type === "string" ? decoded.type : undefined,
      source: decoded.source === "alert" ? "alert" : "wizard",
      // Re-sanitize on the way back — state round-trips through Microsoft
      // and must be treated as attacker-controlled.
      returnTo: sanitizeReturnTo(decoded.returnTo),
    };
  } catch {
    return null;
  }
}

/**
 * Failure landing: when the flow carried a valid app-internal `returnTo`,
 * send the user back there with `?connect_error=1` so the origin page fires
 * its error toast. Flows without returnTo keep today's /settings redirect.
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
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  // Decode state up-front (it arrives even on provider errors/denials) so
  // every failure path can honor a valid returnTo.
  const state = stateParam ? decodeState(stateParam) : null;
  const returnTo = state?.returnTo ?? null;

  // Handle user denial
  if (error) {
    return errorRedirect(returnTo, error);
  }

  if (!code || !stateParam) {
    return errorRedirect(returnTo, "missing_params");
  }

  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    return errorRedirect(returnTo, "not_configured");
  }

  if (!state) {
    console.error("[M365 OAuth] Failed to decode state");
    return errorRedirect(returnTo, "invalid_state");
  }

  try {
    const companyId = state.companyId;
    const userId = state.userId;
    const type = state.type;
    // `source === "alert"` lands the user on /reconnect-inbox/success after
    // the connection is written. Defaults to wizard for in-app flows.
    const source = state.source;

    // Exchange authorization code for tokens
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          code,
          redirect_uri: `${getAppUrl()}/api/integrations/microsoft365/callback`,
          grant_type: "authorization_code",
          // Full mail access — must match the scope requested in
          // microsoft365/route.ts so the exchange succeeds without
          // prompting the user for additional consent.
          scope: "Mail.Read Mail.ReadWrite Mail.Send offline_access",
        }),
      }
    );

    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error("[M365 OAuth] Token exchange failed:", tokenRes.status, errorData);
      return errorRedirect(returnTo, "token_exchange_failed");
    }

    const tokens = await tokenRes.json();

    // Get user profile to get email address
    let email = "";
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        email = profile.mail || profile.userPrincipalName || "";
      }
    } catch {
      // Non-critical — email is nice to have
    }

    // Store in email_connections table. This is always a new connection
    // (raw INSERT — no upsert), so it's safe to seed auto-draft defaults
    // unconditionally. Reconnects use a separate flow that calls UPDATE.
    const supabase = getServiceRoleClient();
    const { error: insertError } = await supabase
      .from("email_connections")
      .insert({
        company_id: companyId,
        provider: "microsoft365",
        type: type || "individual",
        user_id: userId || null,
        email,
        access_token: tokens.access_token || "",
        refresh_token: tokens.refresh_token || "",
        expires_at: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
        sync_enabled: true,
        sync_interval_minutes: 60,
        status: "setup_incomplete",
        auto_send_settings: defaultAutoSendSettings(),
      });

    if (insertError) {
      console.error("[M365 OAuth] Failed to store tokens:", insertError.message);
      return errorRedirect(returnTo, "storage_failed");
    }

    if (source === "alert") {
      const successParams = new URLSearchParams({
        companyId,
        email,
        provider: "microsoft365",
      });
      return NextResponse.redirect(
        `${getAppUrl()}/reconnect-inbox/success?${successParams.toString()}`
      );
    }

    // App-initiated flows (e.g. the pipeline connect banner) land back where
    // they started with ?connected=microsoft365 so the origin page fires its
    // toast.
    if (returnTo) {
      const url = buildReturnRedirect(getAppUrl(), returnTo, {
        connected: "microsoft365",
      });
      if (url) return NextResponse.redirect(url);
    }

    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=connected&provider=microsoft365&firstConnect=true`
    );
  } catch (err) {
    console.error("[M365 OAuth] Callback error:", err);
    return errorRedirect(returnTo, "unexpected_error");
  }
}

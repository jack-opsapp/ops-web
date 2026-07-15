/**
 * OPS Web - Microsoft 365 OAuth Callback
 *
 * GET /api/integrations/microsoft365/callback?code=...&state=...
 * Exchanges auth code for tokens, stores in email_connections table.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeEmailOAuthState } from "@/lib/email/email-oauth-state";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { persistEmailOAuthConnection } from "@/lib/email/email-oauth-connection";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (!stateParam) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=missing_params`
    );
  }

  if (
    !process.env.MICROSOFT_CLIENT_ID ||
    !process.env.MICROSOFT_CLIENT_SECRET
  ) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=not_configured`
    );
  }

  const supabase = getServiceRoleClient();
  let state;
  try {
    state = await consumeEmailOAuthState(supabase, "microsoft365", stateParam);
  } catch (stateError) {
    console.error("[M365 OAuth] State consumption failed:", stateError);
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=invalid_state`
    );
  }
  if (!state) {
    console.error("[M365 OAuth] Rejected expired, replayed, or invalid state");
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=invalid_state`
    );
  }

  // Provider state must return in the same authenticated OPS browser session
  // that created it. This blocks relayed-consent mailbox attachment.
  const authError = await requireEmailCompanyAccess(
    request,
    state.companyId,
    "settings.integrations",
    state.userId
  );
  if (authError) {
    console.error("[M365 OAuth] Callback OPS session did not match initiator");
    const retryPath =
      state.source === "alert"
        ? `/reconnect-inbox?${new URLSearchParams({
            companyId: state.companyId,
            userId: state.userId,
            type: state.type,
            provider: "microsoft365",
            connectionId: state.connectionId,
            expectedEmail: state.expectedEmail,
          }).toString()}`
        : "/settings?tab=integrations";
    return NextResponse.redirect(
      `${getAppUrl()}/login?redirect=${encodeURIComponent(retryPath)}`
    );
  }

  if (error) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=${encodeURIComponent(error)}`
    );
  }
  if (!code) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=missing_params`
    );
  }

  try {
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
          scope: "User.Read Mail.Read Mail.ReadWrite Mail.Send offline_access",
        }),
      }
    );

    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error(
        "[M365 OAuth] Token exchange failed:",
        tokenRes.status,
        errorData
      );
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=token_exchange_failed`
      );
    }

    const tokens = await tokenRes.json();

    // Mailbox identity is a hard invariant for direction, ownership, and the
    // unique reconnect row. User.Read is requested explicitly above; never
    // persist an empty connection if /me is unavailable or malformed.
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) {
      console.error("[M365 OAuth] Profile lookup failed:", profileRes.status);
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=mailbox_identity_failed`
      );
    }
    const profile = await profileRes.json();
    const email = String(profile.mail || profile.userPrincipalName || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error("[M365 OAuth] Profile returned no valid mailbox email");
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=mailbox_identity_failed`
      );
    }
    if (state.source === "alert" && email !== state.expectedEmail) {
      console.error("[M365 OAuth] Reconnect mailbox did not match alert state");
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=mailbox_identity_mismatch`
      );
    }

    try {
      await persistEmailOAuthConnection(supabase, {
        state,
        provider: "microsoft365",
        email,
        accessToken: tokens.access_token || "",
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
      });
    } catch (storageError) {
      console.error("[M365 OAuth] Failed to store tokens:", storageError);
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=storage_failed`
      );
    }

    if (state.source === "alert") {
      const successParams = new URLSearchParams({
        companyId: state.companyId,
        email,
        provider: "microsoft365",
      });
      return NextResponse.redirect(
        `${getAppUrl()}/reconnect-inbox/success?${successParams.toString()}`
      );
    }

    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=connected&provider=microsoft365&firstConnect=true`
    );
  } catch (err) {
    console.error("[M365 OAuth] Callback error:", err);
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=unexpected_error`
    );
  }
}

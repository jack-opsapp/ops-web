/**
 * OPS Web - Microsoft 365 OAuth Callback
 *
 * Exchanges an authorization code and persists the connection only after
 * atomically consuming the short-lived, server-side OAuth state nonce.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeEmailOAuthState } from "@/lib/email/email-oauth-state";
import { persistEmailOAuthConnection } from "@/lib/email/email-oauth-connection";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import { buildReturnRedirect } from "@/lib/utils/oauth-return";

function errorRedirect(returnTo: string | null | undefined, message: string) {
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
  const rawState = searchParams.get("state");
  const providerError = searchParams.get("error");

  if (!rawState) return errorRedirect(null, "missing_params");

  const supabase = getServiceRoleClient();
  let state;
  try {
    state = await consumeEmailOAuthState(supabase, "microsoft365", rawState);
  } catch (stateError) {
    console.error("[M365 OAuth] State consumption failed:", stateError);
    return errorRedirect(null, "invalid_state");
  }
  if (!state) {
    console.error("[M365 OAuth] Rejected expired, replayed, or invalid state");
    return errorRedirect(null, "invalid_state");
  }

  const returnTo = state.returnTo ?? null;
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
        : returnTo || "/settings?tab=integrations";
    return NextResponse.redirect(
      `${getAppUrl()}/login?redirect=${encodeURIComponent(retryPath)}`
    );
  }

  // State is consumed even when the operator denied provider consent.
  if (providerError) return errorRedirect(returnTo, providerError);
  if (!code) return errorRedirect(returnTo, "missing_params");
  if (
    !process.env.MICROSOFT_CLIENT_ID ||
    !process.env.MICROSOFT_CLIENT_SECRET
  ) {
    return errorRedirect(returnTo, "not_configured");
  }

  try {
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET,
          code,
          redirect_uri: `${getAppUrl()}/api/integrations/microsoft365/callback`,
          grant_type: "authorization_code",
          scope: "User.Read Mail.Read Mail.ReadWrite Mail.Send offline_access",
        }),
      }
    );

    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error("[M365 OAuth] Token exchange failed:", {
        status: tokenRes.status,
        response: errorData,
      });
      return errorRedirect(returnTo, "token_exchange_failed");
    }

    const tokens = await tokenRes.json();
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) {
      console.error("[M365 OAuth] Profile lookup failed:", profileRes.status);
      return errorRedirect(returnTo, "mailbox_identity_failed");
    }

    const profile = await profileRes.json();
    const email = String(profile.mail || profile.userPrincipalName || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error("[M365 OAuth] Profile returned no valid mailbox email");
      return errorRedirect(returnTo, "mailbox_identity_failed");
    }
    if (state.source === "alert" && email !== state.expectedEmail) {
      console.error("[M365 OAuth] Reconnect mailbox did not match alert state");
      return errorRedirect(returnTo, "mailbox_identity_mismatch");
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
      return errorRedirect(returnTo, "storage_failed");
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

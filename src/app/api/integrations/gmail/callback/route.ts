/**
 * OPS Web - Gmail OAuth Callback
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
import {
  fetchGmailOnceWithinDeadline,
  fetchGmailRead,
} from "@/lib/api/services/providers/gmail-read";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
const GMAIL_OAUTH_CALLBACK_DEADLINE_MS = 45_000;

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
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const providerError = searchParams.get("error");

  if (!rawState) return errorRedirect(null, "missing_params");

  const supabase = getServiceRoleClient();
  let state;
  try {
    state = await consumeEmailOAuthState(supabase, "gmail", rawState);
  } catch (stateError) {
    console.error("[Gmail OAuth] State consumption failed:", stateError);
    return errorRedirect(null, "invalid_state");
  }
  if (!state) {
    console.error("[Gmail OAuth] Rejected expired, replayed, or invalid state");
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
    console.error("[Gmail OAuth] Callback OPS session did not match initiator");
    const retryPath =
      state.source === "alert"
        ? `/reconnect-inbox?${new URLSearchParams({
            companyId: state.companyId,
            userId: state.userId,
            type: state.type,
            provider: "gmail",
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
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return errorRedirect(returnTo, "not_configured");
  }

  try {
    const deadlineAt = Date.now() + GMAIL_OAUTH_CALLBACK_DEADLINE_MS;
    const tokenResponse = await fetchGmailOnceWithinDeadline(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${getAppUrl()}/api/integrations/gmail/callback`,
          grant_type: "authorization_code",
        }),
      },
      { deadlineAt, context: "OAuth authorization-code exchange" }
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("[Gmail OAuth] Token exchange failed", {
        status: tokenResponse.status,
        response: errorData,
      });
      return errorRedirect(returnTo, "token_exchange_failed");
    }

    const tokens = await tokenResponse.json();
    const profileResponse = await fetchGmailRead(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      { deadlineAt, context: "users.getProfile (OAuth callback)" }
    );
    if (!profileResponse.ok) {
      console.error(
        "[Gmail OAuth] Mailbox profile lookup failed:",
        profileResponse.status
      );
      return errorRedirect(returnTo, "mailbox_identity_failed");
    }

    const profile = await profileResponse.json();
    const gmailEmail = String(profile.emailAddress || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailEmail)) {
      console.error("[Gmail OAuth] Profile returned no valid mailbox email");
      return errorRedirect(returnTo, "mailbox_identity_failed");
    }
    if (state.source === "alert" && gmailEmail !== state.expectedEmail) {
      console.error(
        "[Gmail OAuth] Reconnect mailbox did not match alert state"
      );
      return errorRedirect(returnTo, "mailbox_identity_mismatch");
    }

    try {
      await persistEmailOAuthConnection(supabase, {
        state,
        provider: "gmail",
        email: gmailEmail,
        accessToken: tokens.access_token || "",
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
      });
    } catch (storageError) {
      console.error("Failed to store Gmail tokens:", storageError);
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

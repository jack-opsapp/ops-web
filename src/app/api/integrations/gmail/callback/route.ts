/**
 * OPS Web - Gmail OAuth Callback
 *
 * GET /api/integrations/gmail/callback?code=...&state=<opaque-nonce>
 *
 * Exchanges auth code for tokens and persists the connection. The callback
 * atomically consumes a short-lived server-side state row; unsigned legacy
 * tenant context is intentionally rejected.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeEmailOAuthState } from "@/lib/email/email-oauth-state";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { persistEmailOAuthConnection } from "@/lib/email/email-oauth-connection";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const error = searchParams.get("error");

  if (!rawState) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=missing_params`
    );
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=not_configured`
    );
  }

  const supabase = getServiceRoleClient();
  let state;
  try {
    state = await consumeEmailOAuthState(supabase, "gmail", rawState);
  } catch (stateError) {
    console.error("[Gmail OAuth] State consumption failed:", stateError);
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=invalid_state`
    );
  }
  if (!state) {
    console.error("[Gmail OAuth] Rejected expired, replayed, or invalid state");
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=invalid_state`
    );
  }

  // Bind the provider callback to the same OPS identity that created state.
  // Without this second check an attacker could relay their provider consent
  // URL and attach another person's mailbox to the attacker's company.
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
        : "/settings?tab=integrations";
    return NextResponse.redirect(
      `${getAppUrl()}/login?redirect=${encodeURIComponent(retryPath)}`
    );
  }

  // Consume denied callbacks too, so their state can never be replayed with a
  // different authorization code.
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
      console.error(
        "[Gmail OAuth] Redirect URI used:",
        `${getAppUrl()}/api/integrations/gmail/callback`
      );
      try {
        const parsed = JSON.parse(errorData);
        console.error("[Gmail OAuth] Error code:", parsed.error);
        console.error(
          "[Gmail OAuth] Error description:",
          parsed.error_description
        );
      } catch {
        /* not JSON */
      }
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    // Mailbox identity is a hard ingestion invariant. The Gmail profile
    // endpoint is covered by the mailbox scope already granted above.
    const profileResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!profileResponse.ok) {
      console.error(
        "[Gmail OAuth] Mailbox profile lookup failed:",
        profileResponse.status
      );
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=mailbox_identity_failed`
      );
    }
    const profile = await profileResponse.json();
    const gmailEmail = String(profile.emailAddress || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailEmail)) {
      console.error("[Gmail OAuth] Profile returned no valid mailbox email");
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=mailbox_identity_failed`
      );
    }
    if (state.source === "alert" && gmailEmail !== state.expectedEmail) {
      console.error(
        "[Gmail OAuth] Reconnect mailbox did not match alert state"
      );
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=mailbox_identity_mismatch`
      );
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
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=storage_failed`
      );
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

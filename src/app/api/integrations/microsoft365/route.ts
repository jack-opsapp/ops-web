/**
 * OPS Web - Microsoft 365 OAuth Initiation
 *
 * GET /api/integrations/microsoft365?companyId=...&userId=...&type=...
 * Redirects to Microsoft login page to begin OAuth flow.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createEmailOAuthState,
  resolveEmailOAuthAlertConnection,
} from "@/lib/email/email-oauth-state";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import { sanitizeReturnTo } from "@/lib/utils/oauth-return";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const typeParam = searchParams.get("type") || "individual";
  // `source` lets the callback know whether to land the user back on the
  // standard /settings page (wizard flow) or on /reconnect-inbox/success
  // (alert-email flow). Defaults to wizard so existing in-app callers
  // are unaffected.
  const source = searchParams.get("source") === "alert" ? "alert" : "wizard";
  const connectionId = searchParams.get("connectionId");
  const expectedEmail = searchParams.get("expectedEmail");
  // Optional app-internal path to land on after the callback (e.g.
  // /pipeline). Only safe same-app paths are persisted with the opaque state.
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 }
    );
  }

  if (typeParam !== "company" && typeParam !== "individual") {
    return NextResponse.json(
      { error: 'type must be "company" or "individual"' },
      { status: 400 }
    );
  }
  const type = typeParam;

  if (!process.env.MICROSOFT_CLIENT_ID) {
    return NextResponse.json(
      { error: "Microsoft OAuth not configured" },
      { status: 500 }
    );
  }

  // Both company and individual connections require a userId. Phase C
  // memory/writing-profile extraction attributes artifacts to a real user —
  // without one, the entire knowledge-extraction pipeline silently skips.
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required — wizard must pass the current user's id" },
      { status: 400 }
    );
  }

  const authError = await requireEmailCompanyAccess(
    request,
    companyId,
    "settings.integrations",
    userId
  );
  if (authError) return authError;

  const supabase = getServiceRoleClient();
  let alertBinding: {
    connectionId: string;
    expectedEmail: string;
  } | null = null;
  if (source === "alert") {
    if (!connectionId || !expectedEmail) {
      return NextResponse.json(
        { error: "Alert reconnect requires a connection and mailbox" },
        { status: 400 }
      );
    }
    try {
      alertBinding = await resolveEmailOAuthAlertConnection(supabase, {
        companyId,
        provider: "microsoft365",
        type,
        connectionId,
        expectedEmail,
      });
    } catch (bindingError) {
      console.error(
        "[M365 OAuth] Failed to verify alert binding:",
        bindingError
      );
      return NextResponse.json(
        { error: "Failed to verify Microsoft reconnect" },
        { status: 500 }
      );
    }
    if (!alertBinding) {
      return NextResponse.json(
        { error: "This Microsoft reconnect link is no longer valid" },
        { status: 400 }
      );
    }
  }

  let state: string;
  try {
    state = await createEmailOAuthState(
      supabase,
      source === "alert"
        ? {
            provider: "microsoft365",
            companyId,
            userId,
            type,
            source,
            connectionId: alertBinding!.connectionId,
            expectedEmail: alertBinding!.expectedEmail,
            returnTo,
          }
        : {
            provider: "microsoft365",
            companyId,
            userId,
            type,
            source,
            returnTo,
          }
    );
  } catch (error) {
    console.error("[M365 OAuth] Failed to create one-time state:", error);
    return NextResponse.json(
      { error: "Failed to initiate Microsoft OAuth" },
      { status: 500 }
    );
  }

  const authUrl = new URL(
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
  );
  authUrl.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "redirect_uri",
    `${getAppUrl()}/api/integrations/microsoft365/callback`
  );
  // Full mail access: read, modify, and send. Matches the provider's
  // SCOPES constant so refresh_token requests don't drift from the
  // initial grant. Missing Mail.Send here would cause every
  // /me/messages/{id}/send call to 403.
  authUrl.searchParams.set(
    "scope",
    "User.Read Mail.Read Mail.ReadWrite Mail.Send offline_access"
  );
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_mode", "query");

  return NextResponse.redirect(authUrl.toString());
}

/**
 * OPS Web - Microsoft 365 OAuth Initiation
 *
 * GET /api/integrations/microsoft365?companyId=...&userId=...&type=...
 * Redirects to Microsoft login page to begin OAuth flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/utils/app-url";
import { sanitizeReturnTo } from "@/lib/utils/oauth-return";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const type = searchParams.get("type") || "individual";
  // `source` lets the callback know whether to land the user back on the
  // standard /settings page (wizard flow) or on /reconnect-inbox/success
  // (alert-email flow). Defaults to wizard so existing in-app callers
  // are unaffected.
  const source = searchParams.get("source") === "alert" ? "alert" : "wizard";
  // Optional app-internal path to land on after the callback (e.g.
  // /pipeline). Sanitized here AND in the callback — only "/..." paths
  // survive; absent keeps the legacy /settings landing.
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 }
    );
  }

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

  const state = Buffer.from(
    JSON.stringify({ companyId, userId, type, source, returnTo })
  ).toString("base64");

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
    "Mail.Read Mail.ReadWrite Mail.Send offline_access"
  );
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_mode", "query");

  return NextResponse.redirect(authUrl.toString());
}

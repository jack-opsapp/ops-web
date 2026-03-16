/**
 * OPS Web - Microsoft 365 OAuth Initiation
 *
 * GET /api/integrations/microsoft365?companyId=...&userId=...&type=...
 * Redirects to Microsoft login page to begin OAuth flow.
 */

import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const type = searchParams.get("type") || "individual";

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

  const state = Buffer.from(
    JSON.stringify({ companyId, userId, type })
  ).toString("base64");

  const authUrl = new URL(
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
  );
  authUrl.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "redirect_uri",
    `${BASE_URL}/api/integrations/microsoft365/callback`
  );
  authUrl.searchParams.set("scope", "Mail.Read Mail.ReadWrite offline_access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_mode", "query");

  return NextResponse.redirect(authUrl.toString());
}

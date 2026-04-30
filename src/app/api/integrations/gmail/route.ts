/**
 * OPS Web - Gmail OAuth Initiation
 *
 * GET /api/integrations/gmail?companyId=...&userId=...&type=...
 * Builds Google OAuth URL and redirects to consent screen.
 *
 * Scope: `https://mail.google.com/` — full mailbox access. Required so the
 * sync pipeline can apply labels, create drafts, send replies, and manage
 * the "OPS Pipeline" label. Narrower scopes (`gmail.readonly`) break label
 * application, send, draft, and label creation with 403 Insufficient
 * Permission. The wizard warns the user about the permission scope.
 *
 * State: base64-encoded JSON `{companyId, userId, type}`. The callback
 * decodes this so the connection row gets the correct user_id (required
 * for Phase C to fire) and type (company vs individual).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/utils/app-url";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const type = (searchParams.get("type") || "company") as "company" | "individual";
  // `source` lets the callback know whether to land the user back on the
  // standard /settings page (wizard flow) or on /reconnect-inbox/success
  // (alert-email flow). Defaults to wizard so existing in-app callers
  // are unaffected.
  const source = searchParams.get("source") === "alert" ? "alert" : "wizard";

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: "Gmail integration not configured. GOOGLE_CLIENT_ID is missing." },
      { status: 500 }
    );
  }

  // Both company and individual connections require a userId. Phase C
  // memory/writing-profile extraction attributes artifacts to a real user —
  // without one, the entire knowledge-extraction pipeline silently skips.
  // Company connections attribute to whichever admin ran the wizard, matching
  // how other shared-resource features (estimates, invoices) track createdBy
  // while still being visible to the whole company.
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required — wizard must pass the current user's id" },
      { status: 400 }
    );
  }

  const redirectUri = `${getAppUrl()}/api/integrations/gmail/callback`;

  // Encode full OAuth context into state. Google returns this verbatim on
  // the callback. Using base64 JSON so we can carry structured data through
  // Google's opaque-string `state` parameter.
  const state = Buffer.from(
    JSON.stringify({ companyId, userId, type, source })
  ).toString("base64");

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    // Full mailbox access. Required for: label create/apply, draft create,
    // send email, thread modify. Explicitly granted by user on consent.
    scope: "https://mail.google.com/",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}

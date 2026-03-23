import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";

const SCOPES = ["https://www.googleapis.com/auth/adwords"];
const REDIRECT_URI_PATH = "/api/admin/google-ads/auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  // Only enforce admin auth on the initial request (not the OAuth callback).
  // The callback is a raw Google redirect — it won't carry Firebase auth headers.
  // This is safe because the auth code is single-use and the response only displays the token.
  if (!code) {
    try {
      await requireAdmin(req);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Missing Google OAuth credentials" }, { status: 500 });
  }

  // Step 1: No code — redirect to Google consent
  if (!code) {
    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}${REDIRECT_URI_PATH}`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return NextResponse.redirect(authUrl.toString());
  }

  // Step 2: Have code — exchange for refresh token
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}${REDIRECT_URI_PATH}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed", details: tokenData }, { status: 500 });
  }

  // Display the refresh token for manual copy to env vars
  return new NextResponse(
    `<html>
      <body style="background:#0D0D0D;color:#E5E5E5;font-family:monospace;padding:40px;">
        <h1 style="color:#597794;">Google Ads Refresh Token</h1>
        <p>Copy this value to your GOOGLE_ADS_REFRESH_TOKEN environment variable:</p>
        <pre style="background:#1D1D1D;padding:16px;border-radius:4px;word-break:break-all;margin:16px 0;">
${tokenData.refresh_token ?? "No refresh token returned. You may need to revoke access and try again with prompt=consent."}
        </pre>
        <p style="color:#6B6B6B;">You can now close this page.</p>
      </body>
    </html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

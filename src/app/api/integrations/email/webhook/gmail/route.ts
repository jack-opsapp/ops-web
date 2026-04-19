/**
 * OPS Web - Gmail Webhook Endpoint
 *
 * POST /api/integrations/email/webhook/gmail
 * Receives Gmail Pub/Sub push notifications and triggers sync.
 *
 * Authentication: Google Pub/Sub push subscriptions sign each request with
 * an OIDC bearer token. We verify the token against Google's tokeninfo
 * endpoint and check that:
 *   1. The audience matches our configured push audience.
 *   2. The email matches our configured push service account.
 *   3. The token is not expired.
 *
 * Without this gate the endpoint accepts any POST and triggers manual-sync
 * jobs, which is a DoS / cost-amplification vector.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";

// Trim defensively: these values are compared to OIDC token claims via
// strict equality below. A trailing newline (easy to introduce via the
// Vercel UI when pasting) would silently 401 every real push with
// "Audience mismatch" or "Service account mismatch".
const PUBSUB_AUDIENCE = process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE?.trim();
const PUBSUB_SERVICE_ACCOUNT = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT?.trim();

interface TokenInfo {
  email?: string;
  email_verified?: string;
  aud?: string;
  exp?: string;
}

/**
 * Verify a Google-issued OIDC token by calling tokeninfo. Returns the
 * decoded payload on success. Throws on any failure so the caller can
 * reject the request.
 *
 * tokeninfo doesn't require any auth itself — it just validates the token's
 * signature and returns its claims. Network failure → fail closed.
 */
async function verifyPubSubToken(token: string): Promise<TokenInfo> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`tokeninfo rejected token (status ${res.status})`);
  }
  const info = (await res.json()) as TokenInfo;

  // Expiry sanity check — tokeninfo only signals validity at issue time.
  if (info.exp) {
    const expSec = Number(info.exp);
    if (!Number.isNaN(expSec) && expSec * 1000 < Date.now()) {
      throw new Error("tokeninfo: token expired");
    }
  }

  return info;
}

export async function POST(request: NextRequest) {
  // ── Authn: verify Google Pub/Sub OIDC bearer ────────────────────────────
  if (!PUBSUB_AUDIENCE || !PUBSUB_SERVICE_ACCOUNT) {
    // Fail closed — without these envs we can't verify the request and
    // every POST would otherwise be accepted.
    console.error(
      "[Gmail Webhook] GOOGLE_PUBSUB_PUSH_AUDIENCE or GOOGLE_PUBSUB_SERVICE_ACCOUNT not set"
    );
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 }
    );
  }
  const token = authHeader.slice("Bearer ".length).trim();

  let info: TokenInfo;
  try {
    info = await verifyPubSubToken(token);
  } catch (err) {
    console.error("[Gmail Webhook] Token verification failed:", err);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  if (info.aud !== PUBSUB_AUDIENCE) {
    return NextResponse.json(
      { error: "Audience mismatch" },
      { status: 401 }
    );
  }
  if (info.email !== PUBSUB_SERVICE_ACCOUNT) {
    return NextResponse.json(
      { error: "Service account mismatch" },
      { status: 401 }
    );
  }
  if (info.email_verified !== "true") {
    return NextResponse.json(
      { error: "Service account email not verified" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    // Gmail Pub/Sub notification contains base64-encoded data
    const data = JSON.parse(
      Buffer.from(body.message?.data || "", "base64").toString()
    );

    const email = data.emailAddress;
    if (!email) {
      return NextResponse.json(
        { error: "No email in notification" },
        { status: 400 }
      );
    }

    // Find the connection for this email. ilike tolerates any case variance
    // between Gmail's /userinfo response (which we stored) and the value
    // Pub/Sub echoes back in the notification.
    const supabase = getServiceRoleClient();
    const { data: connections } = await supabase
      .from("email_connections")
      .select("id, last_synced_at")
      .ilike("email", email)
      .eq("provider", "gmail")
      .eq("status", "active");

    if (!connections?.length) {
      return NextResponse.json({ ok: true }); // No matching connection, ignore
    }

    for (const conn of connections) {
      // Debounce: skip if synced within last 30 seconds
      if (conn.last_synced_at) {
        const lastSync = new Date(conn.last_synced_at);
        if (Date.now() - lastSync.getTime() < 30_000) continue;
      }

      // Queue sync job (fire and forget via internal API)
      fetch(`${getAppUrl()}/api/integrations/email/manual-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ connectionId: conn.id, source: "webhook" }),
      }).catch(() => {}); // fire and forget
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Gmail Webhook] Error:", err);
    return NextResponse.json({ ok: true }); // Always return 200 to Pub/Sub
  }
}

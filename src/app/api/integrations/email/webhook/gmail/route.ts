/**
 * OPS Web - Gmail Webhook Endpoint
 *
 * POST /api/integrations/email/webhook/gmail
 * Receives Gmail Pub/Sub push notifications and triggers sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function POST(request: NextRequest) {
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

    // Find the connection for this email
    const supabase = getServiceRoleClient();
    const { data: connections } = await supabase
      .from("email_connections")
      .select("id, last_synced_at")
      .eq("email", email)
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
      fetch(`${BASE_URL}/api/integrations/email/manual-sync`, {
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

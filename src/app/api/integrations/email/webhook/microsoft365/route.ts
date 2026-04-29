/**
 * OPS Web - Microsoft 365 Webhook Endpoint
 *
 * POST /api/integrations/email/webhook/microsoft365
 * Receives M365 change notifications and triggers sync.
 * Also handles the subscription validation handshake.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // M365 validation handshake — respond with validationToken on subscription creation
  const validationToken = searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const body = await request.json();
    const notifications = body.value || [];

    // Phase C observability: log every webhook hit for the heartbeat cron.
    console.log("[email-ingest] webhook", {
      provider: "microsoft365",
      notificationCount: notifications.length,
      at: new Date().toISOString(),
    });

    const supabase = getServiceRoleClient();

    for (const notification of notifications) {
      const connectionId = notification.clientState; // Set during subscription creation

      if (!connectionId) continue;

      // Debounce check
      const { data: conn } = await supabase
        .from("email_connections")
        .select("id, last_synced_at")
        .eq("id", connectionId)
        .eq("status", "active")
        .single();

      if (!conn) continue;

      if (conn.last_synced_at) {
        const lastSync = new Date(conn.last_synced_at);
        if (Date.now() - lastSync.getTime() < 30_000) continue;
      }

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
    console.error("[M365 Webhook] Error:", err);
    return NextResponse.json({ ok: true }); // Always return 200
  }
}

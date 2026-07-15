/**
 * OPS Web - Microsoft 365 Webhook Endpoint
 *
 * POST /api/integrations/email/webhook/microsoft365
 * Receives M365 change notifications and triggers sync.
 * Also handles the subscription validation handshake.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import { hashMicrosoft365ClientState } from "@/lib/email/microsoft365-webhook-security";
import { emailPipelineAuthorizationHeaders } from "@/lib/email/email-route-auth";

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
    const body = (await request.json()) as {
      value?: Array<{ clientState?: unknown; subscriptionId?: unknown }>;
    };
    const notifications = body.value;
    if (
      !Array.isArray(notifications) ||
      notifications.length === 0 ||
      notifications.length > 100
    ) {
      return NextResponse.json(
        { error: "Invalid notification batch" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const connectionIds = new Set<string>();

    for (const notification of notifications) {
      if (
        typeof notification.clientState !== "string" ||
        typeof notification.subscriptionId !== "string"
      ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const clientStateHash = await hashMicrosoft365ClientState(
        notification.clientState
      );
      const { data: conn, error: connectionError } = await supabase
        .from("email_connections")
        .select("id, last_synced_at")
        .eq("provider", "microsoft365")
        .eq("status", "active")
        .eq("sync_enabled", true)
        .eq("webhook_subscription_id", notification.subscriptionId)
        .eq("webhook_client_state_hash", clientStateHash)
        .maybeSingle();
      if (connectionError) {
        throw new Error(
          `Microsoft 365 webhook binding lookup failed: ${connectionError.message}`
        );
      }
      if (!conn) {
        // Reject the entire batch. Accepting a partial batch would let a forged
        // notification hide beside a valid subscription and still trigger
        // service-role work.
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (conn.last_synced_at) {
        const lastSync = new Date(conn.last_synced_at);
        if (Date.now() - lastSync.getTime() < 30_000) continue;
      }
      connectionIds.add(conn.id as string);
    }

    const authorizationHeaders = emailPipelineAuthorizationHeaders();

    // Phase C observability: log only authenticated webhook batches.
    console.log("[email-ingest] webhook", {
      provider: "microsoft365",
      notificationCount: notifications.length,
      connectionCount: connectionIds.size,
      at: new Date().toISOString(),
    });

    after(async () => {
      for (const connectionId of connectionIds) {
        try {
          const response = await fetch(
            `${getAppUrl()}/api/integrations/email/manual-sync`,
            {
              method: "POST",
              headers: authorizationHeaders,
              body: JSON.stringify({ connectionId, source: "webhook" }),
            }
          );
          if (!response.ok) {
            console.error("[M365 Webhook] Sync dispatch failed", {
              connectionId,
              status: response.status,
            });
          }
        } catch (error) {
          console.error("[M365 Webhook] Sync dispatch threw", {
            connectionId,
            error,
          });
        }
      }
    });

    return NextResponse.json(
      { ok: true, accepted: connectionIds.size },
      { status: 202 }
    );
  } catch (err) {
    console.error("[M365 Webhook] Error:", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 503 }
    );
  }
}

/**
 * POST /api/cron/webhook-renewal
 * Runs daily. Renews Gmail watches (7-day expiry) and M365 subscriptions (3-day expiry).
 * Targets connections with webhooks expiring in the next 2 days.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    // Find connections that need a webhook refresh. We pick up two
    // categories:
    //
    //   1. Active webhooks that will expire within the next 2 days — the
    //      normal renewal path, bounded by webhook_expires_at.
    //
    //   2. Connections that failed to set up a webhook in the first place
    //      (webhook_subscription_id IS NULL). Before B6 this was a dead
    //      state — the old filter required subscription_id IS NOT NULL so
    //      these rows could never self-heal. Now we retry on each cron
    //      tick until setup succeeds (or until status changes).
    //
    // Both categories are gated on sync_enabled + status='active' so we
    // don't hammer paused, errored, or needs_reconnect connections.
    const expiryThreshold = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: connections, error: connectionsError } = await supabase
      .from("email_connections")
      .select("id, provider, webhook_subscription_id, webhook_expires_at")
      .eq("sync_enabled", true)
      .eq("status", "active")
      .or(
        `webhook_subscription_id.is.null,webhook_expires_at.lt.${expiryThreshold}`
      );

    if (connectionsError) {
      console.error("[webhook-renewal] connections query failed:", connectionsError);
      throw new Error(
        `webhook-renewal connections query failed: ${connectionsError.message}`
      );
    }

    const results: Array<{
      id: string;
      provider: string;
      renewed: boolean;
      error?: string;
    }> = [];

    for (const conn of connections ?? []) {
      try {
        const connection = await EmailService.getConnection(conn.id as string);
        if (!connection) continue;

        const provider = EmailService.getProvider(connection);
        const webhook = await provider.renewWebhook(
          conn.webhook_subscription_id as string
        );

        await EmailService.updateConnection(conn.id as string, {
          webhookSubscriptionId: webhook.subscriptionId,
          webhookExpiresAt: webhook.expiresAt,
        });

        results.push({
          id: conn.id as string,
          provider: conn.provider as string,
          renewed: true,
        });
      } catch (err) {
        results.push({
          id: conn.id as string,
          provider: conn.provider as string,
          renewed: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      renewed: results.filter((r) => r.renewed).length,
      results,
    });
  } catch (err) {
    console.error("[webhook-renewal]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

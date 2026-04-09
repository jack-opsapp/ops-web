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
    // Find connections with webhooks expiring in the next 2 days
    const expiryThreshold = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: connections } = await supabase
      .from("email_connections")
      .select("id, provider, webhook_subscription_id, webhook_expires_at")
      .eq("sync_enabled", true)
      .eq("status", "active")
      .not("webhook_subscription_id", "is", null)
      .lt("webhook_expires_at", expiryThreshold);

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

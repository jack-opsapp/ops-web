/**
 * OPS Web - Email Activation Endpoint
 *
 * POST /api/integrations/email/activate
 * Saves sync profile, creates OPS Pipeline label, sets up webhook, activates sync.
 * Called by wizard Step 5.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import type { ActivationPayload } from "@/lib/types/email-import";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const payload: ActivationPayload = await request.json();
  const { connectionId, companyId, syncIntervalMinutes, syncProfile } = payload;

  if (!connectionId || !companyId) {
    return NextResponse.json(
      { error: "connectionId and companyId required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const connection = await EmailService.getConnection(connectionId);
    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    const provider = EmailService.getProvider(connection);

    // 1. Create "OPS Pipeline" label/category in user's inbox
    let labelId: string = "";
    try {
      const existingLabels = await provider.listLabels();
      const existing = existingLabels.find((l) => l.name === "OPS Pipeline");
      labelId = existing?.id || (await provider.createLabel("OPS Pipeline"));
    } catch (err) {
      console.error("[email-activate] Failed to create label:", err);
    }

    // 2. Set up webhook for push notifications
    let webhookSubscriptionId: string | null = null;
    let webhookExpiresAt: Date | null = null;
    try {
      const webhookUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/email/webhook/${connection.provider}`;
      const webhook = await provider.setupWebhook(webhookUrl);
      webhookSubscriptionId = webhook.subscriptionId;
      // Guard against invalid date from provider response
      webhookExpiresAt = webhook.expiresAt instanceof Date && !isNaN(webhook.expiresAt.getTime())
        ? webhook.expiresAt
        : null;
    } catch (err) {
      console.error("[email-activate] Failed to set up webhook:", err);
      // Non-fatal — scheduled sync will still work
    }

    // 3. Save sync profile and activate
    await EmailService.updateConnection(connectionId, {
      syncFilters: {
        ...syncProfile,
        wizardCompleted: true,
        wizardStep: 5,
      },
      syncIntervalMinutes,
      syncEnabled: true,
      opsLabelId: labelId,
      webhookSubscriptionId: webhookSubscriptionId || undefined,
      webhookExpiresAt: webhookExpiresAt || undefined,
      status: "active",
    });

    return NextResponse.json({
      ok: true,
      labelId,
      webhookActive: !!webhookSubscriptionId,
      syncIntervalMinutes,
    });
  } catch (err) {
    console.error("[email-activate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Activation failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

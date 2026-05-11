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
import { getAppUrl } from "@/lib/utils/app-url";
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

    // Collect per-step warnings so the wizard can surface partial-success
    // states to the user instead of pretending everything worked.
    const warnings: Array<{ step: string; message: string }> = [];

    // 1. Create "OPS Pipeline" label/category in user's inbox
    let labelId: string = "";
    try {
      const existingLabels = await provider.listLabels();
      const existing = existingLabels.find((l) => l.name === "OPS Pipeline");
      labelId = existing?.id || (await provider.createLabel("OPS Pipeline"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[email-activate] Failed to create label:", err);
      warnings.push({ step: "label", message });
    }

    // 2. Set up webhook for push notifications
    let webhookSubscriptionId: string | null = null;
    let webhookExpiresAt: Date | null = null;
    try {
      const webhookUrl = `${getAppUrl()}/api/integrations/email/webhook/${connection.provider}`;
      const webhook = await provider.setupWebhook(webhookUrl);
      webhookSubscriptionId = webhook.subscriptionId;
      // Guard against invalid date from provider response
      webhookExpiresAt = webhook.expiresAt instanceof Date && !isNaN(webhook.expiresAt.getTime())
        ? webhook.expiresAt
        : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[email-activate] Failed to set up webhook:", err);
      // Non-fatal for activation — scheduled sync (cron) still runs every
      // 15 minutes even without Pub/Sub push. But we surface the warning
      // so the user knows real-time updates aren't wired up and the
      // renewal cron will retry on each cron tick.
      warnings.push({ step: "webhook", message });
    }

    // 3. Save sync profile and activate
    // Merge into existing syncFilters so activation preserves wizard state —
    // lastScanJobId, lastImportJobId, reviewState, and anything else the
    // wizard has persisted. Replacing (not merging) caused fix #20's auto-
    // scan bug: once activation wiped the job IDs, reopening the wizard for
    // an already-active connection found empty state and fell through to a
    // phantom fresh analyze. The PATCH /connection route already uses this
    // merge pattern — activate should match.
    const existingFilters = (connection.syncFilters as Record<string, unknown>) || {};

    await EmailService.updateConnection(connectionId, {
      syncFilters: {
        ...existingFilters,
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

    // ─── Resolve the persistent "Pipeline import complete" notification ─
    // The import route inserts a persistent notification with action_url
    // "/settings?tab=integrations" and action_label "Activate Sync".
    // Activation is the resolving action — mark any matching unresolved
    // notifications as read so the rail stops telling the operator there
    // is pending work. We target by user/company + title because the
    // import notification does not carry a connection_id reference.
    try {
      const connectionUserId = connection.userId ?? null;
      if (connectionUserId) {
        const { error: resolveErr } = await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("user_id", connectionUserId)
          .eq("company_id", companyId)
          .eq("title", "Pipeline import complete")
          .eq("is_read", false);
        if (resolveErr) {
          console.error(
            "[email-activate] Failed to resolve import-complete notification:",
            resolveErr.message,
          );
        }
      }
    } catch (notifErr) {
      // Never fail activation because of a notification cleanup hiccup.
      console.error(
        "[email-activate] Unexpected error resolving import notification:",
        notifErr,
      );
    }

    return NextResponse.json({
      ok: true,
      labelId,
      webhookActive: !!webhookSubscriptionId,
      syncIntervalMinutes,
      warnings: warnings.length > 0 ? warnings : undefined,
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

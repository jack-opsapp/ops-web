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
import { hashMicrosoft365ClientState } from "@/lib/email/microsoft365-webhook-security";
import type { ActivationPayload } from "@/lib/types/email-import";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";

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
    if (connection.companyId !== companyId) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    const authError = await requireEmailCompanyAccess(request, companyId);
    if (authError) return authError;

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
    let webhookClientStateHash: string | null = null;
    try {
      const webhookUrl = `${getAppUrl()}/api/integrations/email/webhook/${connection.provider}`;
      const webhook = await provider.setupWebhook(webhookUrl);
      webhookSubscriptionId = webhook.subscriptionId;
      webhookClientStateHash = webhook.clientState
        ? await hashMicrosoft365ClientState(webhook.clientState)
        : null;
      // Guard against invalid date from provider response
      webhookExpiresAt =
        webhook.expiresAt instanceof Date && !isNaN(webhook.expiresAt.getTime())
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
    const existingFilters =
      (connection.syncFilters as Record<string, unknown>) || {};

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
      webhookClientStateHash,
      status: "active",
    });

    // Read the provider signature (Gmail only) and reconcile the persistent
    // setup prompt as soon as the inbox becomes active. This is deliberately
    // non-fatal: signature setup can be completed from Settings, while
    // autonomous draft placement remains blocked until a signature exists.
    if (connection.userId) {
      try {
        await resolveEmailSignatureForMessage({
          supabase,
          connection,
          userId: connection.userId,
          refreshProviderIfMissing: true,
        });
      } catch (error) {
        warnings.push({
          step: "signature",
          message: error instanceof Error ? error.message : String(error),
        });
      }
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

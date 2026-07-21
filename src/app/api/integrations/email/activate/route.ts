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
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { PersonalEmailConnectionLifecycleService } from "@/lib/api/services/personal-email-connection-lifecycle-service";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import {
  buildEmailProviderMutationFingerprint,
  createEmailProviderMutationAttemptService,
} from "@/lib/api/services/email-provider-mutation-attempt-service";

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
    const access = await resolveEmailConnectionOperationAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      requireUsable: true,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }
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
    const locked = await runWithEmailConnectionSyncLock({
      connectionId: connection.id,
      context: "email-activation",
      client: supabase,
      run: async (checkpoint) => {
        await checkpoint();
        const provider = EmailService.getProvider(connection);

        // Collect per-step warnings so the wizard can surface partial-success
        // states to the user instead of pretending everything worked.
        const warnings: Array<{ step: string; message: string }> = [];

        // 1. Create "OPS Pipeline" label/category in user's inbox
        let labelId: string = "";
        try {
          const existingLabels = await provider.listLabels();
          const existing = existingLabels.find(
            (label) => label.name === "OPS Pipeline"
          );
          labelId =
            existing?.id || (await provider.createLabel("OPS Pipeline"));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[email-activate] Failed to create label:", err);
          warnings.push({ step: "label", message });
        }
        await checkpoint();

        // 2. Set up webhook for push notifications
        let webhookSubscriptionId: string | null = null;
        let webhookExpiresAt: Date | null = null;
        let webhookClientStateHash: string | null = null;
        try {
          const webhookUrl = `${getAppUrl()}/api/integrations/email/webhook/${connection.provider}`;
          const existingExpiry =
            connection.webhookExpiresAt instanceof Date &&
            Number.isFinite(connection.webhookExpiresAt.getTime())
              ? connection.webhookExpiresAt
              : null;
          const existingMicrosoftSubscriptionIsUsable = Boolean(
            connection.provider === "microsoft365" &&
            connection.webhookSubscriptionId?.trim() &&
            connection.webhookClientStateHash?.trim() &&
            existingExpiry &&
            existingExpiry.getTime() > Date.now()
          );

          if (existingMicrosoftSubscriptionIsUsable) {
            webhookSubscriptionId = connection.webhookSubscriptionId!;
            webhookExpiresAt = existingExpiry;
            webhookClientStateHash = connection.webhookClientStateHash!;
          } else if (connection.provider === "microsoft365") {
            const setupGeneration = [
              connection.webhookSubscriptionId?.trim() || "none",
              existingExpiry?.toISOString() || "none",
              connection.webhookClientStateHash?.trim() ? "state" : "no-state",
            ].join(":");
            const completed = await createEmailProviderMutationAttemptService(
              supabase
            ).execute({
              actorUserId: access.actor.userId,
              connectionId: connection.id,
              operationKind: "webhook_setup",
              operationKey: `m365-webhook-setup:${setupGeneration}`,
              requestFingerprint: buildEmailProviderMutationFingerprint({
                version: 1,
                connectionId: connection.id,
                webhookUrl,
              }),
              assertMailboxLease: () => checkpoint(true),
              executeProvider: async () => {
                await checkpoint();
                const webhook = await provider.setupWebhook(webhookUrl);
                const expiresAt =
                  webhook.expiresAt instanceof Date &&
                  Number.isFinite(webhook.expiresAt.getTime())
                    ? webhook.expiresAt.toISOString()
                    : null;
                const clientStateHash = webhook.clientState
                  ? await hashMicrosoft365ClientState(webhook.clientState)
                  : null;
                return {
                  resourceId: webhook.subscriptionId,
                  result: { expiresAt, clientStateHash },
                };
              },
              reconcile: async (acceptance) => {
                const expiresAtRaw = acceptance.result.expiresAt;
                const clientStateHash = acceptance.result.clientStateHash;
                const expiresAt =
                  typeof expiresAtRaw === "string"
                    ? new Date(expiresAtRaw)
                    : new Date(Number.NaN);
                if (
                  !Number.isFinite(expiresAt.getTime()) ||
                  typeof clientStateHash !== "string" ||
                  !clientStateHash.trim()
                ) {
                  throw new Error("MICROSOFT_WEBHOOK_ACCEPTANCE_INVALID");
                }
                await EmailService.updateConnection(connection.id, {
                  webhookSubscriptionId: acceptance.resourceId,
                  webhookExpiresAt: expiresAt,
                  webhookClientStateHash: clientStateHash,
                });
              },
            });
            const expiresAtRaw = completed.providerResult.expiresAt;
            const clientStateHash = completed.providerResult.clientStateHash;
            const acceptedExpiry =
              typeof expiresAtRaw === "string"
                ? new Date(expiresAtRaw)
                : new Date(Number.NaN);
            if (
              !completed.providerResourceId ||
              !Number.isFinite(acceptedExpiry.getTime()) ||
              typeof clientStateHash !== "string" ||
              !clientStateHash.trim()
            ) {
              throw new Error("MICROSOFT_WEBHOOK_ACCEPTANCE_INVALID");
            }
            webhookSubscriptionId = completed.providerResourceId;
            webhookExpiresAt = acceptedExpiry;
            webhookClientStateHash = clientStateHash;
          } else {
            const webhook = await provider.setupWebhook(webhookUrl);
            webhookSubscriptionId = webhook.subscriptionId;
            webhookClientStateHash = webhook.clientState
              ? await hashMicrosoft365ClientState(webhook.clientState)
              : null;
            webhookExpiresAt =
              webhook.expiresAt instanceof Date &&
              !isNaN(webhook.expiresAt.getTime())
                ? webhook.expiresAt
                : null;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[email-activate] Failed to set up webhook:", err);
          // Non-fatal for activation — scheduled sync (cron) still runs every
          // 15 minutes even without Pub/Sub push. But we surface the warning
          // so the user knows real-time updates aren't wired up and the
          // renewal cron will retry on each cron tick.
          warnings.push({ step: "webhook", message });
        }
        await checkpoint();

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
        await checkpoint();

        // The status update enqueues lifecycle reconciliation transactionally.
        // Resolve the persistent warning now; the hourly drain remains the retry
        // path if notification persistence is temporarily unavailable.
        if (connection.type === "individual") {
          await PersonalEmailConnectionLifecycleService.reconcile(
            connectionId,
            supabase
          );
          await checkpoint();
        }

        // Read the provider signature (Gmail only) and reconcile the persistent
        // setup prompt as soon as the inbox becomes active. This is deliberately
        // non-fatal: signature setup can be completed from Settings, while
        // autonomous draft placement remains blocked until a signature exists.
        try {
          await resolveEmailSignatureForMessage({
            supabase,
            connection,
            userId: access.actor.userId,
            refreshProviderIfMissing: true,
            providerLockCheckpoint: checkpoint,
          });
        } catch (error) {
          warnings.push({
            step: "signature",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        // Any lease-renewal error caught by the non-fatal signature boundary is
        // retained by the renewer and must still fail activation closed.
        await checkpoint();

        return {
          ok: true,
          labelId,
          webhookActive: !!webhookSubscriptionId,
          syncIntervalMinutes,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      },
    });
    if (!locked.acquired) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again in a few minutes." },
        { status: 409 }
      );
    }
    return NextResponse.json(locked.value);
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

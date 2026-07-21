/**
 * POST /api/cron/webhook-renewal
 * Runs daily. Renews Gmail watches (7-day expiry) and M365 subscriptions (3-day expiry).
 * Targets connections with webhooks expiring in the next 2 days.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { hashMicrosoft365ClientState } from "@/lib/email/microsoft365-webhook-security";
import { getAppUrl } from "@/lib/utils/app-url";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import {
  buildEmailProviderMutationFingerprint,
  createEmailProviderMutationAttemptService,
} from "@/lib/api/services/email-provider-mutation-attempt-service";

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
      .select(
        "id, provider, webhook_subscription_id, webhook_expires_at, webhook_client_state_hash"
      )
      .eq("sync_enabled", true)
      .eq("status", "active");

    if (connectionsError) {
      console.error(
        "[webhook-renewal] connections query failed:",
        connectionsError
      );
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
      const expiresAt = conn.webhook_expires_at
        ? new Date(conn.webhook_expires_at as string).getTime()
        : 0;
      const requiresRenewal =
        !conn.webhook_subscription_id ||
        !Number.isFinite(expiresAt) ||
        expiresAt < new Date(expiryThreshold).getTime() ||
        (conn.provider === "microsoft365" && !conn.webhook_client_state_hash);
      if (!requiresRenewal) continue;

      try {
        const connection = await EmailService.getConnection(conn.id as string);
        if (!connection) continue;

        const locked = await runWithEmailConnectionSyncLock({
          connectionId: connection.id,
          context: "email-webhook-renewal",
          client: supabase,
          run: async (checkpoint) => {
            await checkpoint();
            const provider = EmailService.getProvider(connection);
            const needsFreshSubscription =
              !conn.webhook_subscription_id ||
              (connection.provider === "microsoft365" &&
                !connection.webhookClientStateHash);
            const webhookUrl = `${getAppUrl()}/api/integrations/email/webhook/${connection.provider}`;

            if (connection.provider === "microsoft365") {
              const operationKind = needsFreshSubscription
                ? "webhook_setup"
                : "webhook_renewal";
              const currentSubscriptionId =
                typeof conn.webhook_subscription_id === "string"
                  ? conn.webhook_subscription_id.trim()
                  : "";
              const operationKey = needsFreshSubscription
                ? [
                    "m365-webhook-setup",
                    currentSubscriptionId || "none",
                    (conn.webhook_expires_at as string | null) || "none",
                    connection.webhookClientStateHash ? "state" : "no-state",
                  ].join(":")
                : `m365-webhook-renew:${currentSubscriptionId}:${
                    conn.webhook_expires_at as string
                  }`;
              const completed = await createEmailProviderMutationAttemptService(
                supabase
              ).execute({
                actorUserId: null,
                connectionId: connection.id,
                operationKind,
                operationKey,
                requestFingerprint: buildEmailProviderMutationFingerprint(
                  needsFreshSubscription
                    ? {
                        version: 1,
                        connectionId: connection.id,
                        webhookUrl,
                      }
                    : {
                        version: 1,
                        connectionId: connection.id,
                        subscriptionId: currentSubscriptionId,
                      }
                ),
                assertMailboxLease: () => checkpoint(true),
                executeProvider: async () => {
                  await checkpoint();
                  const webhook = needsFreshSubscription
                    ? await provider.setupWebhook(webhookUrl)
                    : await provider.renewWebhook(currentSubscriptionId);
                  const expiresAt =
                    webhook.expiresAt instanceof Date &&
                    Number.isFinite(webhook.expiresAt.getTime())
                      ? webhook.expiresAt.toISOString()
                      : null;
                  const clientStateHash = webhook.clientState
                    ? await hashMicrosoft365ClientState(webhook.clientState)
                    : (connection.webhookClientStateHash ?? null);
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
                    !clientStateHash.trim() ||
                    (!needsFreshSubscription &&
                      acceptance.resourceId !== currentSubscriptionId)
                  ) {
                    throw new Error("MICROSOFT_WEBHOOK_ACCEPTANCE_INVALID");
                  }
                  await checkpoint();
                  await EmailService.updateConnection(conn.id as string, {
                    webhookSubscriptionId: acceptance.resourceId,
                    webhookExpiresAt: expiresAt,
                    webhookClientStateHash: clientStateHash,
                  });
                  await checkpoint();
                },
              });
              if (!completed.providerResourceId) {
                throw new Error("MICROSOFT_WEBHOOK_ACCEPTANCE_INVALID");
              }
            } else {
              const webhook = needsFreshSubscription
                ? await provider.setupWebhook(webhookUrl)
                : await provider.renewWebhook(
                    conn.webhook_subscription_id as string
                  );
              await checkpoint();

              await EmailService.updateConnection(conn.id as string, {
                webhookSubscriptionId: webhook.subscriptionId,
                webhookExpiresAt: webhook.expiresAt,
                webhookClientStateHash: webhook.clientState
                  ? await hashMicrosoft365ClientState(webhook.clientState)
                  : (connection.webhookClientStateHash ?? null),
              });
              await checkpoint();
            }
          },
        });
        if (!locked.acquired) {
          throw new Error("EMAIL_WEBHOOK_RENEWAL_MAILBOX_BUSY");
        }

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

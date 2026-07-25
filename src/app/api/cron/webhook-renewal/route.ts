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
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
  type CronWorkloadLease,
} from "@/lib/api/services/cron-workload-control-service";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

const WORKLOAD_KEY = "email-webhook-renewal";
const WEBHOOK_RENEWAL_LIMIT = 10;

interface WebhookConnectionRow {
  id: string;
  provider: string;
  webhook_subscription_id: string | null;
  webhook_expires_at: string | null;
  webhook_client_state_hash: string | null;
}

function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function loadDueConnections(
  supabase: SupabaseClient,
  expiryThreshold: string,
  cursor: string | null
): Promise<WebhookConnectionRow[]> {
  try {
    let query = supabase
      .from("email_connections")
      .select(
        "id, provider, webhook_subscription_id, webhook_expires_at, webhook_client_state_hash"
      )
      .eq("sync_enabled", true)
      .eq("status", "active")
      .or(
        [
          "webhook_subscription_id.is.null",
          "webhook_expires_at.is.null",
          `webhook_expires_at.lt.${expiryThreshold}`,
          "and(provider.eq.microsoft365,webhook_client_state_hash.is.null)",
        ].join(",")
      )
      .order("id", { ascending: true });
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query.limit(WEBHOOK_RENEWAL_LIMIT);
    if (error) {
      throw new CronDatabaseOperationError(
        `Webhook renewal connection query failed: ${error.message}`,
        { cause: error }
      );
    }
    return (data ?? []) as WebhookConnectionRow[];
  } catch (cause) {
    if (cause instanceof CronDatabaseOperationError) throw cause;
    throw new CronDatabaseOperationError(
      "Webhook renewal connection query failed",
      { cause }
    );
  }
}

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
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: (lease) => runWebhookRenewal(supabase, lease),
    });
    if (controlled.status === "skipped") {
      const reason =
        controlled.reason === "lease_held"
          ? "already_running"
          : controlled.reason;
      return NextResponse.json(
        {
          ok: controlled.reason === "lease_held",
          ran: false,
          reason,
        },
        { status: controlled.reason === "lease_held" ? 200 : 503 }
      );
    }
    return NextResponse.json(controlled.value);
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

async function runWebhookRenewal(
  supabase: SupabaseClient,
  lease: CronWorkloadLease
) {
  const expiryThreshold = new Date(
    Date.now() + 2 * 24 * 60 * 60 * 1000
  ).toISOString();
  const cursor = await readCronWorkloadCursor(
    supabase,
    WORKLOAD_KEY,
    lease
  );
  let connections = await loadDueConnections(supabase, expiryThreshold, cursor);
  if (cursor && connections.length === 0) {
    connections = await loadDueConnections(supabase, expiryThreshold, null);
  }
  const results: Array<{
    id: string;
    provider: string;
    renewed: boolean;
    error?: string;
  }> = [];

  for (const conn of connections) {
    try {
      const connection = await EmailService.getConnection(conn.id as string);
      if (!connection) continue;

      const locked = await runWithEmailConnectionSyncLock({
        connectionId: connection.id,
        context: "email-webhook-renewal",
        client: supabase,
        abortOnDatabaseError: true,
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
      if (err instanceof CronDatabaseOperationError) throw err;
      results.push({
        id: conn.id as string,
        provider: conn.provider as string,
        renewed: false,
        error: errorMessage(err),
      });
    }
  }

  const nextCursor =
    connections.length === WEBHOOK_RENEWAL_LIMIT
      ? (connections.at(-1)?.id ?? null)
      : null;
  await advanceCronWorkloadCursor(
    supabase,
    WORKLOAD_KEY,
    lease,
    cursor,
    nextCursor
  );

  return {
    ok: true,
    renewed: results.filter((r) => r.renewed).length,
    results,
    cursor: { previous: cursor, next: nextCursor },
  };
}

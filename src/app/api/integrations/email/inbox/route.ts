/**
 * Legacy provider-thread detail endpoint.
 *
 * `threadId` is the canonical OPS email_threads.id. Provider-wide list/search
 * mode is intentionally closed; callers must use /api/inbox/threads so the
 * assigned opportunity/inbox filter is applied before pagination.
 */

import { NextRequest, NextResponse } from "next/server";

import { EmailService } from "@/lib/api/services/email-service";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

const PROVIDER_THREAD_READ_DEADLINE_MS = 45_000;

function mapFromDb(row: Record<string, unknown>): EmailConnection {
  const type = row.type as EmailConnection["type"];
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as EmailConnection["provider"],
    type,
    userId: type === "individual" ? ((row.user_id as string) ?? null) : null,
    defaultIntakeOwnerId:
      type === "company"
        ? ((row.default_intake_owner_id as string) ?? null)
        : null,
    email: row.email as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: new Date(row.expires_at as string),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: row.last_synced_at
      ? new Date(row.last_synced_at as string)
      : null,
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as EmailConnection["syncFilters"]) ?? {},
    webhookSubscriptionId: (row.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: row.webhook_expires_at
      ? new Date(row.webhook_expires_at as string)
      : null,
    opsLabelId: (row.ops_label_id as string) ?? null,
    aiReviewEnabled: (row.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (row.ai_memory_enabled as boolean) ?? false,
    status: (row.status as EmailConnection["status"]) ?? "active",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function normalizeToResponse(email: NormalizedEmail) {
  return {
    id: email.id,
    threadId: email.threadId,
    from: email.from,
    fromName: email.fromName,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    snippet: email.snippet,
    date: email.date.toISOString(),
    isRead: email.isRead,
    hasAttachments: email.hasAttachments,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const threadId = searchParams.get("threadId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const actorResolution = await resolveEmailRouteActor(request, {
      claimedCompanyId: companyId,
    });
    if (!actorResolution.ok) return actorResolution.response;

    // A raw provider list/search has no internal thread anchor and cannot
    // satisfy the opportunity/inbox intersection.
    if (!threadId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabase = getServiceRoleClient();
    const access = await resolveEmailOpportunityAccess({
      actor: actorResolution.actor,
      operation: "read",
      threadId,
      supabase,
    });
    if (!access.allowed || !access.providerThreadId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: connectionRow, error: connectionError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", access.connectionId)
      .eq("company_id", actorResolution.actor.companyId)
      .eq("status", "active")
      .maybeSingle();

    if (connectionError) {
      throw new Error(`Connection lookup failed: ${connectionError.message}`);
    }
    if (!connectionRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const connection = mapFromDb(connectionRow as Record<string, unknown>);
    const connectionOwnerId =
      connection.type === "individual" ? connection.userId : null;
    if (
      connection.type !== access.connectionType ||
      connectionOwnerId !== access.connectionOwnerId
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const providerThreadId = access.providerThreadId;
    const locked = await runWithSupabase(supabase, () =>
      runWithEmailConnectionSyncLock({
        connectionId: connection.id,
        context: "legacy-email-inbox-thread",
        client: supabase,
        run: async () => {
          const deadlineAt = Date.now() + PROVIDER_THREAD_READ_DEADLINE_MS;
          const provider = EmailService.getProvider(connection);
          const messages = await provider.fetchThread(providerThreadId, {
            deadlineAt,
            context: "legacy inbox thread",
          });
          const imageAttachments = await provider
            .getImageAttachmentsFromThread(providerThreadId, {
              deadlineAt,
              context: "legacy inbox thread attachments",
            })
            .catch(() => []);

          const attachmentsByMessage = new Map<
            string,
            (typeof imageAttachments)[number][]
          >();
          for (const attachment of imageAttachments) {
            if (!attachmentsByMessage.has(attachment.messageId)) {
              attachmentsByMessage.set(attachment.messageId, []);
            }
            attachmentsByMessage.get(attachment.messageId)!.push(attachment);
          }

          // Provider adapters may refresh access tokens while reading. Persist
          // only the exact canonical connection selected above.
          if (connection.accessToken !== connectionRow.access_token) {
            await supabase
              .from("email_connections")
              .update({
                access_token: connection.accessToken,
                expires_at: connection.expiresAt.toISOString(),
              })
              .eq("id", connection.id);
          }

          return {
            messages: messages.map((message) => ({
              ...normalizeToResponse(message),
              bodyText: message.bodyText,
              attachments: (attachmentsByMessage.get(message.id) ?? []).map(
                (attachment) => ({
                  attachmentId: attachment.attachmentId,
                  filename: attachment.filename,
                  mimeType: attachment.mimeType,
                  size: attachment.size,
                })
              ),
            })),
          };
        },
      })
    );
    if (!locked.acquired) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again in a few minutes." },
        { status: 409 }
      );
    }

    return NextResponse.json(locked.value);
  } catch (error) {
    console.error("All Mail inbox error:", error);
    return NextResponse.json(
      {
        error: `Failed to fetch inbox: ${(error as Error).message}`,
      },
      { status: 500 }
    );
  }
}

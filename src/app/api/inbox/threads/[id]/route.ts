/**
 * OPS Web - Inbox Thread Detail + Actions
 *
 * GET  /api/inbox/threads/{id}        — full thread (row + messages from provider)
 * PATCH /api/inbox/threads/{id}       — action handler (archive/unarchive/snooze/
 *                                        unsnooze/recategorize/markRead/label)
 *
 * Auth: Firebase/Supabase JWT. Permissions gated per action:
 *   - GET                : inbox.view
 *   - archive/unarchive  : inbox.archive
 *   - snooze/unsnooze    : inbox.snooze
 *   - recategorize       : inbox.categorize
 *   - markRead           : inbox.view (any viewer can mark read)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { EmailService } from "@/lib/api/services/email-service";
import { PhaseCLearningService } from "@/lib/api/services/phase-c-learning-service";
import {
  extractEmailAddress,
  stripQuotedContent,
  stripPriorMessageOverlap,
} from "@/lib/utils/email-parsing";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { after } from "next/server";

const CATEGORY_SET = new Set<string>(EMAIL_THREAD_CATEGORIES);

// ─── GET: thread detail ─────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const canView = await checkPermissionById(user.id as string, "inbox.view");
  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceRoleClient();

  try {
    const thread = await runWithSupabase(supabase, () =>
      EmailThreadService.getThread(id, user.company_id as string)
    );
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Fetch messages from provider for the full body. Fall back to activities.
    const { data: connRow } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", thread.connectionId)
      .single();

    // Owning mailbox address. We use this (not the stored per-row `direction`
    // column, which is unreliable for imported data) to decide inbound vs
    // outbound on every message. Whatever produces the UI alignment — left
    // vs right, gray vs accent — must trace to this comparison and nothing
    // else.
    const connectionEmail = connRow
      ? extractEmailAddress((connRow.email as string) ?? "").toLowerCase()
      : "";

    const deriveDirection = (fromField: string | null | undefined): "inbound" | "outbound" => {
      if (!connectionEmail || !fromField) return "inbound";
      return extractEmailAddress(fromField).toLowerCase() === connectionEmail
        ? "outbound"
        : "inbound";
    };

    let messages: Array<Record<string, unknown>> = [];
    if (connRow) {
      try {
        const connection = {
          id: connRow.id as string,
          companyId: connRow.company_id as string,
          provider: connRow.provider,
          type: connRow.type,
          userId: (connRow.user_id as string) ?? null,
          email: connRow.email as string,
          accessToken: connRow.access_token as string,
          refreshToken: connRow.refresh_token as string,
          expiresAt: new Date(connRow.expires_at as string),
          historyId: (connRow.history_id as string) ?? null,
          syncEnabled: (connRow.sync_enabled as boolean) ?? true,
          lastSyncedAt: connRow.last_synced_at ? new Date(connRow.last_synced_at as string) : null,
          syncIntervalMinutes: (connRow.sync_interval_minutes as number) ?? 60,
          syncFilters: connRow.sync_filters ?? {},
          webhookSubscriptionId: (connRow.webhook_subscription_id as string) ?? null,
          webhookExpiresAt: connRow.webhook_expires_at ? new Date(connRow.webhook_expires_at as string) : null,
          opsLabelId: (connRow.ops_label_id as string) ?? null,
          aiReviewEnabled: (connRow.ai_review_enabled as boolean) ?? false,
          aiMemoryEnabled: (connRow.ai_memory_enabled as boolean) ?? false,
          status: (connRow.status as string) ?? "active",
          createdAt: new Date(connRow.created_at as string),
          updatedAt: new Date(connRow.updated_at as string),
        } as Parameters<typeof EmailService.getProvider>[0];

        const provider = EmailService.getProvider(connection);
        const providerMsgs = await provider.fetchThread(thread.providerThreadId);
        messages = providerMsgs.map((m) => {
          const rawBody = m.bodyText ?? "";
          // 3-layer clean-body cascade (see email-parsing.ts header):
          //   1. provider-native (M365 uniqueBody, Gmail HTML-first) → bodyTextClean
          //   2. plain-text regex stripping via stripQuotedContent
          //   3. cross-message overlap — applied below once all messages are in hand.
          const providerClean = m.bodyTextClean?.trim();
          const initialClean =
            providerClean && providerClean.length > 0
              ? providerClean
              : stripQuotedContent(rawBody);
          return {
            id: m.id,
            from: m.from,
            fromName: m.fromName,
            to: m.to,
            cc: m.cc,
            subject: m.subject,
            snippet: m.snippet,
            bodyText: rawBody,
            cleanBodyText: initialClean,
            direction: deriveDirection(m.from),
            date: m.date.toISOString(),
            isRead: m.isRead,
            hasAttachments: m.hasAttachments,
          };
        });
      } catch (err) {
        console.error("[/api/inbox/threads/:id] provider.fetchThread failed:", err);
        // Fall through to activities fallback
      }
    }

    if (messages.length === 0) {
      const { data: activityRows } = await supabase
        .from("activities")
        .select("id, from_email, to_emails, cc_emails, subject, content, body_text, direction, is_read, has_attachments, created_at")
        .eq("company_id", thread.companyId)
        .eq("type", "email")
        .eq("email_thread_id", thread.providerThreadId)
        .order("created_at", { ascending: true });

      messages = (activityRows ?? []).map((r) => {
        const rawBody =
          ((r.body_text as string) ?? (r.content as string) ?? "");
        // Activities fallback has no provider-clean body stored — regex layer
        // only. Cross-message pass still runs below to catch cases where the
        // regex missed.
        const cleanBody = stripQuotedContent(rawBody);
        return {
          id: r.id,
          from: r.from_email,
          fromName: null,
          to: r.to_emails ?? [],
          cc: r.cc_emails ?? [],
          subject: r.subject ?? "",
          snippet: (r.content as string) ?? "",
          bodyText: rawBody,
          cleanBodyText: cleanBody,
          direction: deriveDirection(r.from_email as string | null),
          date: (r.created_at as string),
          isRead: r.is_read,
          hasAttachments: r.has_attachments,
        };
      });
    }

    // Layer 3 — cross-message overlap. For each message (in chronological
    // order), subtract any prior message body that appears verbatim inside
    // the current clean body. This catches chains where the user pasted an
    // older email into a new reply without quote markers, or quoted via a
    // client whose structural pattern we don't yet recognize.
    if (messages.length > 1) {
      const priorBodies: string[] = [];
      for (const m of messages) {
        const current = (m.cleanBodyText as string) ?? "";
        if (current && priorBodies.length > 0) {
          m.cleanBodyText = stripPriorMessageOverlap(current, priorBodies);
        }
        // Prime the pool with the FULL body of this message (not the stripped
        // one) so later overlap checks still find the complete signature even
        // if layers 1–2 already trimmed this message's own display text.
        const fullBody = (m.bodyText as string) ?? "";
        if (fullBody) priorBodies.push(fullBody);
      }
    }

    return NextResponse.json({
      thread: {
        id: thread.id,
        primaryCategory: thread.primaryCategory,
        categoryConfidence: thread.categoryConfidence,
        categoryManuallySet: thread.categoryManuallySet,
        labels: thread.labels,
        archivedAt: thread.archivedAt?.toISOString() ?? null,
        snoozedUntil: thread.snoozedUntil?.toISOString() ?? null,
        aiSummary: thread.aiSummary,
        subject: thread.subject,
        participants: thread.participants,
        messageCount: thread.messageCount,
        unreadCount: thread.unreadCount,
        opportunityId: thread.opportunityId,
        clientId: thread.clientId,
      },
      messages,
    });
  } catch (err) {
    console.error("[/api/inbox/threads/:id] GET failed:", err);
    return NextResponse.json(
      { error: `Failed to load thread: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

// ─── PATCH: action handler ──────────────────────────────────────────────────

type ThreadAction =
  | { action: "archive" }
  | { action: "unarchive" }
  | { action: "snooze"; until: string }
  | { action: "unsnooze" }
  | { action: "recategorize"; toCategory: EmailThreadCategory; note?: string }
  | { action: "markRead"; isRead: boolean };

const ACTION_PERMISSIONS: Record<string, string> = {
  archive: "inbox.archive",
  unarchive: "inbox.archive",
  snooze: "inbox.snooze",
  unsnooze: "inbox.snooze",
  recategorize: "inbox.categorize",
  markRead: "inbox.view",
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as ThreadAction;

  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = user.id as string;
  const companyId = user.company_id as string;

  const requiredPerm = ACTION_PERMISSIONS[body.action];
  if (!requiredPerm) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const allowed = await checkPermissionById(userId, requiredPerm);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getServiceRoleClient();

  // Verify thread belongs to the user's company
  const thread = await runWithSupabase(supabase, () =>
    EmailThreadService.getThread(id, companyId)
  );
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  try {
    switch (body.action) {
      case "archive": {
        const result = await runWithSupabase(supabase, () =>
          EmailThreadService.archive({ threadId: id })
        );
        if ("needsPreference" in result) {
          return NextResponse.json({
            needsPreference: true,
            connectionId: result.connectionId,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "unarchive": {
        await runWithSupabase(supabase, () =>
          EmailThreadService.unarchive({ threadId: id })
        );
        return NextResponse.json({ ok: true });
      }

      case "snooze": {
        const until = new Date(body.until);
        if (isNaN(until.getTime()) || until.getTime() <= Date.now()) {
          return NextResponse.json(
            { error: "`until` must be a future ISO datetime" },
            { status: 400 }
          );
        }
        await runWithSupabase(supabase, () =>
          EmailThreadService.snooze({ threadId: id, until })
        );
        return NextResponse.json({ ok: true });
      }

      case "unsnooze": {
        await runWithSupabase(supabase, () =>
          EmailThreadService.unsnooze(id)
        );
        return NextResponse.json({ ok: true });
      }

      case "recategorize": {
        if (!body.toCategory || !CATEGORY_SET.has(body.toCategory)) {
          return NextResponse.json(
            { error: "Invalid toCategory" },
            { status: 400 }
          );
        }
        const { correctionId } = await runWithSupabase(supabase, () =>
          EmailThreadService.recategorize({
            threadId: id,
            userId,
            toCategory: body.toCategory,
            note: body.note,
          })
        );

        // Learning fan-out — never block the user response. after() schedules
        // this outside the route lifecycle so the 200 comes back immediately.
        after(async () => {
          try {
            await runWithSupabase(supabase, () =>
              PhaseCLearningService.applyCorrectionToSimilar(correctionId)
            );
          } catch (err) {
            console.error(
              "[/api/inbox/threads/:id] apply-correction-to-similar failed:",
              err
            );
          }
        });

        return NextResponse.json({ ok: true, correctionId });
      }

      case "markRead": {
        await runWithSupabase(supabase, () =>
          EmailThreadService.markRead(id, Boolean(body.isRead))
        );
        return NextResponse.json({ ok: true });
      }

      default: {
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      }
    }
  } catch (err) {
    console.error("[/api/inbox/threads/:id] PATCH failed:", err);
    return NextResponse.json(
      { error: `Action failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

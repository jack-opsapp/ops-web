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
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { EmailService } from "@/lib/api/services/email-service";
import { PhaseCLearningService } from "@/lib/api/services/phase-c-learning-service";
import {
  extractContactFormSubmissionDisplayText,
  extractEmailAddress,
  stripQuotedContent,
  stripPriorMessageOverlap,
} from "@/lib/utils/email-parsing";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { after } from "next/server";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import {
  resolveEmailInboxListAccess,
  resolveEmailOpportunityAccess,
} from "@/lib/email/email-opportunity-access";

const CATEGORY_SET = new Set<string>(EMAIL_THREAD_CATEGORIES);

// ─── GET: thread detail ─────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const supabase = getServiceRoleClient();
  const access = await resolveEmailOpportunityAccess({
    actor,
    operation: "read",
    threadId: id,
    supabase,
  });
  if (!access.allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const listAccess = await resolveEmailInboxListAccess({ actor, supabase });
  if (!listAccess.allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const thread = await runWithSupabase(supabase, () =>
      EmailThreadService.getThread(id, actor.companyId)
    );
    if (!thread)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (
      thread.id !== access.threadId ||
      thread.connectionId !== access.connectionId ||
      thread.providerThreadId !== access.providerThreadId ||
      thread.opportunityId !== access.opportunityId
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch messages from provider for the full body. Fall back to activities.
    const { data: connRow } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", access.connectionId)
      .eq("company_id", actor.companyId)
      .single();

    // Owning mailbox address. We use this (not the stored per-row `direction`
    // column, which is unreliable for imported data) to decide inbound vs
    // outbound on every message. Whatever produces the UI alignment — left
    // vs right, gray vs accent — must trace to this comparison and nothing
    // else.
    const connectionEmail = connRow
      ? extractEmailAddress((connRow.email as string) ?? "").toLowerCase()
      : "";

    const deriveDirection = (
      fromField: string | null | undefined
    ): "inbound" | "outbound" => {
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
          userId:
            connRow.type === "individual"
              ? ((connRow.user_id as string) ?? null)
              : null,
          email: connRow.email as string,
          accessToken: connRow.access_token as string,
          refreshToken: connRow.refresh_token as string,
          expiresAt: new Date(connRow.expires_at as string),
          historyId: (connRow.history_id as string) ?? null,
          syncEnabled: (connRow.sync_enabled as boolean) ?? true,
          lastSyncedAt: connRow.last_synced_at
            ? new Date(connRow.last_synced_at as string)
            : null,
          syncIntervalMinutes: (connRow.sync_interval_minutes as number) ?? 60,
          syncFilters: connRow.sync_filters ?? {},
          webhookSubscriptionId:
            (connRow.webhook_subscription_id as string) ?? null,
          webhookExpiresAt: connRow.webhook_expires_at
            ? new Date(connRow.webhook_expires_at as string)
            : null,
          opsLabelId: (connRow.ops_label_id as string) ?? null,
          aiReviewEnabled: (connRow.ai_review_enabled as boolean) ?? false,
          aiMemoryEnabled: (connRow.ai_memory_enabled as boolean) ?? false,
          status: (connRow.status as string) ?? "active",
          createdAt: new Date(connRow.created_at as string),
          updatedAt: new Date(connRow.updated_at as string),
        } as Parameters<typeof EmailService.getProvider>[0];

        const provider = EmailService.getProvider(connection);
        const providerMsgs = await provider.fetchThread(
          thread.providerThreadId
        );
        messages = providerMsgs.map((m) => {
          const rawBody = m.bodyText ?? "";
          // 3-layer clean-body cascade (see email-parsing.ts header):
          //   1. provider-native (M365 uniqueBody, Gmail HTML-first) → bodyTextClean
          //   2. plain-text regex stripping via stripQuotedContent
          //   3. cross-message overlap — applied below once all messages are in hand.
          const providerClean = m.bodyTextClean?.trim();
          const contactFormClean = extractContactFormSubmissionDisplayText(
            m.subject,
            rawBody
          );
          const initialClean =
            contactFormClean ??
            (providerClean && providerClean.length > 0
              ? providerClean
              : stripQuotedContent(rawBody, m.subject));
          return {
            id: m.id,
            providerMessageId: m.id,
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
        console.error(
          "[/api/inbox/threads/:id] provider.fetchThread failed:",
          err
        );
        // Fall through to activities fallback
      }
    }

    if (messages.length === 0) {
      const { data: activityRows } = await supabase
        .from("activities")
        .select(
          "id, email_message_id, from_email, to_emails, cc_emails, subject, content, body_text, direction, is_read, has_attachments, created_at"
        )
        .eq("company_id", thread.companyId)
        .eq("email_connection_id", thread.connectionId)
        .eq("type", "email")
        .eq("email_thread_id", thread.providerThreadId)
        .order("created_at", { ascending: true });

      messages = (activityRows ?? []).map((r) => {
        const rawBody = (r.body_text as string) ?? (r.content as string) ?? "";
        // Activities fallback has no provider-clean body stored — regex layer
        // only. Cross-message pass still runs below to catch cases where the
        // regex missed.
        const cleanBody = stripQuotedContent(
          rawBody,
          (r.subject as string) ?? ""
        );
        return {
          id: r.id,
          providerMessageId: (r.email_message_id as string | null) ?? null,
          from: r.from_email,
          fromName: null,
          to: r.to_emails ?? [],
          cc: r.cc_emails ?? [],
          subject: r.subject ?? "",
          snippet: (r.content as string) ?? "",
          bodyText: rawBody,
          cleanBodyText: cleanBody,
          direction: deriveDirection(r.from_email as string | null),
          date: r.created_at as string,
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

    // The linked lead is loaded by the canonical relationship resolved above,
    // never by a client-supplied opportunity/client id. Assigned-scope users
    // receive this one lead; client-wide rail queries remain reserved for
    // pipeline.view:all.
    let linkedOpportunity: {
      id: string;
      title: string;
      description: string | null;
      stage: string;
      estimatedValue: number | null;
      priority: string | null;
      source: string | null;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      address: string | null;
    } | null = null;
    let canonicalClientId: string | null = null;
    if (access.opportunityId) {
      const { data: opportunityRow, error: opportunityError } = await supabase
        .from("opportunities")
        .select(
          "id, client_id, title, description, stage, estimated_value, priority, source, contact_name, contact_email, contact_phone, address"
        )
        .eq("id", access.opportunityId)
        .eq("company_id", actor.companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (opportunityError) {
        throw new Error(
          `Linked opportunity lookup failed: ${opportunityError.message}`
        );
      }
      if (!opportunityRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      canonicalClientId = (opportunityRow.client_id as string | null) ?? null;
      linkedOpportunity = {
        id: opportunityRow.id as string,
        title: (opportunityRow.title as string) ?? "",
        description: (opportunityRow.description as string | null) ?? null,
        stage: (opportunityRow.stage as string) ?? "new_lead",
        estimatedValue:
          opportunityRow.estimated_value == null
            ? null
            : Number(opportunityRow.estimated_value),
        priority: (opportunityRow.priority as string | null) ?? null,
        source: (opportunityRow.source as string | null) ?? null,
        contactName: (opportunityRow.contact_name as string | null) ?? null,
        contactEmail: (opportunityRow.contact_email as string | null) ?? null,
        contactPhone: (opportunityRow.contact_phone as string | null) ?? null,
        address: (opportunityRow.address as string | null) ?? null,
      };
    }

    // ─── Client name + siblings ──────────────────────────────────────────
    //
    // Resolve client name once (the detail view's header uses it in the
    // "other threads with …" strip label), and pull up to 5 sibling threads
    // tied to the same client. Both queries are cheap and gated on clientId
    // being present — no wasted round-trips for unmatched threads.
    //
    // Siblings are served here rather than via a separate endpoint because
    // they're coupled to the detail view's render cycle — one round-trip
    // keeps the strip flash-free (appears with the rest of the header).
    const contactName = linkedOpportunity?.contactName?.trim() ?? "";
    const clientName = contactName.length > 0 ? contactName : null;
    let clientContext: {
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
    } | null = null;
    if (linkedOpportunity && clientName) {
      clientContext = {
        name: clientName,
        email: linkedOpportunity.contactEmail,
        phone: linkedOpportunity.contactPhone,
        address: linkedOpportunity.address,
      };
    }
    let siblingThreads: Array<{
      id: string;
      connectionId: string;
      providerThreadId: string;
      subject: string;
      primaryCategory: typeof thread.primaryCategory;
      lastMessageAt: string;
      messageCount: number;
      unreadCount: number;
      latestSenderName: string | null;
      latestSenderEmail: string | null;
      latestSnippet: string | null;
      archivedAt: string | null;
      snoozedUntil: string | null;
    }> = [];

    if (canonicalClientId) {
      const siblings = await runWithSupabase(supabase, () =>
        EmailThreadService.listSiblings(
          thread.companyId,
          canonicalClientId,
          thread.id,
          listAccess,
          5
        )
      );

      const authorizedSiblings = await Promise.all(
        siblings.map(async (s) => ({
          sibling: s,
          access: await resolveEmailOpportunityAccess({
            actor,
            operation: "read",
            threadId: s.id,
            supabase,
          }),
        }))
      );
      siblingThreads = authorizedSiblings
        .filter((entry) => entry.access.allowed)
        .map(({ sibling: s }) => ({
          id: s.id,
          connectionId: s.connectionId,
          providerThreadId: s.providerThreadId,
          subject: s.subject,
          primaryCategory: s.primaryCategory,
          lastMessageAt: s.lastMessageAt.toISOString(),
          messageCount: s.messageCount,
          unreadCount: s.unreadCount,
          latestSenderName: s.latestSenderName,
          latestSenderEmail: s.latestSenderEmail,
          latestSnippet: s.latestSnippet,
          archivedAt: s.archivedAt?.toISOString() ?? null,
          snoozedUntil: s.snoozedUntil?.toISOString() ?? null,
        }));
    }

    // ─── Commitments (unresolved, for this thread) ──────────────────────
    //
    // Returned in ascending due-date order so the detail pill renders the
    // most urgent first. Only unresolved rows — resolved commitments fall
    // off the pill automatically once the Resolve action lands.
    const { data: commitmentRows } = await supabase
      .from("agent_memories")
      .select("id, content, due_date, resolved_at, confidence, created_at")
      .eq("company_id", thread.companyId)
      .eq("source_id", thread.id)
      .eq("category", "commitment")
      .is("resolved_at", null)
      .order("due_date", { ascending: true, nullsFirst: false });

    const commitments = (commitmentRows ?? []).map((r) => ({
      id: r.id as string,
      content: (r.content as string) ?? "",
      dueDate: (r.due_date as string | null) ?? null,
      confidence: Number(r.confidence ?? 0.8),
      createdAt: (r.created_at as string) ?? null,
    }));

    return NextResponse.json({
      thread: {
        id: thread.id,
        connectionId: access.connectionId,
        providerThreadId: access.providerThreadId ?? thread.providerThreadId,
        pipelineScope: access.pipelineScope,
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
        opportunityId: access.opportunityId,
        clientId: canonicalClientId,
        clientName,
        latestDirection: thread.latestDirection,
        phaseC: thread.phaseC,
        agentBlockingQuestion: thread.agentBlockingQuestion,
        routing: thread.routing,
        routingReasons: thread.routingReasons,
        routerConfidence: thread.routerConfidence,
      },
      linkedOpportunity,
      clientContext,
      messages,
      siblingThreads,
      commitments,
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
  | { action: "markRead"; isRead: boolean }
  | { action: "dismissAwaitingReply" }
  | { action: "restoreAwaitingReply" };

const ACTION_PERMISSIONS: Record<string, string> = {
  archive: "inbox.archive",
  unarchive: "inbox.archive",
  snooze: "inbox.snooze",
  unsnooze: "inbox.snooze",
  recategorize: "inbox.categorize",
  markRead: "inbox.view",
  // Operator-level triage action — anyone who can see the inbox can mark a
  // thread as "no reply needed" (or undo the dismiss). Mirrors snooze's
  // permission scope rather than recategorize, since it doesn't teach the
  // classifier.
  dismissAwaitingReply: "inbox.snooze",
  restoreAwaitingReply: "inbox.snooze",
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as ThreadAction;

  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const userId = actor.userId;
  const companyId = actor.companyId;

  const requiredPerm = ACTION_PERMISSIONS[body.action];
  if (!requiredPerm) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const supabase = getServiceRoleClient();
  const accessOperation =
    body.action === "archive" || body.action === "unarchive"
      ? "mutate"
      : "read";
  const access = await resolveEmailOpportunityAccess({
    actor,
    operation: accessOperation,
    threadId: id,
    supabase,
  });
  if (!access.allowed) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const allowed = await checkPermissionById(userId, requiredPerm);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
        if ("needsConfirmation" in result) {
          return NextResponse.json({
            needsConfirmation: true,
            connectionId: result.connectionId,
            leadPreference: result.leadPreference,
            linkedOpportunity: result.linkedOpportunity,
            siblingThreads: result.siblingThreads,
          });
        }
        return NextResponse.json({
          ok: true,
          leadArchivedOpportunityId: result.leadArchivedOpportunityId,
        });
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
        await runWithSupabase(supabase, () => EmailThreadService.unsnooze(id));
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
              PhaseCLearningService.applyCorrectionToSimilar({
                correctionId,
                actorUserId: userId,
              })
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

      case "dismissAwaitingReply": {
        const labels = await runWithSupabase(supabase, () =>
          EmailThreadService.dismissAwaitingReply(id, companyId)
        );
        return NextResponse.json({ ok: true, labels });
      }

      case "restoreAwaitingReply": {
        const labels = await runWithSupabase(supabase, () =>
          EmailThreadService.restoreAwaitingReply(id, companyId)
        );
        return NextResponse.json({ ok: true, labels });
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

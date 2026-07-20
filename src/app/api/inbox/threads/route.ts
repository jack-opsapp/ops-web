/**
 * OPS Web - Inbox Threads List Endpoint
 *
 * GET /api/inbox/threads?scope=own|company&filter=...&category=...&search=...&cursor=...&limit=...
 *
 * Auth: Firebase/Supabase JWT required.
 * Permissions: canonical pipeline.view ∩ inbox.view authorization. Assigned
 * scope sees the actor's personal-mailbox threads plus threads linked to leads
 * currently assigned to that OPS user.
 *
 * Returns cursor-paginated list of email_threads rows, denormalized to the
 * inbox UI's consumer shape. scope=own filters to the calling user's email
 * connections; scope=company returns all threads for the company.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailInboxListAccess } from "@/lib/email/email-opportunity-access";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
  type InboxScope,
} from "@/lib/types/email-thread";
import { parseRailFilter } from "@/lib/inbox/rail-predicates";

const CATEGORY_SET = new Set<string>(EMAIL_THREAD_CATEGORIES);

// `parseRailFilter` accepts the canonical audience rails (CLIENTS /
// EVERYTHING_ELSE / ALL) plus utility ARCHIVED / SNOOZED, and degrades legacy
// reply-state bookmarks into broad list views. Unknown / missing API values
// fall through to ALL so direct endpoint calls never land on a narrow rail by
// accident; the UI applies the starred default before calling this route.
function parseFilter(raw: string | null) {
  return parseRailFilter(raw, "ALL");
}

function parseCategory(raw: string | null): EmailThreadCategory | undefined {
  if (raw && CATEGORY_SET.has(raw)) return raw as EmailThreadCategory;
  return undefined;
}

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

export async function GET(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const { userId, companyId } = actor;

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));
  const filter = parseFilter(searchParams.get("filter"));
  const category = parseCategory(searchParams.get("category"));
  const search = searchParams.get("search") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  const supabase = getServiceRoleClient();
  const listAccess = await resolveEmailInboxListAccess({ actor, supabase });
  if (!listAccess.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Assigned inbox scope is an opportunity union, not a mailbox subset. The
  // shared authorization filter still limits the query to assigned leads plus
  // unlinked actor-owned personal threads; applying the legacy `scope=own`
  // connection filter here would incorrectly hide linked history from another
  // mailbox.
  const effectiveScope: InboxScope =
    listAccess.inboxScope === "assigned" ? "company" : scope;

  // Resolve scope=own to every company mailbox plus only the actor's personal
  // mailboxes. A legacy connector user on a company row is metadata and must
  // not affect visibility in either direction.
  let userConnectionIds: string[] = [];
  if (effectiveScope === "own") {
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .or(`type.eq.company,and(type.eq.individual,user_id.eq.${userId})`);
    userConnectionIds = (connRows ?? []).map((r) => r.id as string);
  }

  try {
    const result = await runWithSupabase(supabase, () =>
      EmailThreadService.list(
        companyId,
        userConnectionIds,
        {
          scope: effectiveScope,
          filter,
          category,
          search,
          cursor: cursor ?? null,
          limit,
        },
        listAccess
      )
    );

    // Resolve client names for every linked thread in one IN-list query.
    // Cheap, and bounded by the page size. The UI prefers the client name
    // over the raw sender name when both are present (see conversation-list).
    const clientIds = Array.from(
      new Set(
        result.threads.map((t) => t.clientId).filter((v): v is string => !!v)
      )
    );
    const clientNameById = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: clientRows } = await supabase
        .from("clients")
        .select("id, name")
        .in("id", clientIds);
      for (const row of clientRows ?? []) {
        const name = (row.name as string | null)?.trim();
        if (name) clientNameById.set(row.id as string, name);
      }
    }

    return NextResponse.json({
      threads: result.threads.map((t) => ({
        id: t.id,
        connectionId: t.connectionId,
        providerThreadId: t.providerThreadId,
        primaryCategory: t.primaryCategory,
        categoryConfidence: t.categoryConfidence,
        categoryManuallySet: t.categoryManuallySet,
        labels: t.labels,
        archivedAt: t.archivedAt?.toISOString() ?? null,
        snoozedUntil: t.snoozedUntil?.toISOString() ?? null,
        priorityScore: t.priorityScore,
        aiSummary: t.aiSummary,
        subject: t.subject,
        participants: t.participants,
        firstMessageAt: t.firstMessageAt.toISOString(),
        lastMessageAt: t.lastMessageAt.toISOString(),
        messageCount: t.messageCount,
        unreadCount: t.unreadCount,
        latestDirection: t.latestDirection,
        latestSenderEmail: t.latestSenderEmail,
        latestSenderName: t.latestSenderName,
        latestSnippet: t.latestSnippet,
        opportunityId: t.opportunityId,
        opportunityNeedsReply: t.opportunityNeedsReply,
        clientId: t.clientId,
        clientName: t.clientId
          ? (clientNameById.get(t.clientId) ?? null)
          : null,
        nextCommitmentDueAt: t.nextCommitmentDueAt?.toISOString() ?? null,
        hasUnresolvedCommitments: t.hasUnresolvedCommitments,
        nextCommitmentId: t.nextCommitmentId,
        phaseC: t.phaseC,
        agentBlockingQuestion: t.agentBlockingQuestion,
        routing: t.routing,
        routingReasons: t.routingReasons,
        routerConfidence: t.routerConfidence,
      })),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    console.error("[/api/inbox/threads] list failed:", err);
    return NextResponse.json(
      { error: `Failed to list threads: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

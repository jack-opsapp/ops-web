/**
 * OPS Web - Inbox Threads List Endpoint
 *
 * GET /api/inbox/threads?scope=own|company&filter=...&category=...&search=...&cursor=...&limit=...
 *
 * Auth: Firebase/Supabase JWT required.
 * Permissions:
 *   - inbox.view                 : required for any access
 *   - inbox.view_company         : additionally required for scope=company
 *
 * Returns cursor-paginated list of email_threads rows, denormalized to the
 * inbox UI's consumer shape. scope=own filters to the calling user's email
 * connections; scope=company returns all threads for the company.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
  type InboxRail,
  type InboxScope,
} from "@/lib/types/email-thread";

const VALID_FILTERS = new Set<InboxRail>(["needs_reply", "everything", "scheduled", "done"]);
const CATEGORY_SET = new Set<string>(EMAIL_THREAD_CATEGORIES);

function parseFilter(raw: string | null): InboxRail {
  if (raw && VALID_FILTERS.has(raw as InboxRail)) return raw as InboxRail;
  return "everything";
}

function parseCategory(raw: string | null): EmailThreadCategory | undefined {
  if (raw && CATEGORY_SET.has(raw)) return raw as EmailThreadCategory;
  return undefined;
}

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

export async function GET(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = user.id as string;
  const companyId = user.company_id as string;

  if (!companyId) {
    return NextResponse.json({ error: "No company associated with user" }, { status: 400 });
  }

  // Base permission
  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));
  const filter = parseFilter(searchParams.get("filter"));
  const category = parseCategory(searchParams.get("category"));
  const search = searchParams.get("search") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  // Scope=company requires additional permission
  if (scope === "company") {
    const canViewCompany = await checkPermissionById(userId, "inbox.view_company");
    if (!canViewCompany) {
      return NextResponse.json({ error: "Forbidden (company scope)" }, { status: 403 });
    }
  }

  const supabase = getServiceRoleClient();

  // Resolve user's own connection IDs for scope=own. A user may have multiple
  // (personal + company). scope=company ignores this list and sees all.
  let userConnectionIds: string[] = [];
  if (scope === "own") {
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .or(`user_id.eq.${userId},user_id.is.null`);
    userConnectionIds = (connRows ?? []).map((r) => r.id as string);
  }

  try {
    const result = await runWithSupabase(supabase, () =>
      EmailThreadService.list(companyId, userConnectionIds, {
        scope,
        filter,
        category,
        search,
        cursor: cursor ?? null,
        limit,
      })
    );

    // Resolve client names for every linked thread in one IN-list query.
    // Cheap, and bounded by the page size. The UI prefers the client name
    // over the raw sender name when both are present (see conversation-list).
    const clientIds = Array.from(
      new Set(
        result.threads
          .map((t) => t.clientId)
          .filter((v): v is string => !!v)
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
        clientId: t.clientId,
        clientName: t.clientId ? clientNameById.get(t.clientId) ?? null : null,
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

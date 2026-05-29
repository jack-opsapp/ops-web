/**
 * OPS Web — Inbox Drafts
 *
 * GET    /api/inbox/drafts?scope=own|company
 * POST   /api/inbox/drafts                    — create-or-update a provider draft
 * DELETE /api/inbox/drafts?source=provider|ai&id=...&connectionId=...
 *
 * Merges two sources into one list:
 *   - `ai_draft_history` rows with status='drafted'  (OPS AI-generated drafts)
 *   - provider Drafts folder (Gmail `/drafts`, M365 Drafts mailFolder)
 *   - `opportunity_follow_up_drafts` rows with origin='template_follow_up'
 *     and status='drafted' (local lifecycle drafts, no provider draft)
 *
 * Dedupe rule: when both an AI draft and a provider draft reference the same
 * thread, the AI draft wins. Rationale: the user is almost certainly editing
 * an AI suggestion through OPS (which mirrors to the provider), and showing
 * two rows for "the same conversation" confuses the inbox. Pure provider
 * drafts (typed directly in Gmail/Outlook, no OPS AI) still surface.
 *
 * Auth:
 *   - inbox.view                       required for GET
 *   - inbox.view_company               required for scope=company
 *   - inbox.view for DELETE (user can always discard their own drafts)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailService } from "@/lib/api/services/email-service";
import type { NormalizedDraft } from "@/lib/api/services/email-provider";
import type {
  InboxDraftRow,
  InboxScope,
} from "@/lib/types/email-thread";
import { DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT } from "@/lib/email/opportunity-lifecycle-evaluator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function threadMapKey(connectionId: string | null, providerThreadId: string | null) {
  return `${connectionId ?? ""}:${providerThreadId ?? ""}`;
}

// ─── GET — list merged drafts ───────────────────────────────────────────────

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
    return NextResponse.json(
      { error: "No company associated with user" },
      { status: 400 }
    );
  }

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));

  if (scope === "company") {
    const canCompany = await checkPermissionById(userId, "inbox.view_company");
    if (!canCompany) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const supabase = getServiceRoleClient();

  // ── Collect the in-scope email connections ───────────────────────────────
  // scope=own filters to connections owned by the caller plus company-type
  // mailboxes they can see (matches the threads list scope semantics).
  const allConnections = await runWithSupabase(supabase, () =>
    EmailService.getConnections(companyId)
  );
  const connections = allConnections.filter((c) => {
    if (c.status !== "active") return false; // skip revoked / needs-reconnect
    if (scope === "company") return true;
    return c.type === "company" || c.userId === userId;
  });

  // ── Fetch provider drafts in parallel, per connection ────────────────────
  // Each mailbox is isolated: an expired token on one must not take down
  // the whole list. We swallow per-connection errors and log, same pattern
  // as the threads-list endpoint.
  const providerBatches = await Promise.all(
    connections.map(async (conn) => {
      try {
        const provider = EmailService.getProvider(conn);
        const drafts = await provider.listDrafts();
        return drafts.map<InboxDraftRow>((d: NormalizedDraft) => ({
          source: "provider",
          id: d.id,
          threadId: d.threadId,
          connectionId: conn.id,
          fromEmail: conn.email,
          to: d.to,
          cc: d.cc,
          subject: d.subject,
          bodyText: d.bodyText,
          updatedAt: d.updatedAt.toISOString(),
        }));
      } catch (err) {
        console.error(
          `[/api/inbox/drafts] listDrafts failed for connection ${conn.id}:`,
          err
        );
        return [] as InboxDraftRow[];
      }
    })
  );
  const providerDrafts = providerBatches.flat();

  // ── Fetch OPS AI drafts (status='drafted') ──────────────────────────────
  // Scope=own → only this user's drafts; scope=company → every user in the
  // company. Matches the "is this actionable for me right now" mental model.
  //
  // Migration 040 declared `updated_at` on ai_draft_history but production
  // only has `created_at` — the column was dropped (or the migration never
  // fully applied). We sort + project by created_at and surface it as
  // `updatedAt` on the wire; the row is effectively immutable after creation
  // anyway (edits produce a new row via the learning pipeline, not an
  // in-place update), so created_at is the authoritative "last touched" time.
  let aiQuery = supabase
    .from("ai_draft_history")
    .select(
      "id, user_id, connection_id, thread_id, opportunity_id, original_draft, final_version, created_at"
    )
    .eq("company_id", companyId)
    .eq("status", "drafted")
    .order("created_at", { ascending: false })
    .limit(200);

  if (scope === "own") {
    aiQuery = aiQuery.eq("user_id", userId);
  }

  const { data: aiRows, error: aiErr } = await aiQuery;
  if (aiErr) {
    console.error("[/api/inbox/drafts] ai_draft_history query failed:", aiErr);
  }

  // AI drafts don't store to/cc/subject — those live on the associated
  // thread. We leave them empty and let the UI derive from thread context
  // on click (Continue → compose modal). Body is final_version when the
  // user edited it, else the original AI suggestion.
  const aiDrafts: InboxDraftRow[] = (aiRows ?? []).map((r) => {
    const conn =
      connections.find((c) => c.id === (r.connection_id as string)) ?? null;
    return {
      source: "ai",
      id: r.id as string,
      threadId: (r.thread_id as string) || null,
      connectionId: (r.connection_id as string) || null,
      fromEmail: conn?.email ?? "",
      to: [],
      cc: [],
      subject: "",
      bodyText:
        ((r.final_version as string) || (r.original_draft as string) || "")
          .trim(),
      updatedAt: (r.created_at as string) ?? new Date().toISOString(),
    };
  });

  // ── Fetch local lifecycle drafts ────────────────────────────────────────
  // P5 lifecycle drafts deliberately stay local until an operator edits/sends
  // through the inbox. They must not create or update provider draft rows.
  const lifecycleQuery = supabase
    .from("opportunity_follow_up_drafts")
    .select(
      "id, opportunity_id, connection_id, provider_thread_id, subject, original_body, current_body, edited_at, updated_at, created_at"
    )
    .eq("company_id", companyId)
    .eq("origin", "template_follow_up")
    .eq("status", "drafted")
    .order("updated_at", { ascending: false })
    .limit(200);

  const { data: lifecycleRows, error: lifecycleErr } = await lifecycleQuery;
  if (lifecycleErr) {
    console.error(
      "[/api/inbox/drafts] opportunity_follow_up_drafts query failed:",
      lifecycleErr
    );
  }

  const connectionById = new Map(connections.map((conn) => [conn.id, conn]));
  const scopedLifecycleRows = (lifecycleRows ?? []).filter((row) => {
    const rowConnectionId = nonEmptyText(row.connection_id);
    return !rowConnectionId || connectionById.has(rowConnectionId);
  });
  const providerThreadIds = Array.from(
    new Set(
      scopedLifecycleRows
        .map((row) => nonEmptyText(row.provider_thread_id))
        .filter((value): value is string => value !== null)
    )
  );

  const threadByProvider = new Map<string, string>();
  if (providerThreadIds.length > 0) {
    const { data: threadRows, error: threadErr } = await supabase
      .from("email_threads")
      .select("id, connection_id, provider_thread_id")
      .eq("company_id", companyId)
      .in("provider_thread_id", providerThreadIds);
    if (threadErr) {
      console.error("[/api/inbox/drafts] email_threads query failed:", threadErr);
    } else {
      for (const row of threadRows ?? []) {
        const providerThreadId = nonEmptyText(row.provider_thread_id);
        const connectionId = nonEmptyText(row.connection_id);
        const id = nonEmptyText(row.id);
        if (providerThreadId && id) {
          threadByProvider.set(threadMapKey(connectionId, providerThreadId), id);
        }
      }
    }
  }

  const lifecycleDrafts: InboxDraftRow[] = scopedLifecycleRows.map((row) => {
    const connectionId = nonEmptyText(row.connection_id);
    const providerThreadId = nonEmptyText(row.provider_thread_id);
    const conn = connectionId ? connectionById.get(connectionId) : null;
    return {
      source: "lifecycle",
      id: row.id as string,
      threadId: providerThreadId,
      inboxThreadId:
        threadByProvider.get(threadMapKey(connectionId, providerThreadId)) ?? null,
      opportunityId: nonEmptyText(row.opportunity_id),
      connectionId,
      fromEmail: conn?.email ?? "",
      to: [],
      cc: [],
      subject: nonEmptyText(row.subject) ?? DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
      bodyText:
        nonEmptyText(row.current_body) ??
        nonEmptyText(row.original_body) ??
        "",
      updatedAt:
        nonEmptyText(row.edited_at) ??
        nonEmptyText(row.updated_at) ??
        nonEmptyText(row.created_at) ??
        new Date().toISOString(),
    };
  });

  // ── Merge + dedupe ───────────────────────────────────────────────────────
  // Dedupe by threadId: for each thread with competing AI + provider drafts,
  // render whichever was edited most recently. Previously AI unconditionally
  // won, which hid the user's direct edits in Gmail/Outlook. The losing row
  // stays in the DB (the AI learning pipeline still reads discarded + stale
  // AI drafts) — we just don't render it. Standalones (threadId=null) are
  // always kept, on both sides.
  const aiByThread = new Map<string, InboxDraftRow>();
  for (const d of aiDrafts) {
    if (d.threadId) aiByThread.set(d.threadId, d);
  }
  const providerByThread = new Map<string, InboxDraftRow>();
  for (const d of providerDrafts) {
    if (d.threadId) providerByThread.set(d.threadId, d);
  }
  const contestedThreads = new Set<string>([
    ...aiByThread.keys(),
    ...providerByThread.keys(),
  ]);

  const kept: InboxDraftRow[] = [];
  // Standalones — always keep.
  for (const d of aiDrafts) if (!d.threadId) kept.push(d);
  for (const d of providerDrafts) if (!d.threadId) kept.push(d);
  // Lifecycle drafts are local operator work and must not be hidden by
  // provider/Phase C dedupe. They are independently editable/discardable.
  for (const d of lifecycleDrafts) kept.push(d);
  // Per-thread: newer updatedAt wins. If only one side has a row, it wins
  // trivially.
  for (const tid of contestedThreads) {
    const ai = aiByThread.get(tid);
    const prov = providerByThread.get(tid);
    if (ai && prov) {
      const aiTs = new Date(ai.updatedAt).getTime();
      const provTs = new Date(prov.updatedAt).getTime();
      kept.push(provTs > aiTs ? prov : ai);
    } else if (ai) {
      kept.push(ai);
    } else if (prov) {
      kept.push(prov);
    }
  }

  // Sort newest-first by updatedAt.
  kept.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return NextResponse.json({ drafts: kept });
}

// ─── POST — create or update a provider draft ───────────────────────────────
//
// Body shape:
//   {
//     connectionId: string,    // mailbox the draft should land in
//     to: string,              // recipient (bare addr or RFC 5322 mailbox)
//     subject: string,
//     body: string,
//     providerThreadId?: string, // pin reply-drafts to a conversation
//     draftId?: string,        // present → updateDraft; absent → createDraft
//   }
//
// Returns: { ok: true, draftId, source: "provider" } — caller stores the
// draftId locally so subsequent saves PATCH the same row instead of creating
// duplicates.
//
// Permission gate: `inbox.view` (anyone who can see the inbox can stash a
// draft into their own provider). The connection's company_id is verified
// against the caller's company.

interface SaveDraftBody {
  source?: "provider" | "lifecycle";
  connectionId?: string;
  to?: string;
  subject?: string;
  body?: string;
  providerThreadId?: string | null;
  draftId?: string | null;
}

export async function POST(request: NextRequest) {
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

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as SaveDraftBody | null;
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connectionId, to, subject, body, providerThreadId, draftId, source } =
    payload;

  if (source === "lifecycle") {
    if (!draftId || typeof draftId !== "string") {
      return NextResponse.json(
        { error: "draftId is required for lifecycle drafts" },
        { status: 400 }
      );
    }
    if (typeof body !== "string") {
      return NextResponse.json(
        { error: "body is required for lifecycle drafts" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const { data: existing, error: existingErr } = await supabase
      .from("opportunity_follow_up_drafts")
      .select("id")
      .eq("id", draftId)
      .eq("company_id", companyId)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted")
      .single();
    if (existingErr || !existing) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("opportunity_follow_up_drafts")
      .update({
        subject: nonEmptyText(subject) ?? DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
        current_body: body,
        edited_by: userId,
        edited_at: now,
        updated_at: now,
      })
      .eq("id", draftId)
      .eq("company_id", companyId)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted");

    if (error) {
      console.error("[/api/inbox/drafts] lifecycle save failed:", error);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      draftId,
      source: "lifecycle" as const,
    });
  }

  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }
  if (typeof to !== "string" || typeof subject !== "string" || typeof body !== "string") {
    return NextResponse.json(
      { error: "to, subject, and body are required strings" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const conn = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (conn.companyId !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const provider = EmailService.getProvider(conn);
    if (draftId) {
      await provider.updateDraft(
        draftId,
        to,
        subject,
        body,
        providerThreadId ?? undefined,
      );
      return NextResponse.json({
        ok: true,
        draftId,
        source: "provider" as const,
      });
    }
    const newId = await provider.createDraft(
      to,
      subject,
      body,
      providerThreadId ?? undefined,
    );
    return NextResponse.json({
      ok: true,
      draftId: newId,
      source: "provider" as const,
    });
  } catch (err) {
    console.error("[/api/inbox/drafts] save failed:", err);
    return NextResponse.json(
      { error: `Save failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

// ─── DELETE — discard a draft ────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
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

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const id = searchParams.get("id");
  const connectionId = searchParams.get("connectionId");

  if (!id || (source !== "provider" && source !== "ai" && source !== "lifecycle")) {
    return NextResponse.json(
      { error: "Missing or invalid source/id" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  if (source === "lifecycle") {
    const { data: row, error } = await supabase
      .from("opportunity_follow_up_drafts")
      .select("id, company_id")
      .eq("id", id)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted")
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (row.company_id !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("opportunity_follow_up_drafts")
      .update({
        status: "discarded",
        discarded_at: now,
        edited_by: userId,
        edited_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted");
    if (updErr) {
      console.error("[/api/inbox/drafts] lifecycle discard failed:", updErr);
      return NextResponse.json(
        { error: "Discard failed" },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (source === "ai") {
    // Scope check — the row must belong to the caller's company.
    const { data: row, error } = await supabase
      .from("ai_draft_history")
      .select("id, company_id")
      .eq("id", id)
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (row.company_id !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // `updated_at` column doesn't exist on this table (see GET path note)
    // so we only flip `status`. The discard timestamp isn't critical —
    // downstream learning reads status + created_at only.
    const { error: updErr } = await supabase
      .from("ai_draft_history")
      .update({ status: "discarded" })
      .eq("id", id);
    if (updErr) {
      console.error("[/api/inbox/drafts] ai discard failed:", updErr);
      return NextResponse.json(
        { error: "Discard failed" },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // source === "provider": need the connection to route to the right provider.
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId required for provider drafts" },
      { status: 400 }
    );
  }

  const conn = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (conn.companyId !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const provider = EmailService.getProvider(conn);
    await provider.deleteDraft(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/inbox/drafts] provider discard failed:", err);
    return NextResponse.json(
      { error: `Discard failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

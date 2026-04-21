/**
 * OPS Web — Inbox Drafts
 *
 * GET    /api/inbox/drafts?scope=own|company
 * DELETE /api/inbox/drafts?source=provider|ai&id=...&connectionId=...
 *
 * Merges two sources into one list:
 *   - `ai_draft_history` rows with status='drafted'  (OPS AI-generated drafts)
 *   - provider Drafts folder (Gmail `/drafts`, M365 Drafts mailFolder)
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
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
  let aiQuery = supabase
    .from("ai_draft_history")
    .select(
      "id, user_id, connection_id, thread_id, opportunity_id, original_draft, final_version, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .eq("status", "drafted")
    .order("updated_at", { ascending: false })
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
      updatedAt:
        (r.updated_at as string) ?? (r.created_at as string) ?? new Date().toISOString(),
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

  if (!id || (source !== "provider" && source !== "ai")) {
    return NextResponse.json(
      { error: "Missing or invalid source/id" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

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

    const { error: updErr } = await supabase
      .from("ai_draft_history")
      .update({ status: "discarded", updated_at: new Date().toISOString() })
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

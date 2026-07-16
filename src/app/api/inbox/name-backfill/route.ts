/**
 * OPS Web — Sender-Name Backfill
 *
 * POST /api/inbox/name-backfill
 *
 * Walks every thread in the caller's company and updates
 * `latest_sender_name` where the current value is broken and the directory
 * (clients / sub_clients / users) has a canonical name for the sender.
 *
 * "Broken" =
 *   - null / empty
 *   - equals the email local-part (`canprojack` for canprojack@gmail.com)
 *   - contains '@' (bare email address)
 *   - matches a generic mailbox token (sales, info, support, team, …)
 *
 * Legit-looking multi-word display names are preserved — the user's mail
 * client may have set a display preference we shouldn't overwrite unless
 * we have a canonical contact name that clearly outranks it. Future work
 * could add a "always prefer directory" toggle; this pass is conservative.
 *
 * Bounded per-invocation: default 500 rows per HTTP call, max 2000. A
 * single company with huge history would call this repeatedly until
 * `remaining === 0`.
 *
 * Idempotent: rows that already have a canonical name or have no directory
 * match are updated exactly once per invocation (the UPDATE is a no-op on
 * subsequent passes).
 *
 * Auth: `inbox.categorize` — same bar as the reclassifier.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";

// Keep in sync with GENERIC_MAILBOX_TOKENS in email-thread-service.ts.
// Duplicated intentionally — one file does live-sync writes, this one
// runs a backfill; coupling them via an import would drag service-layer
// code into an edge-ish route. If the list diverges by more than two
// tokens, lift it into a shared constants module.
const GENERIC_MAILBOX_TOKENS = new Set([
  "team", "info", "accounts", "accounting", "sales", "support", "billing",
  "help", "hello", "contact", "noreply", "no-reply", "admin", "office",
  "mailbox", "inbox", "notifications", "updates", "news", "marketing",
  "service", "services", "enquiries", "inquiries",
]);

function isBrokenName(
  currentName: string | null,
  senderEmail: string | null
): boolean {
  if (!currentName) return true;
  const trimmed = currentName.trim();
  if (!trimmed) return true;
  if (trimmed.includes("@")) return true;
  if (senderEmail) {
    const localPart = senderEmail.split("@")[0];
    if (localPart && trimmed.toLowerCase() === localPart.toLowerCase()) {
      return true;
    }
  }
  const tokens = trimmed.toLowerCase().split(/[\s_\-/.]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  // Treat as broken when ANY token is a generic mailbox label. "eDocs at
  // Vitrum - no reply" has "no-reply" → broken. "Cecilia Reyes" has no
  // generic tokens → ok.
  return tokens.some((t) => GENERIC_MAILBOX_TOKENS.has(t));
}

interface NameBackfillResult {
  scanned: number;
  updated: number;
  skippedNoMatch: number;
  skippedOkName: number;
  remaining: number | null;
}

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  const access = await resolveEmailConnectionOperationAccess({
    request,
    supabase,
  });
  if (!access.allowed) {
    return NextResponse.json(
      {
        error: access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
      },
      { status: access.status }
    );
  }
  const { userId, companyId } = access.actor;
  const canCategorize = await checkPermissionById(
    userId,
    "inbox.categorize",
    "all"
  );
  if (!canCategorize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") ?? "500", 10) || 500, 1),
    2000
  );

  // ── Page 1: fetch candidate threads ──────────────────────────────────────
  // We don't restrict to "broken" at the SQL layer because the
  // generic-mailbox heuristic is easier to run in JS. Net cost is small —
  // we only update rows whose current name is genuinely broken AND has a
  // directory match.
  const { data: threadRows, error: threadErr } = await supabase
    .from("email_threads")
    .select("id, latest_sender_name, latest_sender_email")
    .eq("company_id", companyId)
    .in("connection_id", access.connectionIds)
    .not("latest_sender_email", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (threadErr) {
    return NextResponse.json(
      { error: `Thread query failed: ${threadErr.message}` },
      { status: 500 }
    );
  }

  const threads = threadRows ?? [];

  // Pre-filter down to rows worth touching. Saves a directory scan for
  // every row that already has a human-looking name.
  const brokenRows = threads.filter((t) =>
    isBrokenName(
      (t.latest_sender_name as string | null) ?? null,
      (t.latest_sender_email as string | null) ?? null
    )
  );

  const result: NameBackfillResult = {
    scanned: threads.length,
    updated: 0,
    skippedNoMatch: 0,
    skippedOkName: threads.length - brokenRows.length,
    remaining: null,
  };

  if (brokenRows.length === 0) {
    return NextResponse.json(result);
  }

  // ── Directory lookup ─────────────────────────────────────────────────────
  // Collect every unique sender email from the broken set, then pull all
  // matching rows in ONE query per table (IN-list). Avoids N+1 across
  // hundreds of rows.
  const uniqueEmails = Array.from(
    new Set(
      brokenRows
        .map((r) => (r.latest_sender_email as string | null)?.toLowerCase() ?? "")
        .filter(Boolean)
    )
  );

  const [clientRows, subClientRows, userRows] = await Promise.all([
    supabase
      .from("clients")
      .select("email, name")
      .eq("company_id", companyId)
      .in("email", uniqueEmails),
    supabase
      .from("sub_clients")
      .select("email, name")
      .eq("company_id", companyId)
      .in("email", uniqueEmails),
    supabase
      .from("users")
      .select("email, first_name, last_name")
      .eq("company_id", companyId)
      .in("email", uniqueEmails),
  ]);

  // Build a lookup map — clients win over sub_clients win over users
  // (priority order consistent with the live-sync resolver).
  const lookup = new Map<string, string>();
  for (const row of userRows.data ?? []) {
    const key = (row.email as string).toLowerCase();
    const fn = (row.first_name as string | null) ?? "";
    const ln = (row.last_name as string | null) ?? "";
    const name = `${fn} ${ln}`.trim();
    if (name) lookup.set(key, name);
  }
  for (const row of subClientRows.data ?? []) {
    const key = (row.email as string).toLowerCase();
    const name = ((row.name as string | null) ?? "").trim();
    if (name) lookup.set(key, name);
  }
  for (const row of clientRows.data ?? []) {
    const key = (row.email as string).toLowerCase();
    const name = ((row.name as string | null) ?? "").trim();
    if (name) lookup.set(key, name);
  }

  // ── Update matched rows ──────────────────────────────────────────────────
  // One UPDATE per row — this is an admin-initiated backfill, not a hot
  // path. Batching would save a few roundtrips but complicate error
  // attribution ("which ids failed in the batch?").
  for (const t of brokenRows) {
    const emailLc =
      ((t.latest_sender_email as string | null) ?? "").toLowerCase();
    const canonical = lookup.get(emailLc);
    if (!canonical) {
      result.skippedNoMatch++;
      continue;
    }
    const { error: updErr } = await supabase
      .from("email_threads")
      .update({ latest_sender_name: canonical })
      .eq("id", t.id as string);
    if (!updErr) {
      result.updated++;
    } else {
      console.error(
        "[/api/inbox/name-backfill] update failed for",
        t.id,
        updErr.message
      );
    }
  }

  // ── Remaining estimate ───────────────────────────────────────────────────
  // Reports total threads for the company — caller loops while
  // `updated > 0` to exhaust the backlog. We don't try to SQL-compute an
  // exact "still broken" count because the heuristic is JS-side.
  const { count } = await supabase
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("connection_id", access.connectionIds);
  result.remaining = count ?? null;

  return NextResponse.json(result);
}

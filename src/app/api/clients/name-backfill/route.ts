/**
 * OPS Web — Client-Name Backfill
 *
 * POST /api/clients/name-backfill[?limit=500][&execute=true]
 *
 * Repairs clients that are still carrying a machine-minted name from before
 * the auto-create guard landed — the email handle ("canprojack"), a bare
 * address, a generic mailbox label, or the "New Lead" placeholder.
 *
 * DRY RUN BY DEFAULT. Without `execute=true` nothing is written; the response
 * is the plan the run would have applied, so an operator can read it first.
 *
 * Replacement names come only from evidence the pipeline already stored for
 * that client — an opportunity's extracted contact name, a sub-contact's
 * name, or a linked thread's resolved sender name, in that order. A candidate
 * that is itself a placeholder is never adopted.
 *
 * Refuses any client whose `contact_name` provenance is operator-sourced or
 * operator-confirmed. Records provenance for every rename it performs.
 *
 * Bounded per invocation: default 500 clients per call, max 2000. Call
 * repeatedly until `eligible` reaches 0.
 *
 * Idempotent: a rename whose candidate already equals the stored name is not
 * a rename, so a second pass over the same page writes nothing.
 *
 * Auth: `inbox.categorize` — same bar as the inbox sender-name backfill.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  planClientNameBackfill,
  type ClientNameCandidate,
} from "@/lib/clients/name-backfill";
import { writeFieldProvenance } from "@/lib/email/lead-enrichment";

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserByAuth(auth.uid, auth.email);
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
  const execute = searchParams.get("execute") === "true";

  const supabase = getServiceRoleClient();

  // ── Candidate clients ────────────────────────────────────────────────────
  // The placeholder heuristic runs in JS (it compares the name against the
  // mailbox local part), so the SQL layer only bounds the page.
  const { data: clientRows, error: clientError } = await supabase
    .from("clients")
    .select("id, name, email")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (clientError) {
    return NextResponse.json(
      { error: `Client query failed: ${clientError.message}` },
      { status: 500 }
    );
  }
  const clients = (clientRows ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
  }));
  if (clients.length === 0) {
    return NextResponse.json({
      dryRun: !execute,
      checked: 0,
      eligible: 0,
      renamed: 0,
      refused: [],
      plan: [],
    });
  }

  const clientIds = clients.map((c) => c.id);

  // ── Stored evidence + provenance, one query per source ───────────────────
  const [opportunityRes, subClientRes, threadRes, provenanceRes] =
    await Promise.all([
      supabase
        .from("opportunities")
        .select("client_id, contact_name")
        .eq("company_id", companyId)
        .in("client_id", clientIds)
        .not("contact_name", "is", null),
      supabase
        .from("sub_clients")
        .select("client_id, name")
        .eq("company_id", companyId)
        .in("client_id", clientIds)
        .is("deleted_at", null),
      supabase
        .from("email_threads")
        .select("client_id, latest_sender_name")
        .eq("company_id", companyId)
        .in("client_id", clientIds)
        .not("latest_sender_name", "is", null)
        .order("last_message_at", { ascending: false }),
      supabase
        .from("lead_field_provenance")
        .select("entity_id, source, confirmed_at")
        .eq("company_id", companyId)
        .eq("entity_type", "client")
        .eq("field_name", "contact_name")
        .in("entity_id", clientIds),
    ]);

  const readFailure =
    opportunityRes.error ??
    subClientRes.error ??
    threadRes.error ??
    provenanceRes.error;
  if (readFailure) {
    return NextResponse.json(
      { error: `Evidence query failed: ${readFailure.message}` },
      { status: 500 }
    );
  }

  const candidates: ClientNameCandidate[] = [
    ...(opportunityRes.data ?? []).map((row) => ({
      clientId: row.client_id as string,
      name: (row.contact_name as string | null) ?? null,
      origin: "opportunity" as const,
    })),
    ...(subClientRes.data ?? []).map((row) => ({
      clientId: row.client_id as string,
      name: (row.name as string | null) ?? null,
      origin: "sub_client" as const,
    })),
    ...(threadRes.data ?? []).map((row) => ({
      clientId: row.client_id as string,
      name: (row.latest_sender_name as string | null) ?? null,
      origin: "thread" as const,
    })),
  ];

  const plan = planClientNameBackfill({
    clients,
    candidates,
    provenance: (provenanceRes.data ?? []).map((row) => ({
      clientId: row.entity_id as string,
      source: (row.source as string | null) ?? null,
      confirmedAt: (row.confirmed_at as string | null) ?? null,
    })),
  });

  if (!execute) {
    return NextResponse.json({
      dryRun: true,
      checked: plan.checked,
      eligible: plan.eligible,
      renamed: 0,
      refused: plan.refused,
      plan: plan.renames,
    });
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  // One statement per row: this is an operator-initiated repair, not a hot
  // path, and per-row errors stay attributable.
  const applied: typeof plan.renames = [];
  const failures: Array<{ clientId: string; message: string }> = [];
  for (const rename of plan.renames) {
    const { error: updateError } = await supabase
      .from("clients")
      .update({ name: rename.to })
      .eq("id", rename.clientId)
      .eq("company_id", companyId);
    if (updateError) {
      failures.push({ clientId: rename.clientId, message: updateError.message });
      continue;
    }
    try {
      await writeFieldProvenance({
        supabase,
        companyId,
        opportunityId: null,
        clientId: rename.clientId,
        opportunityUpdates: {},
        clientUpdates: { name: rename.to },
        facts: {
          contactName: rename.to,
          companyName: null,
          contactEmail: null,
          contactPhone: null,
          address: null,
          estimatedValue: null,
          description: null,
          source: "email",
          sourcePlatform: null,
          providerThreadId: null,
          providerMessageId: null,
          extractionSource: "historical_metadata",
        },
      });
    } catch (error) {
      failures.push({
        clientId: rename.clientId,
        message: error instanceof Error ? error.message : "provenance failed",
      });
      continue;
    }
    applied.push(rename);
  }

  return NextResponse.json({
    dryRun: false,
    checked: plan.checked,
    eligible: plan.eligible,
    renamed: applied.length,
    refused: plan.refused,
    plan: applied,
    failures,
  });
}

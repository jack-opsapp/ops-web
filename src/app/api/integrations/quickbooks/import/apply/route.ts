/**
 * OPS Web — QuickBooks Import Apply
 *
 * POST /api/integrations/quickbooks/import/apply
 * Body: { runId: string, decisions: { customer_qb_id, action, client_id? }[] }
 *
 * Applies a staged, owner-reviewed import into live tables (clients →
 * estimate/invoice headers → line items → payments → reconcile). Writes ONLY
 * to OPS Supabase — never to QuickBooks. Same auth as /api/sync +
 * accounting.manage_connections. Emits a notification-rail event on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { QuickBooksImportService } from "@/lib/api/services/quickbooks-import-service";
import { MATCH_ACTIONS, type QboApplyDecision, type MatchAction } from "@/lib/types/qbo-import";

const MATCH_ACTION_SET = new Set<string>(MATCH_ACTIONS);

/**
 * Shape-validate a single review decision. Each entry must carry a string
 * `customer_qb_id`, an `action` in the MatchAction union, and (optionally) a
 * string `client_id`. A malformed entry rejects the whole request with 400 so
 * the apply engine never runs against garbage decisions.
 */
function validateDecision(raw: unknown): QboApplyDecision | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.customer_qb_id !== "string" || d.customer_qb_id.length === 0) return null;
  if (typeof d.action !== "string" || !MATCH_ACTION_SET.has(d.action)) return null;
  if (d.client_id !== undefined && typeof d.client_id !== "string") return null;
  return {
    customer_qb_id: d.customer_qb_id,
    action: d.action as MatchAction,
    ...(typeof d.client_id === "string" ? { client_id: d.client_id } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { runId?: string; decisions?: unknown }
      | null;
    const runId = body?.runId;
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }
    if (!Array.isArray(body?.decisions)) {
      return NextResponse.json({ error: "decisions must be an array" }, { status: 400 });
    }
    // Shape-validate every decision before touching the apply engine. One bad
    // entry rejects the whole request (no partial-trust applies).
    const decisions: QboApplyDecision[] = [];
    for (const raw of body.decisions) {
      const decision = validateDecision(raw);
      if (!decision) {
        return NextResponse.json(
          { error: "Each decision must be { customer_qb_id: string, action: link|create|skip|needs_review, client_id?: string }" },
          { status: 400 }
        );
      }
      decisions.push(decision);
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = user.id as string;
    const companyId = user.company_id as string;

    const allowed = await checkPermissionById(userId, "accounting.manage_connections");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();

    // Scope the run to the caller's company before applying anything.
    const { data: run, error: runErr } = await supabase
      .from("qbo_import_runs")
      .select("id, company_id")
      .eq("id", runId)
      .single();
    if (runErr || !run) {
      return NextResponse.json({ error: "Import run not found" }, { status: 404 });
    }
    if ((run.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const service = new QuickBooksImportService(supabase);
    let applied;
    try {
      applied = await service.applyImport(runId, decisions);
    } catch (err) {
      console.error("[qbo-import-apply] applyImport failed:", err);
      return NextResponse.json(
        { error: `Apply failed: ${(err as Error).message}` },
        { status: 500 }
      );
    }

    // ── Notification-rail event (server-side insert; non-fatal) ────────────
    // Dedicated `accounting_import_complete` type (see plan Cross-Phase
    // Reconciliation Note #2): notifications.type is free text, and this type
    // is registered in NotificationType + NOTIF_TYPE_META for icon/label.
    try {
      const created = applied.clientsCreated + applied.clientsLinked;
      await supabase.from("notifications").insert({
        user_id: userId,
        company_id: companyId,
        type: "accounting_import_complete",
        title: "QuickBooks import applied",
        body:
          `${applied.invoicesUpserted} invoices, ${applied.paymentsUpserted} payments ` +
          `and ${created} clients imported into Books`,
        is_read: false,
        persistent: false,
        action_url: "/accounting",
        action_label: "View Books",
      });
    } catch (notifyErr) {
      console.error("[qbo-import-apply] notification insert failed (non-fatal):", notifyErr);
    }

    return NextResponse.json({ applied });
  } catch (err) {
    console.error("[qbo-import-apply] POST error:", err);
    return NextResponse.json({ error: "Failed to apply import" }, { status: 500 });
  }
}

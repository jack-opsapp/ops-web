/**
 * GET /api/agent/phase-c-status
 * Sprint S2: Read-only aggregated status for the Phase C agent dashboard.
 *
 * Returns a summary across all domains:
 *   - Email intelligence (drafts, approval rate, writing profile confidence)
 *   - Project management (suggestions, tasks)
 *   - Invoicing (invoices + reminders)
 *   - Scheduling (optimizations + comms)
 *   - Overall autonomy milestones
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../_lib/auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    const supabase = getServiceRoleClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

    // ── Email intelligence ──────────────────────────────────────────────
    const [
      draftsSent,
      draftsTotal,
      draftsUnchanged,
      writingProfileRes,
    ] = await Promise.all([
      supabase
        .from("ai_draft_history")
        .select("id", { count: "exact", head: true })
        .eq("company_id", auth.companyId)
        .eq("status", "sent")
        .gte("created_at", thirtyDaysAgoIso),
      supabase
        .from("ai_draft_history")
        .select("id", { count: "exact", head: true })
        .eq("company_id", auth.companyId)
        .gte("created_at", thirtyDaysAgoIso),
      supabase
        .from("ai_draft_history")
        .select("id", { count: "exact", head: true })
        .eq("company_id", auth.companyId)
        .eq("status", "sent")
        .eq("sent_without_changes", true)
        .gte("created_at", thirtyDaysAgoIso),
      supabase
        .from("agent_writing_profiles")
        .select("emails_analyzed, profile_type")
        .eq("company_id", auth.companyId),
    ]);

    const writingProfiles = writingProfileRes.data ?? [];
    const maxEmailsAnalyzed = writingProfiles.reduce(
      (max, p) => Math.max(max, (p.emails_analyzed as number) ?? 0),
      0
    );
    // Confidence function matches WritingProfileService.getConfidence — keep in sync
    const confidence = Math.min(1, Math.log10(maxEmailsAnalyzed + 1) / 2);

    // ── Agent actions by type over last 30 days ────────────────────────
    const { data: actionsByType } = await supabase
      .from("agent_actions")
      .select("action_type, status")
      .eq("company_id", auth.companyId)
      .gte("created_at", thirtyDaysAgoIso);

    const actionCounts: Record<
      string,
      { proposed: number; executed: number; rejected: number }
    > = {};
    for (const row of actionsByType ?? []) {
      const type = row.action_type as string;
      const status = row.status as string;
      if (!actionCounts[type]) {
        actionCounts[type] = { proposed: 0, executed: 0, rejected: 0 };
      }
      actionCounts[type].proposed++;
      if (status === "executed") actionCounts[type].executed++;
      if (status === "rejected") actionCounts[type].rejected++;
    }

    const sumFor = (types: string[]) =>
      types.reduce(
        (acc, t) => {
          const c = actionCounts[t];
          if (c) {
            acc.proposed += c.proposed;
            acc.executed += c.executed;
            acc.rejected += c.rejected;
          }
          return acc;
        },
        { proposed: 0, executed: 0, rejected: 0 }
      );

    const projectStats = sumFor(["create_project", "create_task", "reassign_task", "archive_project"]);
    const invoiceStats = sumFor(["create_invoice", "send_invoice_email", "send_payment_reminder"]);
    const scheduleStats = sumFor(["optimize_schedule", "reschedule_tasks"]);
    const commsStats = sumFor([
      "send_appointment_confirmation",
      "send_day_before_reminder",
      "send_subcontractor_coordination",
      "process_reschedule_request",
      "send_status_email",
    ]);

    const totalDrafts = draftsTotal.count ?? 0;
    const sentDrafts = draftsSent.count ?? 0;
    const unchangedDrafts = draftsUnchanged.count ?? 0;
    const approvalRate =
      totalDrafts > 0 ? Math.round((sentDrafts / totalDrafts) * 100) : 0;
    const unchangedRate =
      sentDrafts > 0 ? Math.round((unchangedDrafts / sentDrafts) * 100) : 0;

    // ── Autonomy milestones ────────────────────────────────────────────
    const milestones = {
      draftingAvailable: maxEmailsAnalyzed >= 25 && confidence > 0.2,
      drafting: maxEmailsAnalyzed >= 100 && confidence > 0.5,
      autoDraft: maxEmailsAnalyzed >= 250 && confidence > 0.75,
      autoSend: unchangedRate >= 95 && sentDrafts >= 20,
    };

    return NextResponse.json({
      email: {
        draftsGenerated: totalDrafts,
        draftsSent: sentDrafts,
        approvalRate,
        unchangedRate,
        writingProfileConfidence: Math.round(confidence * 100),
        emailsAnalyzed: maxEmailsAnalyzed,
      },
      projects: projectStats,
      invoicing: invoiceStats,
      scheduling: scheduleStats,
      clientComms: commsStats,
      milestones,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/phase-c-status]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

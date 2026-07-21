// src/app/api/cron/lead-summary-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runLeadSummaryRefresh } from "@/lib/api/services/lead-summary-service";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lead AI summary coverage — the activity-driven counterpart to the email
 * sync engine's summary writer (see lead-summary-service module doc).
 *
 * GET  — Vercel cron, hourly at :40 inside the email-sync operating window
 *        (`40 13-23,0-4 * * *`). Refreshes open-lead summaries whose
 *        activities / stage transitions / site visits are newer than
 *        ai_summary_updated_at, and generates first summaries for open leads
 *        that have substantive context but no summary yet.
 *
 *        MASTER SWITCH: `LEAD_SUMMARY_REFRESH_ENABLED`. Unset or any value
 *        other than "true" → the cron no-ops immediately after auth (the
 *        launch default; recurring LLM spend requires an explicit opt-in —
 *        mirrors INBOX_AUTO_SEND_ENABLED).
 *
 * POST — one-time manual backfill entry point (operator-invoked via curl).
 *        Body: {"mode":"backfill", "companyId"?: string, "dryRun"?: boolean}.
 *        Only fills leads with ai_summary IS NULL; never touches existing
 *        summaries. Deliberately NOT gated by the env switch — it is a
 *        single explicit invocation, not recurring spend.
 *
 * Both verbs: Bearer CRON_SECRET (mirrors every other OPS cron). Per-company
 * phase_c gating is enforced inside the service, identical to the shipped
 * engine. Writes are ai_summary + ai_summary_updated_at only.
 */

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function missingSecret(): NextResponse {
  return NextResponse.json(
    { error: "CRON_SECRET not configured" },
    { status: 500 }
  );
}

function isAuthorized(request: NextRequest, cronSecret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return missingSecret();
  if (!isAuthorized(request, cronSecret)) return unauthorized();

  if (process.env.LEAD_SUMMARY_REFRESH_ENABLED !== "true") {
    console.log(
      "[cron/lead-summary-refresh] skipped — recurring refresh disabled (LEAD_SUMMARY_REFRESH_ENABLED!=true)"
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "lead_summary_refresh_disabled",
    });
  }

  try {
    const result = await runLeadSummaryRefresh({
      supabase: getServiceRoleClient(),
      mode: "refresh",
    });
    console.log(
      "[cron/lead-summary-refresh]",
      JSON.stringify({
        mode: result.mode,
        companiesConsidered: result.companiesConsidered,
        companiesEnabled: result.companiesEnabled,
        leadsScanned: result.leadsScanned,
        candidates: result.candidates,
        summariesWritten: result.summariesWritten,
        skippedInsufficientContext: result.skippedInsufficientContext,
        failedCount: result.failed.length,
        failed: result.failed,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/lead-summary-refresh]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return missingSecret();
  if (!isAuthorized(request, cronSecret)) return unauthorized();

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (record?.mode !== "backfill") {
    return NextResponse.json(
      { error: 'POST requires body {"mode":"backfill"}' },
      { status: 400 }
    );
  }
  const companyId =
    typeof record.companyId === "string" && record.companyId.trim()
      ? record.companyId.trim()
      : undefined;
  const dryRun = record.dryRun === true;

  try {
    const result = await runLeadSummaryRefresh({
      supabase: getServiceRoleClient(),
      mode: "backfill",
      companyId,
      dryRun,
    });
    console.log(
      "[cron/lead-summary-refresh] backfill",
      JSON.stringify({
        dryRun: result.dryRun,
        companyId: companyId ?? null,
        companiesConsidered: result.companiesConsidered,
        companiesEnabled: result.companiesEnabled,
        leadsScanned: result.leadsScanned,
        candidates: result.candidates,
        summariesWritten: result.summariesWritten,
        skippedInsufficientContext: result.skippedInsufficientContext,
        failedCount: result.failed.length,
        failed: result.failed,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/lead-summary-refresh] backfill", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * /api/cron/email/projection-stuck-check
 *
 * Runs every 5 minutes. Detects meaningful correspondence events whose
 * opportunity counter projection never applied:
 *
 *   is_meaningful AND NOT opportunity_projection_applied
 *   AND created_at < now() - 5 minutes
 *
 * A healthy projection completes within seconds of event insertion; five
 * minutes unprojected is a fault. This exact condition preceded the
 * 2026-07-22 full outage by 18 hours: one stuck row made the unbounded
 * pending-projection guard raise SQLSTATE 40001 on every guarded commercial
 * RPC and zero-backoff workers hot-looped the database to death. The guard is
 * now bounded to 60 seconds (20260722150000), so a stuck row degrades into
 * exactly one thing — silent evidence loss on the affected lead — and this
 * monitor is what makes that loss loud.
 *
 * Fires one persistent operator-rail alert per incident via
 * create_notification_if_new_with_identity (dedupe on the open notification),
 * and resolves it once no stuck rows remain, re-arming the dedupe key for
 * the next incident. Mirrors the email-ingest-heartbeat alert lifecycle.
 *
 * Auth: Bearer ${CRON_SECRET}. Service-role DB only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
const SCAN_LIMIT = 500;
const ALERT_DEDUPE_KEY = "email-correspondence-projection-stuck";

interface StuckEventRow {
  id: string;
  company_id: string;
  opportunity_id: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();
  const now = Date.now();
  const thresholdIso = new Date(now - STUCK_THRESHOLD_MS).toISOString();

  const { data: stuckRows, error: stuckError } = await db
    .from("opportunity_correspondence_events")
    .select("id, company_id, opportunity_id, created_at")
    .eq("is_meaningful", true)
    .eq("opportunity_projection_applied", false)
    .lt("created_at", thresholdIso)
    .order("created_at", { ascending: true })
    .limit(SCAN_LIMIT);
  if (stuckError) {
    console.error("[projection-stuck-check] scan failed:", stuckError.message);
    return NextResponse.json({ error: "scan_failed" }, { status: 500 });
  }

  const stuck = (stuckRows ?? []) as StuckEventRow[];

  if (stuck.length === 0) {
    // Incident over (or never started): close any open alert so the dedupe
    // key re-arms for the next incident.
    const { data: resolvedRows, error: resolutionError } = await db
      .from("notifications")
      .update({
        resolved_at: new Date(now).toISOString(),
        is_read: true,
        resolution_reason: "projection_recovered",
      })
      .eq("dedupe_key", ALERT_DEDUPE_KEY)
      .is("resolved_at", null)
      .select("id");
    if (resolutionError) {
      console.error(
        "[projection-stuck-check] alert resolution failed:",
        resolutionError.message
      );
      return NextResponse.json({ error: "resolution_failed" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      stuck: 0,
      resolved: (resolvedRows ?? []).length,
    });
  }

  const opportunityIds = new Set(stuck.map((row) => row.opportunity_id));
  const companyIds = new Set(stuck.map((row) => row.company_id));
  const oldestAgeMinutes = Math.floor(
    (now - Date.parse(stuck[0].created_at)) / 60_000
  );

  // Forensic breadcrumb for the on-call session — the notification carries
  // the summary, the log carries the row identities.
  console.error("[projection-stuck-check] stuck projection detected", {
    stuck: stuck.length,
    scanCapped: stuck.length >= SCAN_LIMIT,
    opportunities: opportunityIds.size,
    companies: companyIds.size,
    oldestAgeMinutes,
    sampleEventIds: stuck.slice(0, 10).map((row) => row.id),
  });

  const operatorUserId = process.env.PMF_OPERATOR_USER_ID;
  const operatorCompanyId = process.env.PMF_OPERATOR_COMPANY_ID;
  if (!operatorUserId || !operatorCompanyId) {
    console.error(
      "[projection-stuck-check] alert skipped — PMF_OPERATOR_USER_ID or PMF_OPERATOR_COMPANY_ID unset"
    );
    return NextResponse.json({
      ok: true,
      stuck: stuck.length,
      opportunities: opportunityIds.size,
      companies: companyIds.size,
      oldestAgeMinutes,
      alerted: false,
    });
  }

  const eventNoun = stuck.length === 1 ? "email event" : "email events";
  const leadNoun = opportunityIds.size === 1 ? "lead" : "leads";
  const { data: notificationResult, error: notificationError } = await db.rpc(
    "create_notification_if_new_with_identity",
    {
      p_user_id: operatorUserId,
      p_company_id: operatorCompanyId,
      p_type: "system_alert",
      p_title: "CRITICAL :: EMAIL PROJECTION STUCK",
      p_body: `${stuck.length} meaningful ${eventNoun} unprojected for over 5 minutes across ${opportunityIds.size} ${leadNoun}. Oldest ${oldestAgeMinutes}m. Lifecycle writes are running without this evidence.`,
      p_persistent: true,
      p_action_url: "/admin/email?tab=event-monitor",
      p_action_label: "VIEW MONITOR",
      p_project_id: null,
      p_deep_link_type: null,
      p_dedupe_key: ALERT_DEDUPE_KEY,
    }
  );
  if (notificationError) {
    console.error(
      "[projection-stuck-check] alert insert failed:",
      notificationError.message
    );
    return NextResponse.json({ error: "alert_failed" }, { status: 500 });
  }

  const rawNotification = Array.isArray(notificationResult)
    ? notificationResult[0]
    : notificationResult;
  const alerted =
    rawNotification !== null &&
    typeof rawNotification === "object" &&
    typeof (rawNotification as Record<string, unknown>).notification_id ===
      "string";

  return NextResponse.json({
    ok: true,
    stuck: stuck.length,
    opportunities: opportunityIds.size,
    companies: companyIds.size,
    oldestAgeMinutes,
    scanCapped: stuck.length >= SCAN_LIMIT,
    // False when an open alert already covers this incident (deduped).
    alerted,
  });
}

/**
 * /api/cron/email/anomaly-check
 *
 * Runs every 5 minutes. Pulls deliverability metrics from the
 * `email_event_metrics` RPC for the live 15-min window plus a 60-min
 * baseline (used for volume drop detection), evaluates them against the
 * pure evaluator in src/lib/email/anomaly-thresholds.ts, dedups against
 * recent log rows, persists new breaches into `email_anomaly_log`,
 * fires a notification rail entry for the operator, and — for critical
 * bounce/spam spikes only — calls pause('global', ...) and writes the
 * resulting audit id back onto the anomaly row.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  evaluateThresholds,
  severityRank,
  type AnomalyEval,
  type MetricSnapshot,
} from "@/lib/email/anomaly-thresholds";
import { pause } from "@/lib/email/pause";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEDUP_WINDOW_MINUTES = 60;

interface MetricsResp {
  window_minutes: number;
  total_sent: number;
  total_delivered: number;
  total_bounced: number;
  bounce_pct: number;
  total_spam: number;
  spam_pct: number;
  total_open: number;
  open_pct: number;
  total_click: number;
  click_pct: number;
  error_events: number;
}

type DatabaseResponse<T> = {
  data: T;
  error: { message?: string } | null;
};

async function requireDatabaseResponse<T>(
  context: string,
  operation: () => PromiseLike<DatabaseResponse<T>>
): Promise<T> {
  try {
    const result = await operation();
    if (result.error) {
      throw new CronDatabaseOperationError(
        `${context}: ${result.error.message ?? "unknown error"}`,
        { cause: result.error }
      );
    }
    return result.data;
  } catch (cause) {
    if (cause instanceof CronDatabaseOperationError) throw cause;
    throw new CronDatabaseOperationError(`${context}: request failed`, {
      cause,
    });
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const db = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: db,
      workloadKey: "email-anomaly-check",
      leaseSeconds: 120,
      work: () => runAnomalyCheck(db),
    });
    if (controlled.status === "skipped") {
      const reason =
        controlled.reason === "lease_held"
          ? "already_running"
          : controlled.reason;
      return NextResponse.json(
        {
          ok: controlled.reason === "lease_held",
          ran: false,
          reason,
        },
        { status: controlled.reason === "lease_held" ? 200 : 503 }
      );
    }
    return NextResponse.json(controlled.value);
  } catch (error) {
    console.error("[anomaly-check] fatal:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Anomaly check failed",
      },
      { status: 500 }
    );
  }
}

async function runAnomalyCheck(db: SupabaseClient) {
  const [nowRaw, baseRaw] = await Promise.all([
    requireDatabaseResponse("anomaly current metrics fetch failed", () =>
      db.rpc("email_event_metrics", { p_minutes_back: 15 })
    ),
    requireDatabaseResponse("anomaly baseline metrics fetch failed", () =>
      db.rpc("email_event_metrics", { p_minutes_back: 60 })
    ),
  ]);
  if (!nowRaw) throw new Error("Anomaly current metrics returned no result");
  const m = nowRaw as MetricsResp;
  const base = baseRaw as MetricsResp | null;

  const snapshot: MetricSnapshot = {
    windowMinutes: m.window_minutes,
    totalSent: m.total_sent,
    totalDelivered: m.total_delivered,
    totalBounced: m.total_bounced,
    bouncePct: Number(m.bounce_pct),
    totalSpam: m.total_spam,
    spamPct: Number(m.spam_pct),
    totalOpen: m.total_open,
    openPct: Number(m.open_pct),
    totalClick: m.total_click,
    clickPct: Number(m.click_pct),
    errorEvents: m.error_events,
    baselineSent: base?.total_sent,
    baselineWindowMinutes: base?.window_minutes,
  };

  const evals = evaluateThresholds(snapshot);
  if (evals.length === 0) {
    return { ok: true, evals: 0, written: 0 };
  }

  const sinceIso = new Date(
    Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000
  ).toISOString();
  const recent = await requireDatabaseResponse(
    "anomaly dedupe lookup failed",
    () =>
      db
        .from("email_anomaly_log")
        .select("kind, severity, detected_at")
        .gte("detected_at", sinceIso)
  );

  const recentByKind = new Map<string, "warn" | "critical">();
  for (const r of (recent ?? []) as Array<{
    kind: string;
    severity: "warn" | "critical";
  }>) {
    const prev = recentByKind.get(r.kind);
    if (!prev || severityRank(r.severity) >= severityRank(prev)) {
      recentByKind.set(r.kind, r.severity);
    }
  }

  let written = 0;
  for (let index = 0; index < evals.length; index += 2) {
    const batch = evals.slice(index, index + 2);
    const settled = await Promise.allSettled(
      batch.map((ev) => processEvaluation(db, ev, recentByKind))
    );
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failure) throw failure.reason;
    written += settled.reduce(
      (total, result) =>
        total + (result.status === "fulfilled" ? result.value : 0),
      0
    );
  }

  return { ok: true, evals: evals.length, written };
}

async function processEvaluation(
  db: SupabaseClient,
  ev: AnomalyEval,
  recentByKind: Map<string, "warn" | "critical">
): Promise<number> {
  const recentSev = recentByKind.get(ev.kind);
  if (recentSev && severityRank(recentSev) >= severityRank(ev.severity)) {
    return 0;
  }

  const logRow = await requireDatabaseResponse(
    "anomaly log insert failed",
    () =>
      db
        .from("email_anomaly_log")
        .insert({
          kind: ev.kind,
          severity: ev.severity,
          window_minutes: ev.windowMinutes,
          metric_value: ev.metricValue,
          threshold: ev.threshold,
          context: ev.context,
          action_taken: null,
        })
        .select("id")
        .single()
  );
  if (!logRow) throw new Error("Anomaly log insert returned no row");
  const anomalyId = logRow.id as string;

  let pauseAuditId: string | null = null;
  let actionTaken: string | null = null;
  if (
    ev.severity === "critical" &&
    (ev.kind === "bounce_spike" || ev.kind === "spam_spike")
  ) {
    const operatorUserId = process.env.PMF_OPERATOR_USER_ID;
    const operatorEmail = process.env.PMF_NOTIFICATION_EMAIL;
    if (!operatorUserId || !operatorEmail) {
      actionTaken =
        "pause skipped: PMF_OPERATOR_USER_ID or PMF_NOTIFICATION_EMAIL unset (cannot record actor)";
      console.error("[anomaly-check] pause skipped — missing actor env vars");
    } else {
      try {
        const result = await pause({
          scope: "global",
          reason: `auto: ${ev.kind} ${ev.metricValue}% over ${ev.threshold}%`,
          actorUserId: operatorUserId,
          actorEmail: operatorEmail,
          severity: "critical",
          anomalyLogId: anomalyId,
          abortOnDatabaseError: true,
        });
        pauseAuditId = result.pauseAuditId;
        actionTaken = `pause(global) by anomaly ${ev.kind}@${ev.metricValue}% [audit ${pauseAuditId ?? "unknown"}]`;
      } catch (err) {
        if (err instanceof CronDatabaseOperationError) throw err;
        actionTaken = `pause attempt failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error("[anomaly-check] pause failed:", err);
      }
    }
  }

  const operatorUserId = process.env.PMF_OPERATOR_USER_ID;
  const operatorCompanyId = process.env.PMF_OPERATOR_COMPANY_ID;
  let notifId: string | null = null;
  if (operatorUserId && operatorCompanyId) {
    const notifRow = await requireDatabaseResponse(
      "anomaly notification insert failed",
      () =>
        db
          .from("notifications")
          .insert({
            user_id: operatorUserId,
            company_id: operatorCompanyId,
            type: "email_anomaly",
            title: `${ev.severity === "critical" ? "CRITICAL" : "WARN"} :: ${labelForKind(ev.kind)}`,
            body: `${ev.metricValue.toFixed(2)} (threshold ${ev.threshold}) over ${ev.windowMinutes}m`,
            is_read: false,
            persistent: ev.severity === "critical",
            action_url: "/admin/email?tab=event-monitor",
            action_label: "VIEW MONITOR",
          })
          .select("id")
          .single()
    );
    if (!notifRow) {
      throw new Error("Anomaly notification insert returned no row");
    }
    notifId = (notifRow?.id as string | undefined) ?? null;
  }

  await requireDatabaseResponse("anomaly log finalization failed", () =>
    db
      .from("email_anomaly_log")
      .update({
        action_taken: actionTaken,
        notification_id: notifId,
        pause_audit_id: pauseAuditId,
      })
      .eq("id", anomalyId)
  );

  return 1;
}

function labelForKind(k: AnomalyEval["kind"]): string {
  switch (k) {
    case "bounce_spike":
      return "BOUNCE SPIKE";
    case "spam_spike":
      return "SPAM SPIKE";
    case "delivery_drop":
      return "DELIVERY DROP";
    case "volume_drop":
      return "VOLUME DROP";
  }
}

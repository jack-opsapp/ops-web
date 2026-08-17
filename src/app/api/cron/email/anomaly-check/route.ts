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
import { pause, retryPauseNotificationFanout } from "@/lib/email/pause";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import {
  getOptionalPmfOperatorIdentity,
  getOptionalPmfOperatorUserId,
  type PmfOperatorIdentity,
} from "@/lib/pmf/recipients";
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

interface AnomalyLogRow {
  id: string;
  kind: AnomalyEval["kind"];
  severity: AnomalyEval["severity"];
  detected_at: string;
  window_minutes: number;
  metric_value: number;
  threshold: number;
  context: Record<string, unknown>;
  action_taken: string | null;
  notification_id: string | null;
  pause_audit_id: string | null;
  resolved_at: string | null;
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
  const sinceIso = new Date(
    Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000
  ).toISOString();
  const recent = await requireDatabaseResponse(
    "anomaly dedupe lookup failed",
    () =>
      db
        .from("email_anomaly_log")
        .select(
          "id, kind, severity, detected_at, window_minutes, metric_value, threshold, context, action_taken, notification_id, pause_audit_id, resolved_at"
        )
        .gte("detected_at", sinceIso)
  );

  const incomplete = await requireDatabaseResponse(
    "anomaly reconciliation lookup failed",
    () =>
      db
        .from("email_anomaly_log")
        .select(
          "id, kind, severity, detected_at, window_minutes, metric_value, threshold, context, action_taken, notification_id, pause_audit_id, resolved_at"
        )
        .or(
          "notification_id.is.null,and(severity.eq.critical,pause_audit_id.is.null)"
        )
        .is("resolved_at", null)
        .order("detected_at", { ascending: true })
        .limit(100)
  );

  const recentRows = (recent ?? []) as AnomalyLogRow[];
  const reconciliationRows = new Map<string, AnomalyLogRow>();
  for (const row of [
    ...((incomplete ?? []) as AnomalyLogRow[]),
    ...recentRows,
  ]) {
    reconciliationRows.set(row.id, row);
  }
  const requiresNotificationIdentity =
    evals.length > 0 ||
    [...reconciliationRows.values()].some(
      (row) =>
        row.notification_id === null ||
        (isCriticalPauseAnomaly(anomalyEvalFromLogRow(row)) &&
          row.pause_audit_id === null)
    );
  let operatorIdentity: PmfOperatorIdentity | null = null;
  let pauseActorUserId: string | null = null;
  if (requiresNotificationIdentity) {
    try {
      operatorIdentity = getOptionalPmfOperatorIdentity();
    } catch (error) {
      console.error(
        "[anomaly-check] operator identity configuration invalid:",
        error
      );
    }
  }
  try {
    pauseActorUserId = getOptionalPmfOperatorUserId();
  } catch (error) {
    console.error("[anomaly-check] pause actor configuration invalid:", error);
  }

  // When notification identity is not configured, a page of old warn rows
  // must not hide later critical pause recovery. Fetch that lane separately.
  const incompleteCritical = await requireDatabaseResponse(
    "critical anomaly reconciliation lookup failed",
    () =>
      db
        .from("email_anomaly_log")
        .select(
          "id, kind, severity, detected_at, window_minutes, metric_value, threshold, context, action_taken, notification_id, pause_audit_id, resolved_at"
        )
        .eq("severity", "critical")
        .in("kind", ["bounce_spike", "spam_spike"])
        .is("pause_audit_id", null)
        .is("resolved_at", null)
        .order("detected_at", { ascending: true })
        .limit(100)
  );
  for (const row of (incompleteCritical ?? []) as AnomalyLogRow[]) {
    reconciliationRows.set(row.id, row);
  }

  for (const row of reconciliationRows.values()) {
    if (row.resolved_at !== null && row.resolved_at !== undefined) continue;
    if (!needsReconciliation(row, operatorIdentity)) continue;
    await finalizeAnomalyRow(db, anomalyEvalFromLogRow(row), {
      anomalyId: row.id,
      actionTaken: row.action_taken,
      notificationId: row.notification_id,
      pauseAuditId: row.pause_audit_id,
      operatorIdentity,
      pauseActorUserId,
      recoverPauseAudit: true,
    });
  }

  if (evals.length === 0) {
    return { ok: true, evals: 0, written: 0 };
  }

  const recentByKind = new Map<string, "warn" | "critical">();
  for (const r of recentRows) {
    const prev = recentByKind.get(r.kind);
    if (!prev || severityRank(r.severity) >= severityRank(prev)) {
      recentByKind.set(r.kind, r.severity);
    }
  }

  let written = 0;
  for (let index = 0; index < evals.length; index += 2) {
    const batch = evals.slice(index, index + 2);
    const settled = await Promise.allSettled(
      batch.map((ev) =>
        processEvaluation(
          db,
          ev,
          recentByKind,
          operatorIdentity,
          pauseActorUserId
        )
      )
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
  recentByKind: Map<string, "warn" | "critical">,
  operatorIdentity: PmfOperatorIdentity | null,
  pauseActorUserId: string | null
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

  await finalizeAnomalyRow(db, ev, {
    anomalyId,
    actionTaken: null,
    notificationId: null,
    pauseAuditId: null,
    operatorIdentity,
    pauseActorUserId,
    recoverPauseAudit: false,
  });

  return 1;
}

function isCriticalPauseAnomaly(ev: AnomalyEval): boolean {
  return (
    ev.severity === "critical" &&
    (ev.kind === "bounce_spike" || ev.kind === "spam_spike")
  );
}

function needsReconciliation(
  row: AnomalyLogRow,
  operatorIdentity: PmfOperatorIdentity | null
): boolean {
  const missingNotification =
    operatorIdentity !== null && row.notification_id === null;
  const missingPauseOutcome =
    isCriticalPauseAnomaly(anomalyEvalFromLogRow(row)) &&
    (row.action_taken == null ||
      row.action_taken?.startsWith("pause skipped:") ||
      row.action_taken?.startsWith("pause attempt failed:") ||
      (row.pause_audit_id === null &&
        row.action_taken?.startsWith("pause(global)")));
  return missingNotification || missingPauseOutcome;
}

function anomalyEvalFromLogRow(row: AnomalyLogRow): AnomalyEval {
  return {
    kind: row.kind,
    severity: row.severity,
    windowMinutes: row.window_minutes,
    metricValue: Number(row.metric_value),
    threshold: Number(row.threshold),
    context: row.context ?? {},
  };
}

async function findPauseAuditId(
  db: SupabaseClient,
  anomalyId: string
): Promise<string | null> {
  const auditRow = await requireDatabaseResponse(
    "anomaly pause audit recovery failed",
    () =>
      db
        .from("email_pause_audit_log")
        .select("id")
        .eq("anomaly_log_id", anomalyId)
        .eq("action", "pause")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
  );
  if (!auditRow) return null;
  const id = (auditRow as { id?: unknown }).id;
  if (typeof id !== "string" || id === "") {
    throw new Error("Anomaly pause audit recovery returned an invalid id");
  }
  return id;
}

async function finalizeAnomalyRow(
  db: SupabaseClient,
  ev: AnomalyEval,
  state: {
    anomalyId: string;
    actionTaken: string | null;
    notificationId: string | null;
    pauseAuditId: string | null;
    operatorIdentity: PmfOperatorIdentity | null;
    pauseActorUserId: string | null;
    recoverPauseAudit: boolean;
  }
): Promise<void> {
  const anomalyId = state.anomalyId;
  let pauseAuditId = state.pauseAuditId;
  let actionTaken = state.actionTaken;

  if (
    state.recoverPauseAudit &&
    (actionTaken?.startsWith("pause skipped:") ||
      actionTaken?.startsWith("pause attempt failed:"))
  ) {
    actionTaken = null;
  }

  if (isCriticalPauseAnomaly(ev)) {
    if (pauseAuditId !== null) {
      actionTaken = `pause(global) by anomaly ${ev.kind}@${ev.metricValue}% [audit ${pauseAuditId}]`;
    } else if (state.recoverPauseAudit) {
      pauseAuditId = await findPauseAuditId(db, anomalyId);
      if (pauseAuditId) {
        actionTaken = `pause(global) by anomaly ${ev.kind}@${ev.metricValue}% [audit ${pauseAuditId}]`;
      }
    }

    if (state.recoverPauseAudit && pauseAuditId !== null) {
      await retryPauseNotificationFanout({
        anomalyId,
        pauseAuditId,
      });
    }

    if (actionTaken === null) {
      const operatorUserId = state.pauseActorUserId;
      const operatorEmail = process.env.PMF_NOTIFICATION_EMAIL?.trim();
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
  }

  let notifId = state.notificationId;
  if (notifId === null && state.operatorIdentity) {
    const { operatorUserId, operatorCompanyId } = state.operatorIdentity;
    const notificationResult = await requireDatabaseResponse(
      "anomaly notification identity write failed",
      () =>
        db.rpc("create_email_anomaly_notification_if_new", {
          p_anomaly_id: anomalyId,
          p_user_id: operatorUserId,
          p_company_id: operatorCompanyId,
          p_title: `${ev.severity === "critical" ? "CRITICAL" : "WARN"} :: ${labelForKind(ev.kind)}`,
          p_body: `${ev.metricValue.toFixed(2)} (threshold ${ev.threshold}) over ${ev.windowMinutes}m`,
          p_persistent: ev.severity === "critical",
          p_action_url: "/admin/email?tab=event-monitor",
          p_action_label: "VIEW MONITOR",
        })
    );
    const rawNotification = Array.isArray(notificationResult)
      ? notificationResult[0]
      : notificationResult;
    if (
      rawNotification === null ||
      typeof rawNotification !== "object" ||
      typeof (rawNotification as Record<string, unknown>).notification_id !==
        "string" ||
      (rawNotification as Record<string, unknown>).notification_id === "" ||
      typeof (rawNotification as Record<string, unknown>).created !== "boolean"
    ) {
      throw new Error("Anomaly notification identity response was invalid");
    }
    notifId = (rawNotification as { notification_id: string }).notification_id;
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

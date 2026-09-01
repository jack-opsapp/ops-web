/**
 * GET /api/cron/pmf/threshold-check
 *
 * Vercel cron: hourly within the active window ("57 13-14,16-23,0-4 * * *").
 * The cadence is deliberate database-pressure containment and is authoritative
 * — this handler is cadence-independent by design.
 *
 * Two-part job:
 *   1. STATE DIFF — compute the current PMF state, compare against the most
 *      recent snapshot in `pmf_threshold_snapshots`, and fire a threshold
 *      alert for every transition that's either (a) newly green or
 *      (b) worsening from its prior status. `diffState` already filters
 *      out transitions we don't care about. A diff is never lost when a run
 *      is skipped, only delayed — the next run diffs against the same prior
 *      snapshot.
 *   2. EVENT-DRIVEN — scan the half-open window [eventsThrough, runStart) for
 *      notable events (new inbound prospects, refunds processed, first-ever
 *      referral prospect) and fire one alert per event. `eventsThrough` lives
 *      in the fenced cron workload cursor, so consecutive runs are contiguous:
 *      no gaps between runs, no double-scanning, and off-hours activity is
 *      picked up by the next scheduled run. A fixed lookback could not do
 *      this — at hourly cadence a 15-minute lookback left 84% of each day
 *      unscanned (bug b71728ed).
 *
 * At-least-once: the cursor only advances when no event alert failed on every
 * channel it attempted. Per-event triggers are unique ids, deduped over a
 * 7-day horizon, so a re-scan retries exactly the alerts that never landed.
 *
 * The current state snapshot is always written, regardless of whether
 * any transitions fired, so the next run has a baseline to diff against.
 *
 * Uncached `computePmfState()` is used (not `getPmfState()`) because this
 * cron is the definitive source of "is anything new?" — we want fresh
 * values every run, not a stale 60s cache.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { computePmfState } from "@/lib/admin/pmf-queries";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { diffState } from "@/lib/pmf/threshold-diff";
import {
  sendPmfNotification,
  type SendOutcome,
} from "@/lib/notifications/pmf-send";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";
import type { CronWorkloadLease } from "@/lib/api/services/cron-workload-control-service";
import { thresholdAlertEmail as ThresholdAlertEmail } from "@/lib/email/pmf-bridge";
import { fmtTime } from "@/lib/pmf/formatters";
import type { PmfState } from "@/lib/pmf/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DASHBOARD_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co"}/admin/pmf`;

const STEM_PREFIX = "OPS ::";
const UNKNOWN_LABEL = "UNKNOWN";
const BILLING_EVENT_TYPE_REFUND = "charge.refunded";

const THRESHOLD_WORKLOAD_KEY = "pmf-threshold-check";
/** Unique-id event triggers send once ever within this horizon; re-scans
 * after a held cursor retry only what never succeeded. */
const EVENT_DEDUP_MS = 7 * 24 * 60 * 60 * 1000;
/** First-run lookback: covers the 9h overnight scheduling gap with slack. */
const BOOTSTRAP_LOOKBACK_MS = 10 * 60 * 60 * 1000;
/** Never scan further back than this, even after an outage. */
const MAX_CATCHUP_MS = 7 * 24 * 60 * 60 * 1000;

function parseEventCursor(raw: string | null): Date | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { eventsThrough?: unknown };
    if (typeof parsed?.eventsThrough !== "string") return null;
    const at = new Date(parsed.eventsThrough);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    console.warn("[pmf-threshold-check] invalid cursor; re-bootstrapping");
    return null;
  }
}

interface InboundProspectRow {
  id: string;
  company: string | null;
  name: string;
  source: string;
  first_contact_direction: string;
  first_contact_at: string;
}

interface RefundEventRow {
  id: string;
  amount_cents: number | null;
  company_id: string | null;
  occurred_at: string;
}

interface ReferralProspectRow {
  id: string;
  company: string | null;
  name: string;
}

function databaseFailure(
  operation: string,
  cause: unknown
): CronDatabaseOperationError {
  if (cause instanceof CronDatabaseOperationError) return cause;
  const detail =
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
      ? cause.message
      : "unknown database error";
  return new CronDatabaseOperationError(`${operation} failed: ${detail}`, {
    cause,
  });
}

async function executeDatabaseOperation<T>(
  operation: string,
  pending: PromiseLike<T>
): Promise<T> {
  try {
    return await pending;
  } catch (cause) {
    throw databaseFailure(operation, cause);
  }
}

async function runThresholdCheck(
  sb: ReturnType<typeof getAdminSupabase>,
  lease: CronWorkloadLease
): Promise<NextResponse> {
  const runStart = new Date();
  // Compute a single timestamp shared across every alert fired in this run, so
  // a batch of transitions + events all report the same `· HH:MM` suffix.
  const runTimestamp = fmtTime(runStart);

  // Resolve the event scan window from the fenced cursor before doing any
  // work, so a mid-run failure re-scans exactly the same window next time.
  const rawCursor = await readCronWorkloadCursor(
    sb,
    THRESHOLD_WORKLOAD_KEY,
    lease
  );
  const cursorAt = parseEventCursor(rawCursor);
  let truncated = false;
  let windowStart = cursorAt ?? new Date(runStart.getTime() - BOOTSTRAP_LOOKBACK_MS);
  if (runStart.getTime() - windowStart.getTime() > MAX_CATCHUP_MS) {
    windowStart = new Date(runStart.getTime() - MAX_CATCHUP_MS);
    truncated = true;
  }
  if (windowStart > runStart) windowStart = runStart; // clock-skew guard
  const since = windowStart.toISOString();
  const until = runStart.toISOString();

  // Compute current state (uncached — every 15 min we want fresh values).
  let now: PmfState;
  try {
    now = await computePmfState();
  } catch (cause) {
    throw databaseFailure("PMF state computation", cause);
  }

  // Read the most recent prior snapshot BEFORE inserting the current one,
  // so the diff compares against the previous run, not this one.
  const { data: priorRows, error: priorErr } = await executeDatabaseOperation(
    "PMF prior snapshot read",
    sb
      .from("pmf_threshold_snapshots")
      .select("state")
      .order("captured_at", { ascending: false })
      .limit(1)
  );
  if (priorErr) {
    throw databaseFailure("PMF prior snapshot read", priorErr);
  }
  const prior = (priorRows?.[0]?.state ?? null) as PmfState | null;

  // Persist the current snapshot before sending notifications. A missing
  // snapshot would make a retry compare against stale state and duplicate
  // work, so database failures abort this controlled run.
  const { error: insertErr } = await executeDatabaseOperation(
    "PMF snapshot insert",
    sb
      .from("pmf_threshold_snapshots")
      .insert({ state: now as unknown as Record<string, unknown> })
  );
  if (insertErr) {
    throw databaseFailure("PMF snapshot insert", insertErr);
  }

  // `billing_events` has no `created_at` column in the schema; filter on
  // `received_at` (when the event landed in our system) instead — same
  // semantic meaning as the plan's original `created_at`.
  const [
    { data: newInbound, error: inboundErr },
    { data: newRefunds, error: refundErr },
    { data: newReferrals, error: referralErr },
  ] = await Promise.all([
    executeDatabaseOperation(
      "PMF inbound event query",
      sb
        .from("pmf_prospects")
        .select(
          "id,company,name,source,first_contact_direction,first_contact_at"
        )
        .gte("created_at", since)
        .lt("created_at", until)
        .or(
          "first_contact_direction.eq.inbound,source.in.(paid_ad,organic_search,referral,direct)"
        )
    ),
    executeDatabaseOperation(
      "PMF refund event query",
      sb
        .from("billing_events")
        .select("id,amount_cents,company_id,occurred_at")
        .eq("event_type", BILLING_EVENT_TYPE_REFUND)
        .gte("received_at", since)
        .lt("received_at", until)
    ),
    executeDatabaseOperation(
      "PMF referral event query",
      sb
        .from("pmf_prospects")
        .select("id,company,name")
        .eq("source", "referral")
        .gte("created_at", since)
        .lt("created_at", until)
    ),
  ]);

  if (inboundErr) {
    throw databaseFailure("PMF inbound event query", inboundErr);
  }
  if (refundErr) {
    throw databaseFailure("PMF refund event query", refundErr);
  }
  if (referralErr) {
    throw databaseFailure("PMF referral event query", referralErr);
  }

  const inboundRows = (newInbound ?? []) as InboundProspectRow[];
  const refundRows = (newRefunds ?? []) as RefundEventRow[];
  const referralRows = (newReferrals ?? []) as ReferralProspectRow[];

  // Compute transitions once; used both for sends and the response payload.
  const transitions = prior ? diffState(prior, now) : [];

  // Determine whether the first_referral block will fire this run, and for
  // which prospect. A new prospect with `source = 'referral'` matches BOTH
  // the inbound `.or(...)` query (which includes `source.in.(...,referral,...)`)
  // AND the referral query. Without this guard, such a prospect would fire
  // two sends — `new_inbound_<id>` AND `first_referral` — for the same event.
  // When the milestone is triggering, the milestone wins; when it isn't, the
  // inbound path owns the alert.
  const firstReferralProspect =
    prior && prior.indicators.indicator_e.value === 0 && referralRows.length > 0
      ? referralRows[0]
      : null;

  // Transition sends are pushed FIRST so the event sends occupy a known tail
  // slice of the settled results — only event delivery gates the cursor.
  const sends: Promise<SendOutcome>[] = [];

  // State transitions
  for (const t of transitions) {
    const stem =
      t.to === "green"
        ? `${t.key.toUpperCase()} GREEN`
        : `${t.key.toUpperCase()} ${t.to.toUpperCase()}`;
    sends.push(
      sendPmfNotification({
        kind: "threshold_alert",
        trigger: `${t.key}_${t.from}_to_${t.to}`,
        smsBody: `${STEM_PREFIX} ${stem} · ${runTimestamp}`,
        emailSubject: `${STEM_PREFIX} ${stem}`,
        emailReact: ThresholdAlertEmail({
          trigger: `${t.key} ${t.from}→${t.to}`,
          messageBody: stem,
          context: { VALUE: t.value },
          dashboardUrl: DASHBOARD_URL,
        }),
        inAppTitle: stem,
        inAppBody: `value ${t.value}`,
      })
    );
  }

  const transitionSendCount = sends.length;

  // Inbound leads — one alert per new prospect.
  // `pmf_prospects.name` is NOT NULL per schema, so `p.name` is always
  // present; `p.company` can be null. The fallback chain is defensive.
  for (const p of inboundRows) {
    // Skip the prospect that the first_referral block will alert on — a
    // referral prospect matches both queries, and we only want one send.
    if (firstReferralProspect && p.id === firstReferralProspect.id) continue;
    const label = (p.company ?? p.name ?? UNKNOWN_LABEL).toUpperCase();
    const stem = `NEW INBOUND LEAD · ${label}`;
    sends.push(
      sendPmfNotification({
        kind: "threshold_alert",
        trigger: `new_inbound_${p.id}`,
        smsBody: `${STEM_PREFIX} ${stem} · ${runTimestamp}`,
        emailSubject: `${STEM_PREFIX} ${stem}`,
        emailReact: ThresholdAlertEmail({
          trigger: "new_inbound_lead",
          messageBody: stem,
          context: {
            SOURCE: p.source,
            DIRECTION: p.first_contact_direction,
          },
          dashboardUrl: DASHBOARD_URL,
        }),
        inAppTitle: stem,
        inAppBody: `source: ${p.source}`,
        dedupMs: EVENT_DEDUP_MS,
      })
    );
  }

  // Refunds — one alert per refund event.
  for (const r of refundRows) {
    const amount = ((r.amount_cents ?? 0) / 100).toFixed(0);
    const stem = `REFUND · $${amount}`;
    sends.push(
      sendPmfNotification({
        kind: "threshold_alert",
        trigger: `refund_${r.id}`,
        smsBody: `${STEM_PREFIX} ${stem} · ${runTimestamp}`,
        emailSubject: `${STEM_PREFIX} ${stem}`,
        emailReact: ThresholdAlertEmail({
          trigger: "refund",
          messageBody: stem,
          context: { COMPANY_ID: r.company_id ?? UNKNOWN_LABEL },
          dashboardUrl: DASHBOARD_URL,
        }),
        inAppTitle: stem,
        dedupMs: EVENT_DEDUP_MS,
      })
    );
  }

  // First-ever referral — fire exactly once, when we transition from
  // "zero referrals" (per the prior snapshot) to "at least one new referral
  // in the last 15 min". Only the first row triggers; subsequent referrals
  // in the same window are handled by the normal state-diff path.
  if (firstReferralProspect) {
    const label = (
      firstReferralProspect.company ??
      firstReferralProspect.name ??
      UNKNOWN_LABEL
    ).toUpperCase();
    const stem = `FIRST REFERRAL · ${label}`;
    sends.push(
      sendPmfNotification({
        kind: "threshold_alert",
        trigger: "first_referral",
        smsBody: `${STEM_PREFIX} ${stem} · ${runTimestamp}`,
        emailSubject: `${STEM_PREFIX} ${stem}`,
        emailReact: ThresholdAlertEmail({
          trigger: "first_referral",
          messageBody: stem,
          dashboardUrl: DASHBOARD_URL,
        }),
        inAppTitle: stem,
        dedupMs: EVENT_DEDUP_MS,
      })
    );
  }

  const results = await Promise.allSettled(sends);

  // At-least-once: only mark the window scanned once every event alert either
  // deduped or landed on at least one channel. A total delivery failure holds
  // the cursor so the next run re-scans and retries exactly those alerts.
  const eventResults = results.slice(transitionSendCount);
  const eventDeliveryFailed = eventResults.some(
    (r) =>
      r.status === "rejected" ||
      (!r.value.deduped &&
        r.value.attempted.length > 0 &&
        r.value.failed.length === r.value.attempted.length)
  );
  let cursorAdvanced = false;
  if (!eventDeliveryFailed) {
    await advanceCronWorkloadCursor(
      sb,
      THRESHOLD_WORKLOAD_KEY,
      lease,
      rawCursor,
      JSON.stringify({ eventsThrough: until })
    );
    cursorAdvanced = true;
  }

  return NextResponse.json({
    ok: true,
    transitions: transitions.length,
    inbound: inboundRows.length,
    refunds: refundRows.length,
    sent: sends.length,
    window: { from: since, to: until },
    cursorAdvanced,
    truncated,
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getAdminSupabase();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: sb,
      workloadKey: "pmf-threshold-check",
      leaseSeconds: 90,
      work: (lease) => runThresholdCheck(sb, lease),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    return controlled.value;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "pmf threshold check failed";
    console.error("[pmf-threshold-check] failed:", message, err);
    return NextResponse.json(
      { error: "pmf threshold check failed" },
      { status: 500 }
    );
  }
}

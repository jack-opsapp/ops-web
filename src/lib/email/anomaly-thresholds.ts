/**
 * OPS Email — anomaly thresholds.
 *
 * Pure functions only. No I/O. evaluateThresholds(snapshot) returns the
 * full list of breaches the cron should consider; the cron applies dedup
 * logic and decides which to actually persist.
 */

export const BOUNCE_WARN_PCT = 5;
export const BOUNCE_CRIT_PCT = 10;
export const SPAM_WARN_PCT = 0.1;
export const SPAM_CRIT_PCT = 0.5;
/** Delivered/sent below this percentage in window → delivery_drop. */
export const DELIVERY_WARN_PCT = 80;
/** Delivery rate below this percentage → critical instead of warn. */
export const DELIVERY_CRIT_PCT = 60;
/** Volume <X% of trailing baseline → volume_drop. */
export const VOLUME_DROP_PCT = 10;
/** Volume_drop ratio below this percentage → critical. */
export const VOLUME_CRIT_PCT = 1;
/** Require at least N sends before computing percentage anomalies (suppresses noise). */
export const MIN_SENDS_FOR_PCT = 5;

export type AnomalyKind =
  | "bounce_spike" | "spam_spike" | "delivery_drop" | "volume_drop";
export type AnomalySeverity = "warn" | "critical";

export interface MetricSnapshot {
  windowMinutes: number;
  totalSent: number;
  totalDelivered: number;
  totalBounced: number;
  bouncePct: number;
  totalSpam: number;
  spamPct: number;
  totalOpen: number;
  openPct: number;
  totalClick: number;
  clickPct: number;
  errorEvents: number;
  /** Optional baseline from a longer prior window for volume drop detection. */
  baselineSent?: number;
  baselineWindowMinutes?: number;
}

export interface AnomalyEval {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  metricValue: number;
  threshold: number;
  windowMinutes: number;
  context: Record<string, unknown>;
}

export function evaluateThresholds(s: MetricSnapshot): AnomalyEval[] {
  const out: AnomalyEval[] = [];

  if (s.totalSent >= MIN_SENDS_FOR_PCT) {
    if (s.bouncePct >= BOUNCE_CRIT_PCT) {
      out.push({
        kind: "bounce_spike", severity: "critical",
        metricValue: s.bouncePct, threshold: BOUNCE_CRIT_PCT,
        windowMinutes: s.windowMinutes,
        context: { total_sent: s.totalSent, total_bounced: s.totalBounced, bounce_pct: s.bouncePct },
      });
    } else if (s.bouncePct >= BOUNCE_WARN_PCT) {
      out.push({
        kind: "bounce_spike", severity: "warn",
        metricValue: s.bouncePct, threshold: BOUNCE_WARN_PCT,
        windowMinutes: s.windowMinutes,
        context: { total_sent: s.totalSent, total_bounced: s.totalBounced, bounce_pct: s.bouncePct },
      });
    }
  }

  if (s.totalDelivered >= MIN_SENDS_FOR_PCT) {
    if (s.spamPct >= SPAM_CRIT_PCT) {
      out.push({
        kind: "spam_spike", severity: "critical",
        metricValue: s.spamPct, threshold: SPAM_CRIT_PCT,
        windowMinutes: s.windowMinutes,
        context: { total_delivered: s.totalDelivered, total_spam: s.totalSpam, spam_pct: s.spamPct },
      });
    } else if (s.spamPct >= SPAM_WARN_PCT) {
      out.push({
        kind: "spam_spike", severity: "warn",
        metricValue: s.spamPct, threshold: SPAM_WARN_PCT,
        windowMinutes: s.windowMinutes,
        context: { total_delivered: s.totalDelivered, total_spam: s.totalSpam, spam_pct: s.spamPct },
      });
    }
  }

  if (s.totalSent >= MIN_SENDS_FOR_PCT) {
    const deliveryPct = (s.totalDelivered / Math.max(s.totalSent, 1)) * 100;
    if (deliveryPct < DELIVERY_WARN_PCT) {
      out.push({
        kind: "delivery_drop",
        severity: deliveryPct < DELIVERY_CRIT_PCT ? "critical" : "warn",
        metricValue: deliveryPct, threshold: DELIVERY_WARN_PCT,
        windowMinutes: s.windowMinutes,
        context: { total_sent: s.totalSent, total_delivered: s.totalDelivered, delivery_pct: deliveryPct },
      });
    }
  }

  if (s.baselineSent !== undefined && s.baselineSent > 0) {
    const ratio = (s.totalSent / s.baselineSent) * 100;
    if (ratio < VOLUME_DROP_PCT) {
      out.push({
        kind: "volume_drop",
        severity: ratio < VOLUME_CRIT_PCT ? "critical" : "warn",
        metricValue: ratio, threshold: VOLUME_DROP_PCT,
        windowMinutes: s.windowMinutes,
        context: {
          total_sent: s.totalSent,
          baseline_sent: s.baselineSent,
          baseline_window_minutes: s.baselineWindowMinutes,
        },
      });
    }
  }

  return out;
}

export function severityRank(s: AnomalySeverity): number {
  return s === "critical" ? 2 : 1;
}

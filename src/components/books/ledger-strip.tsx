"use client";

/**
 * Books ledger strip — the unified MetricsStrip treatment (WEB OVERHAUL P6-2).
 *
 * Four cells — NET / CASH FLOW / A/R / JOBS — translating the iOS Books Mission
 * Deck card faces to desktop. NET, CASH FLOW and JOBS follow the selected period;
 * A/R is always all-open (the period pill re-scopes the rest).
 *
 * P6-2: the glance-tile deck (InstrumentStrip + bespoke MarginMeter / WeeklySparkline
 * / AgingRamp / DivergingBars) is retired in favor of the shared `MetricsStrip` so
 * Books reads identically to every other list surface — a thin pinned strip of
 * hairline-divided cells, each with a per-cell mini-viz from the shared StripViz
 * vocabulary (meter / sparkline / ramp). The data layer (`useBooksLedger`) and the
 * PeriodPill are unchanged; this strip lives in a TableShell's metrics slot.
 *
 * Approved pixels (original deck): docs/design/2026-06-11-books-mockups/direction-a-instrument-strip.html
 */

import { useMemo, type ReactNode } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { useBooksLedger } from "@/lib/hooks";
import type { BooksPeriod } from "@/lib/api/services/books-service";
import { MetricsStrip, type MetricCell } from "@/components/ui/metrics-strip";
import { PeriodPill } from "./period-pill";

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Whole-dollar display ("$48,210", "−$2,140"); `—` is the caller's empty.
 *  Locale-aware: figures follow the active app locale, never hardcoded. */
function fmtMoney(
  value: number,
  locale: string,
  { signed = false } = {},
): string {
  const abs = Math.abs(value);
  const body = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(abs);
  if (value < 0) return `−${body}`;
  return signed && value > 0 ? `+${body}` : body;
}

// ─── Strip ────────────────────────────────────────────────────────────────────

export interface LedgerStripProps {
  period: BooksPeriod;
  onPeriodChange: (period: BooksPeriod) => void;
  /** Resolves a client id to a display name (A/R top chase). */
  clientName?: (clientId: string) => string | undefined;
  /**
   * Invoices-only enrichment of the A/R cell sub — collection-health readouts
   * (collected / collection rate / avg days to pay) that folded up out of the
   * retired invoices statline (REWORK 7). When set, it takes the A/R sub's
   * second slot in place of the top-chase hint (the chase client is still
   * discoverable in the A/R aging view). A/R is all-open and these are
   * company-wide all-invoices figures, so they read consistently.
   */
  arExtra?: ReactNode;
}

export function LedgerStrip({ period, onPeriodChange, clientName, arExtra }: LedgerStripProps) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const { data, isLoading, isError, refetch } = useBooksLedger(period);

  const pill = <PeriodPill value={period} onChange={onPeriodChange} />;

  const metrics = useMemo<MetricCell[]>(() => {
    if (!data) return [];

    // ── NET ── period net, margin meter, in/out split.
    const netCell: MetricCell = {
      label: t("ledger.net"),
      value: data.net,
      format: (n) => fmtMoney(n, numLocale),
      tone: data.net < 0 ? "rose" : "default",
      viz: { type: "meter", pct: data.marginPct / 100, color: "var(--olive)" },
      breakdown: `${fmtMoney(data.paymentsIn, numLocale)} in − ${fmtMoney(data.expensesOut, numLocale)} out`,
      sub: (
        <span className="flex gap-[14px]">
          <span className="text-olive">
            {t("ledger.in")}&nbsp;{fmtMoney(data.paymentsIn, numLocale)}
          </span>
          <span className="text-rose">
            {t("ledger.out")}&nbsp;{fmtMoney(data.expensesOut, numLocale)}
          </span>
        </span>
      ),
    };

    // ── CASH FLOW ── signed avg/wk, weekly-net sparkline, low-week line.
    const hasWeeks = data.weeklyNets.length > 0;
    const cashCell: MetricCell = {
      label: t("ledger.cashflow"),
      value: hasWeeks ? data.avgPerWeek : "—",
      format: (n) => fmtMoney(n, numLocale, { signed: true }),
      viz: { type: "sparkline", data: data.weeklyNets.map((w) => w.net), color: "var(--text-2)" },
      breakdown: hasWeeks ? `avg across ${data.weeklyNets.length} weeks` : undefined,
      sub: data.lowWeek ? (
        <>
          {t("ledger.lowWk")}{" "}
          <span className={data.lowWeek.net < 0 ? "text-rose" : "text-text-2"}>
            {fmtMoney(data.lowWeek.net, numLocale, { signed: true })}
          </span>
          {" · "}
          {t("ledger.weeks", { n: data.weeklyNets.length })}
        </>
      ) : (
        "—"
      ),
    };

    // ── A/R ── all-open total, aging ramp (token-traced buckets), overdue +
    //    top-chase line. Drill → overdue invoices filter.
    const b = data.ar.buckets;
    const arCell: MetricCell = {
      label: t("ledger.ar"),
      value: data.ar.total,
      format: (n) => fmtMoney(n, numLocale),
      viz: {
        type: "ramp",
        segments: [
          { value: b.b0_30, color: "var(--color-financial-current)" },
          { value: b.b31_60, color: "var(--tan)" },
          { value: b.b61_90, color: "var(--color-financial-receivables)" },
          { value: b.b90p, color: "var(--rose)" },
        ],
      },
      breakdown: `${fmtMoney(data.ar.overdueTotal, numLocale)} overdue ÷ ${fmtMoney(data.ar.total, numLocale)} open`,
      sub: (
        <>
          {t("ledger.overdue")}{" "}
          <span className="text-rose">{fmtMoney(data.ar.overdueTotal, numLocale)}</span>
          {arExtra ? (
            <>
              {" · "}
              {arExtra}
            </>
          ) : data.ar.topChase && clientName?.(data.ar.topChase.clientId) ? (
            <>
              {" · "}
              {t("ledger.topChase")}{" "}
              <span className="uppercase text-text-2">
                {clientName(data.ar.topChase.clientId)}
              </span>
            </>
          ) : null}
        </>
      ),
    };

    // ── JOBS ── profitable count, avg-margin meter, losers line.
    const jobsCell: MetricCell = {
      label: t("ledger.jobs"),
      value: data.jobs.profitable,
      tone: "olive",
      viz: { type: "meter", pct: data.jobs.avgMarginPct / 100, color: "var(--olive)" },
      breakdown: `${data.jobs.profitable} profitable · ${data.jobs.losers} losing`,
      sub: (
        <>
          {t("ledger.avgMargin")}{" "}
          <span className="text-text-2">{Math.round(data.jobs.avgMarginPct)}%</span>
          {" · "}
          {data.jobs.losers === 1
            ? t("ledger.oneLoser")
            : t("ledger.losers", { n: data.jobs.losers })}
        </>
      ),
    };

    return [netCell, cashCell, arCell, jobsCell];
  }, [data, numLocale, clientName, arExtra, t]);

  // Error → a compact bordered row (matches the workbar/strip chrome height) with
  // the failure note, a retry, and the period pill held at the right.
  if (isError || (!isLoading && !data)) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-rose">
          <span aria-hidden className="text-text-mute">{"// "}</span>
          {t("ledger.error")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded border border-border px-1.5 py-[5px] font-cakemono text-button-sm font-light uppercase text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text"
          >
            {t("ledger.retry")}
          </button>
          {pill}
        </div>
      </div>
    );
  }

  return (
    <MetricsStrip
      metrics={metrics}
      right={pill}
      isLoading={isLoading}
      ariaLabel={t("ledger.title")}
    />
  );
}

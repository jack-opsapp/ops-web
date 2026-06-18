"use client";

/**
 * Books ledger strip (WEB OVERHAUL P3.1, direction A "Instrument Strip").
 *
 * Four glance tiles — NET / CASH FLOW / A/R / JOBS — translating the iOS
 * Books Mission Deck card faces to desktop. NET, CASH FLOW and JOBS follow
 * the selected period; A/R is always all-open (scope badge says so).
 * Approved pixels: docs/design/2026-06-11-books-mockups/direction-a-instrument-strip.html
 */

import { useEffect, useMemo, useRef } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { useBooksLedger } from "@/lib/hooks";
import type { BooksLedger, BooksPeriod } from "@/lib/api/services/books-service";
import { useReducedMotion } from "@/components/dashboard/widgets/shared/use-reduced-motion";
import { PeriodPill } from "./period-pill";
import { cn } from "@/lib/utils/cn";
import {
  InstrumentStrip,
  GlanceGrid,
  GlanceTile,
  TileHero,
  TileSub,
  ScopeBadge,
  GlanceTileSkeleton,
  useCountUp,
} from "@/components/ui/instrument-strip";

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

function fmtPct(value: number): string {
  return `${Math.round(value)}%`;
}

// ─── Mini-viz ─────────────────────────────────────────────────────────────────

function MarginMeter({ pct, animate }: { pct: number; animate: boolean }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="my-[10px] h-[4px] overflow-hidden rounded-[2px] bg-fill-neutral-dim">
      <div
        className="h-full rounded-[2px] bg-olive"
        style={{
          width: `${width}%`,
          transition: animate ? "width 600ms var(--ease-smooth)" : "none",
        }}
      />
    </div>
  );
}

function WeeklySparkline({ weeks }: { weeks: BooksLedger["weeklyNets"] }) {
  const W = 200;
  const H = 30;
  const pathRef = useRef<SVGPolylineElement>(null);
  const reduced = useReducedMotion();

  const { points, dip } = useMemo(() => {
    if (weeks.length < 2) return { points: "", dip: null as { x: number; y: number } | null };
    const nets = weeks.map((w) => w.net);
    const min = Math.min(...nets);
    const max = Math.max(...nets);
    const span = max - min || 1;
    const coords = nets.map((n, i) => ({
      x: (i / (nets.length - 1)) * W,
      y: H - 4 - ((n - min) / span) * (H - 8),
    }));
    const lowIdx = nets.indexOf(min);
    return {
      points: coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" "),
      dip: min < 0 ? coords[lowIdx] : null,
    };
  }, [weeks]);

  // Draw-on entrance (600ms, single easing curve); skipped under reduced motion.
  useEffect(() => {
    const el = pathRef.current;
    if (!el || reduced || !points) return;
    const length = el.getTotalLength();
    el.style.strokeDasharray = `${length}`;
    el.style.strokeDashoffset = `${length}`;
    el.getBoundingClientRect();
    el.style.transition = "stroke-dashoffset 600ms var(--ease-smooth)";
    el.style.strokeDashoffset = "0";
  }, [points, reduced]);

  if (!points) {
    return (
      <div className="my-[10px] flex h-[30px] items-center font-mono text-micro text-text-mute">
        —
      </div>
    );
  }

  return (
    <svg
      className="my-[10px] w-full text-text-3"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-hidden
    >
      <polyline
        ref={pathRef}
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {dip && <circle cx={dip.x} cy={dip.y} r="2.5" className="fill-rose" />}
    </svg>
  );
}

// Aging ramp classes trace to tokens: tan / fin-receivables / rose / brick.
const RAMP_CLASSES = ["bg-tan", "bg-financial-receivables", "bg-rose", "bg-financial-overdue"];

function AgingRamp({ buckets, animate }: { buckets: BooksLedger["ar"]["buckets"]; animate: boolean }) {
  const values = [buckets.b0_30, buckets.b31_60, buckets.b61_90, buckets.b90p];
  const max = Math.max(...values, 1);
  return (
    <div className="my-[10px] flex h-[30px] items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn("block flex-1 rounded-t-[2px]", RAMP_CLASSES[i])}
          style={{
            height: `${Math.max(v > 0 ? 8 : 4, (v / max) * 100)}%`,
            opacity: v > 0 ? 1 : 0.25,
            transition: animate
              ? `height 500ms var(--ease-smooth) ${i * 50}ms`
              : "none",
          }}
        />
      ))}
    </div>
  );
}

function DivergingBars({
  bars,
  animate,
  numLocale,
}: {
  bars: BooksLedger["jobs"]["bars"];
  animate: boolean;
  numLocale: string;
}) {
  const max = Math.max(...bars.map((b) => Math.abs(b.net)), 1);
  return (
    <div className="my-[10px] flex h-[30px] flex-col justify-center gap-[4px]" aria-hidden>
      {bars.length === 0 ? (
        <span className="font-mono text-micro text-text-mute">—</span>
      ) : (
        bars.map((b, i) => {
          const widthPct = (Math.abs(b.net) / max) * 46;
          const positive = b.net >= 0;
          return (
            <span key={b.projectId} className="relative flex h-[6px] items-center">
              <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
              <span
                className={cn("block h-[4px] rounded-[2px]", positive ? "bg-olive" : "bg-rose")}
                style={{
                  width: `${Math.max(widthPct, 2)}%`,
                  marginLeft: positive ? "50%" : `${50 - Math.max(widthPct, 2)}%`,
                  transition: animate
                    ? `width 500ms var(--ease-smooth) ${i * 50}ms`
                    : "none",
                }}
                title={`${b.title} ${fmtMoney(b.net, numLocale, { signed: true })}`}
              />
            </span>
          );
        })
      )}
    </div>
  );
}

// ─── Strip ────────────────────────────────────────────────────────────────────

export interface LedgerStripProps {
  period: BooksPeriod;
  onPeriodChange: (period: BooksPeriod) => void;
  /** A/R tile drill → invoices segment filtered to past due. */
  onDrillOverdue?: () => void;
  /** Resolves a client id to a display name (A/R top chase). */
  clientName?: (clientId: string) => string | undefined;
}

export function LedgerStrip({ period, onPeriodChange, onDrillOverdue, clientName }: LedgerStripProps) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const { data, isLoading, isError, refetch } = useBooksLedger(period);
  const reduced = useReducedMotion();
  const animate = !reduced;

  const net = useCountUp(data?.net ?? 0, animate && !!data);
  const arTotal = useCountUp(data?.ar.total ?? 0, animate && !!data);

  return (
    <InstrumentStrip
      label={t("ledger.title")}
      right={<PeriodPill value={period} onChange={onPeriodChange} />}
    >
      {isLoading ? (
        <GlanceGrid className="grid-cols-2 xl:grid-cols-4">
          <GlanceTileSkeleton />
          <GlanceTileSkeleton />
          <GlanceTileSkeleton />
          <GlanceTileSkeleton />
        </GlanceGrid>
      ) : isError || !data ? (
        <div className="glass-surface flex min-h-[80px] items-center justify-between px-[18px] pb-[12px] pt-[14px]">
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-rose">
            <span className="text-text-mute">{"// "}</span>
            {t("ledger.error")}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded border border-border px-1.5 py-[5px] font-cakemono text-button-sm font-light uppercase text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text"
          >
            {t("ledger.retry")}
          </button>
        </div>
      ) : (
        <GlanceGrid className="grid-cols-2 xl:grid-cols-4">
          {/* ── NET ── */}
          <GlanceTile
            label={t("ledger.net")}
            right={
              <span className="font-mono text-micro text-text-3 tabular-nums">
                {t("ledger.margin", { pct: fmtPct(data.marginPct) })}
              </span>
            }
          >
            <TileHero>{fmtMoney(net, numLocale)}</TileHero>
            <MarginMeter pct={data.marginPct} animate={animate} />
            <TileSub>
              <span className="flex gap-[14px]">
                <span className="text-olive">
                  {t("ledger.in")}&nbsp;{fmtMoney(data.paymentsIn, numLocale)}
                </span>
                <span className="text-rose">
                  {t("ledger.out")}&nbsp;{fmtMoney(data.expensesOut, numLocale)}
                </span>
              </span>
            </TileSub>
          </GlanceTile>

          {/* ── CASH FLOW ── */}
          <GlanceTile label={t("ledger.cashflow")}>
            <TileHero>
              {data.weeklyNets.length === 0 ? "—" : fmtMoney(data.avgPerWeek, numLocale, { signed: true })}
              {data.weeklyNets.length > 0 && (
                <span className="ml-0.5 text-micro text-text-3">
                  {t("ledger.avgWk")}
                </span>
              )}
            </TileHero>
            <WeeklySparkline weeks={data.weeklyNets} />
            <TileSub>
              {data.lowWeek ? (
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
              )}
            </TileSub>
          </GlanceTile>

          {/* ── A/R ── */}
          <GlanceTile
            label={t("ledger.ar")}
            right={<ScopeBadge>{t("ledger.allOpen")}</ScopeBadge>}
            onClick={onDrillOverdue}
          >
            <TileHero>{fmtMoney(arTotal, numLocale)}</TileHero>
            <AgingRamp buckets={data.ar.buckets} animate={animate} />
            <TileSub>
              {t("ledger.overdue")}{" "}
              <span className="text-rose">{fmtMoney(data.ar.overdueTotal, numLocale)}</span>
              {data.ar.topChase && clientName?.(data.ar.topChase.clientId) ? (
                <>
                  {" · "}
                  {t("ledger.topChase")}{" "}
                  <span className="uppercase text-text-2">
                    {clientName(data.ar.topChase.clientId)}
                  </span>
                </>
              ) : null}
            </TileSub>
          </GlanceTile>

          {/* ── JOBS ── */}
          <GlanceTile label={t("ledger.jobs")}>
            <TileHero>
              {data.jobs.profitable}
              <span className="ml-0.5 text-micro text-text-3">
                {t("ledger.profitable")}
              </span>
            </TileHero>
            <DivergingBars bars={data.jobs.bars} animate={animate} numLocale={numLocale} />
            <TileSub>
              {t("ledger.avgMargin")}{" "}
              <span className="text-text-2">{fmtPct(data.jobs.avgMarginPct)}</span>
              {" · "}
              {data.jobs.losers === 1
                ? t("ledger.oneLoser")
                : t("ledger.losers", { n: data.jobs.losers })}
            </TileSub>
          </GlanceTile>
        </GlanceGrid>
      )}
    </InstrumentStrip>
  );
}

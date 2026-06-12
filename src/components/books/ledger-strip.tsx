"use client";

/**
 * Books ledger strip (WEB OVERHAUL P3.1, direction A "Instrument Strip").
 *
 * Four glance tiles — NET / CASH FLOW / A/R / JOBS — translating the iOS
 * Books Mission Deck card faces to desktop. NET, CASH FLOW and JOBS follow
 * the selected period; A/R is always all-open (scope badge says so).
 * Approved pixels: docs/design/2026-06-11-books-mockups/direction-a-instrument-strip.html
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { useBooksLedger } from "@/lib/hooks";
import type { BooksLedger, BooksPeriod } from "@/lib/api/services/books-service";
import { useReducedMotion } from "@/components/dashboard/widgets/shared/use-reduced-motion";
import { PeriodPill } from "./period-pill";
import { cn } from "@/lib/utils/cn";

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Whole-dollar display ("$48,210", "−$2,140"); `—` is the caller's empty. */
function fmtMoney(value: number, { signed = false } = {}): string {
  const abs = Math.abs(value);
  const body = new Intl.NumberFormat("en-US", {
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

// ─── Count-up (800ms hero count-up, exact EASE_SMOOTH, reduced-motion aware) ──

function useCountUp(target: number, enabled: boolean, duration = 800): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const prev = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const from = prev.current;
    prev.current = target;
    // framer-motion evaluates the real cubic-bezier(0.22, 1, 0.36, 1) — one
    // easing curve everywhere (DESIGN.md §8), no hand-rolled approximation.
    const controls = animate(from, target, {
      duration: duration / 1000,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [target, enabled, duration]);

  return value;
}

// ─── Tile shell ───────────────────────────────────────────────────────────────

function TileShell({
  label,
  right,
  onClick,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        // SM widget zone: 14px top / 18px sides / 12px bottom (DESIGN.md §7).
        "glass-surface flex min-h-[132px] flex-col px-[18px] pb-[12px] pt-[14px] text-left",
        onClick &&
          "cursor-pointer transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {label}
        </span>
        {right}
      </div>
      {children}
    </Tag>
  );
}

function TileHero({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-data-lg leading-tight text-text tabular-nums">
      {children}
    </span>
  );
}

function TileSub({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-auto font-mono text-micro tracking-[0.06em] text-text-3 tabular-nums">
      {children}
    </div>
  );
}

function ScopeBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[4px] border border-border px-[5px] py-px font-mono text-micro uppercase tracking-[0.14em] text-text-3">
      {children}
    </span>
  );
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

function DivergingBars({ bars, animate }: { bars: BooksLedger["jobs"]["bars"]; animate: boolean }) {
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
                title={`${b.title} ${fmtMoney(b.net, { signed: true })}`}
              />
            </span>
          );
        })
      )}
    </div>
  );
}

// ─── Skeleton / error ─────────────────────────────────────────────────────────

function TileSkeleton() {
  return (
    <div className="glass-surface min-h-[132px] animate-pulse px-[18px] pb-[12px] pt-[14px] motion-reduce:animate-none">
      <div className="mb-2 h-[11px] w-[72px] rounded bg-fill-neutral-dim" />
      <div className="mb-2 h-[24px] w-[120px] rounded bg-fill-neutral-dim" />
      <div className="mb-2 h-[16px] w-full rounded bg-fill-neutral-dim/60" />
      <div className="h-[11px] w-[140px] rounded bg-fill-neutral-dim" />
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
  const { data, isLoading, isError, refetch } = useBooksLedger(period);
  const reduced = useReducedMotion();
  const animate = !reduced;

  const net = useCountUp(data?.net ?? 0, animate && !!data);
  const arTotal = useCountUp(data?.ar.total ?? 0, animate && !!data);

  return (
    <section aria-label={t("ledger.title")}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("ledger.title")}
        </span>
        <PeriodPill value={period} onChange={onPeriodChange} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <TileSkeleton />
          <TileSkeleton />
          <TileSkeleton />
          <TileSkeleton />
        </div>
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
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {/* ── NET ── */}
          <TileShell
            label={t("ledger.net")}
            right={
              <span className="font-mono text-micro text-text-3 tabular-nums">
                {t("ledger.margin", { pct: fmtPct(data.marginPct) })}
              </span>
            }
          >
            <TileHero>{fmtMoney(net)}</TileHero>
            <MarginMeter pct={data.marginPct} animate={animate} />
            <TileSub>
              <span className="flex gap-[14px]">
                <span className="text-olive">
                  {t("ledger.in")}&nbsp;{fmtMoney(data.paymentsIn)}
                </span>
                <span className="text-rose">
                  {t("ledger.out")}&nbsp;{fmtMoney(data.expensesOut)}
                </span>
              </span>
            </TileSub>
          </TileShell>

          {/* ── CASH FLOW ── */}
          <TileShell label={t("ledger.cashflow")}>
            <TileHero>
              {data.weeklyNets.length === 0 ? "—" : fmtMoney(data.avgPerWeek, { signed: true })}
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
                    {fmtMoney(data.lowWeek.net, { signed: true })}
                  </span>
                  {" · "}
                  {t("ledger.weeks", { n: data.weeklyNets.length })}
                </>
              ) : (
                "—"
              )}
            </TileSub>
          </TileShell>

          {/* ── A/R ── */}
          <TileShell
            label={t("ledger.ar")}
            right={<ScopeBadge>{t("ledger.allOpen")}</ScopeBadge>}
            onClick={onDrillOverdue}
          >
            <TileHero>{fmtMoney(arTotal)}</TileHero>
            <AgingRamp buckets={data.ar.buckets} animate={animate} />
            <TileSub>
              {t("ledger.overdue")}{" "}
              <span className="text-rose">{fmtMoney(data.ar.overdueTotal)}</span>
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
          </TileShell>

          {/* ── JOBS ── */}
          <TileShell label={t("ledger.jobs")}>
            <TileHero>
              {data.jobs.profitable}
              <span className="ml-0.5 text-micro text-text-3">
                {t("ledger.profitable")}
              </span>
            </TileHero>
            <DivergingBars bars={data.jobs.bars} animate={animate} />
            <TileSub>
              {t("ledger.avgMargin")}{" "}
              <span className="text-text-2">{fmtPct(data.jobs.avgMarginPct)}</span>
              {" · "}
              {data.jobs.losers === 1
                ? t("ledger.oneLoser")
                : t("ledger.losers", { n: data.jobs.losers })}
            </TileSub>
          </TileShell>
        </div>
      )}
    </section>
  );
}

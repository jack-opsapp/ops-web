"use client";

/**
 * Catalog supply strip — three glance tiles, each an owner QUESTION answered
 * with a working pivot (Direction D). Motion mirrors the approved Books
 * ledger-strip: 800ms count-up + bar grow on the single EASE_SMOOTH curve,
 * reduced-motion → instant. Honest zero states: uncosted tenants see `—`
 * heroes, never fake zeroes.
 */

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { fmtMoney, fmtMargin } from "./format";
import type { StockHealth, OnHand } from "@/lib/hooks/use-catalog-stock";

export interface ProductAggregate {
  avgMargin: number | null;
  missingCost: number;
  active: number;
  configured: number;
  total: number;
}

// ─── Count-up (reduced-motion aware) ───────────────────────────────────────────

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
    let start: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - (1 - p) * (1 - p);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);
  return value;
}

// ─── Tile shell ────────────────────────────────────────────────────────────────

function Tile({
  label,
  cta,
  onClick,
  children,
}: {
  label: string;
  cta?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "glass-surface flex min-h-[132px] flex-col px-[18px] pb-[14px] pt-[16px] text-left",
        onClick &&
          "cursor-pointer transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {label}
        </span>
        {cta && (
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 tabular-nums">
            {cta}
          </span>
        )}
      </div>
      {children}
    </Tag>
  );
}

function Hero({ tone, children }: { tone?: "rose" | "olive"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-mono text-[22px] font-semibold leading-tight tabular-nums",
        tone === "rose" ? "text-rose" : tone === "olive" ? "text-olive" : "text-text",
      )}
    >
      {children}
    </span>
  );
}

function HeroUnit({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-[6px] font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
      {children}
    </span>
  );
}

function Mid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 tabular-nums">
      {children}
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-auto font-mono text-[11px] tracking-[0.06em] text-text-3 tabular-nums">
      {children}
    </div>
  );
}

function HealthBar({
  health,
  animate,
}: {
  health: StockHealth;
  animate: boolean;
}) {
  const total = Math.max(health.total, 1);
  const seg = (n: number, color: string, opacity = 1) => (
    <div
      className="h-full"
      style={{
        width: `${(n / total) * 100}%`,
        backgroundColor: color,
        opacity,
        borderRadius: "2px",
        transition: animate ? "width 600ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
      }}
    />
  );
  return (
    <div className="mt-[10px] flex h-[4px] gap-[2px] overflow-hidden rounded-[2px]">
      {seg(health.ok, "var(--olive)", 0.75)}
      {seg(health.low, "var(--tan)")}
      {seg(health.critical, "var(--rose)")}
      {seg(health.untracked, "var(--fill-neutral-dim)")}
    </div>
  );
}

function Meter({ pct, animate }: { pct: number; animate: boolean }) {
  return (
    <div className="mt-[10px] h-[4px] overflow-hidden rounded-[2px] bg-fill-neutral-dim">
      <div
        className="h-full rounded-[2px] bg-fill-neutral"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          transition: animate ? "width 600ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
      />
    </div>
  );
}

// ─── Strip ───────────────────────────────────────────────────────────────────

export interface SupplyStripProps {
  loading: boolean;
  health: StockHealth;
  onHand: OnHand;
  lastCountDate: string | null;
  product: ProductAggregate | null;
  showStock: boolean;
  showProducts: boolean;
  onDrillBelowThreshold?: () => void;
  onOpenCounts?: () => void;
  onFixCosts?: () => void;
}

function TileSkeleton() {
  return (
    <div className="glass-surface min-h-[132px] animate-pulse px-[18px] pb-[14px] pt-[16px]">
      <div className="mb-2 h-[11px] w-[88px] rounded bg-fill-neutral-dim" />
      <div className="mb-2 h-[22px] w-[120px] rounded bg-fill-neutral-dim" />
      <div className="mb-2 h-[4px] w-full rounded bg-fill-neutral-dim/60" />
      <div className="h-[11px] w-[150px] rounded bg-fill-neutral-dim" />
    </div>
  );
}

export function SupplyStrip({
  loading,
  health,
  onHand,
  lastCountDate,
  product,
  showStock,
  showProducts,
  onDrillBelowThreshold,
  onOpenCounts,
  onFixCosts,
}: SupplyStripProps) {
  const { t } = useDictionary("catalog");
  const reduced = useReducedMotion();
  const animate = !reduced && !loading;

  const belowCount = useCountUp(health.belowThreshold, animate && showStock);
  const onHandValue = useCountUp(onHand.value, animate && showStock);
  const avgMargin = product?.avgMargin ?? null;

  const tileCount = (showStock ? 2 : 0) + (showProducts ? 1 : 0);
  const gridCols =
    tileCount >= 3 ? "md:grid-cols-3" : tileCount === 2 ? "md:grid-cols-2" : "md:grid-cols-1";

  return (
    <section aria-label={t("supply.title", "SUPPLY")}>
      <div className="mb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("supply.title", "SUPPLY")}
        </span>
      </div>

      {loading ? (
        <div className={cn("grid grid-cols-1 gap-4", gridCols)}>
          {Array.from({ length: tileCount }).map((_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className={cn("grid grid-cols-1 gap-4", gridCols)}>
          {/* ── STOCK HEALTH ── */}
          {showStock && (
            <Tile
              label={t("tile.stockHealth", "STOCK HEALTH")}
              cta={
                health.untracked > 0 && health.belowThreshold === 0
                  ? `[${t("tile.setThresholds", "SET THRESHOLDS")} →]`
                  : `[${t("tile.review", "REVIEW")} →]`
              }
              onClick={onDrillBelowThreshold}
            >
              {health.belowThreshold > 0 ? (
                <Hero tone="rose">
                  {Math.round(belowCount)}
                  <HeroUnit>{t("tile.belowThreshold", "BELOW THRESHOLD")}</HeroUnit>
                </Hero>
              ) : (
                <Hero>{t("tile.nominal", "NOMINAL")}</Hero>
              )}
              <HealthBar health={health} animate={animate} />
              {health.worst && (
                <Mid>
                  {t("tile.worst", "WORST")} ::{" "}
                  {[health.worst.familyName, health.worst.variantLabel]
                    .filter(Boolean)
                    .join(" · ")
                    .toUpperCase()}{" "}
                  <span className="text-rose">{t("tile.at", { n: health.worst.quantity })}</span>
                </Mid>
              )}
              <Sub>
                <span className="text-rose">{t("tile.critical", { n: health.critical })}</span>
                {" · "}
                <span className="text-tan">{t("tile.low", { n: health.low })}</span>
                {" · "}
                {t("tile.ok", { n: health.ok })}
                {health.untracked > 0 && <> {" · "}{t("tile.untracked", { n: health.untracked })}</>}
              </Sub>
            </Tile>
          )}

          {/* ── ON-HAND ── */}
          {showStock && (
            <Tile
              label={t("tile.onHand", "ON-HAND")}
              cta={`[${t("tile.counts", "COUNTS")} →]`}
              onClick={onOpenCounts}
            >
              {onHand.costedCount > 0 ? (
                <Hero>{fmtMoney(onHandValue)}</Hero>
              ) : (
                <Hero>—</Hero>
              )}
              <Meter
                pct={onHand.total > 0 ? (onHand.costedCount / onHand.total) * 100 : 0}
                animate={animate}
              />
              <Mid>
                {onHand.costedCount > 0
                  ? t("tile.costedOf", { costed: onHand.costedCount, total: onHand.total })
                  : t("tile.noneCosted", "NO COSTS SET")}
              </Mid>
              <Sub>
                {lastCountDate
                  ? t("tile.lastCount", { date: lastCountDate })
                  : t("tile.noSnapshots", "NO COUNTS SAVED")}
              </Sub>
            </Tile>
          )}

          {/* ── PRODUCTS ── */}
          {showProducts && product && (
            <Tile
              label={t("tile.products", "PRODUCTS")}
              cta={`[${t("tile.fixCosts", "FIX COSTS")} →]`}
              onClick={onFixCosts}
            >
              {avgMargin != null ? (
                <Hero tone="olive">
                  {fmtMargin(avgMargin)}
                  <HeroUnit>{t("tile.avgMargin", "AVG MARGIN")}</HeroUnit>
                </Hero>
              ) : (
                <Hero>—</Hero>
              )}
              <Meter
                pct={product.total > 0 ? (product.active / product.total) * 100 : 0}
                animate={animate}
              />
              <Mid>
                {product.missingCost > 0 ? (
                  <span className="text-rose">{t("tile.missingCost", { n: product.missingCost })}</span>
                ) : (
                  <span>&nbsp;</span>
                )}
              </Mid>
              <Sub>
                {t("tile.activeOptions", { active: product.active, configured: product.configured })}
              </Sub>
            </Tile>
          )}
        </div>
      )}
    </section>
  );
}

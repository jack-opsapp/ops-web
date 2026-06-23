"use client";

/**
 * Catalog supply strip — three glance tiles, each an owner QUESTION answered
 * with a working pivot (Direction D). Built on the shared instrument-strip
 * primitive (@/components/ui/instrument-strip) so it stays pixel-aligned with
 * the canonical Books `// LEDGER` strip: same glass shell, `text-data-lg` hero,
 * `gap-2` grid, and the one shared `useCountUp` (800ms on the single EASE_SMOOTH
 * curve, reduced-motion → instant). Honest zero states: uncosted tenants see
 * `—` heroes, never fake zeroes. The health/coverage mini-viz stays per-surface.
 */

import type { ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { fmtMoney, fmtMargin } from "./format";
import type { StockHealth, OnHand } from "@/lib/hooks/use-catalog-stock";
import {
  InstrumentStrip,
  GlanceGrid,
  GlanceTile,
  TileHero,
  TileSub,
  GlanceTileSkeleton,
  useCountUp,
} from "@/components/ui/instrument-strip";

export interface ProductAggregate {
  avgMargin: number | null;
  missingCost: number;
  active: number;
  configured: number;
  total: number;
}

// ─── Tile atoms (Catalog-specific; shell / hero / sub come from the primitive) ──

/** Right-aligned drill hint in a tile header ("[REVIEW →]"). */
function CtaHint({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-3 tabular-nums">
      {children}
    </span>
  );
}

/** Unit suffix trailing a hero figure ("BELOW THRESHOLD", "AVG MARGIN"). */
function HeroUnit({ children }: { children: ReactNode }) {
  return (
    <span className="ml-[6px] font-mono text-micro uppercase tracking-[0.12em] text-text-3">
      {children}
    </span>
  );
}

/** Mid line between hero and sub ("WORST :: …"). */
function Mid({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 font-mono text-micro uppercase tracking-[0.1em] text-text-3 tabular-nums">
      {children}
    </div>
  );
}

// ─── Mini-viz (per-surface) ─────────────────────────────────────────────────────

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
      className="h-full rounded-bar"
      style={{
        width: `${(n / total) * 100}%`,
        backgroundColor: color,
        opacity,
        transition: animate ? "width 600ms var(--ease-smooth)" : "none",
      }}
    />
  );
  return (
    <div className="mt-[10px] flex h-[4px] gap-[2px] overflow-hidden rounded-bar">
      {seg(health.ok, "var(--olive)", 0.75)}
      {seg(health.low, "var(--tan)")}
      {seg(health.critical, "var(--rose)")}
      {seg(health.untracked, "var(--fill-neutral-dim)")}
    </div>
  );
}

function Meter({ pct, animate }: { pct: number; animate: boolean }) {
  return (
    <div className="mt-[10px] h-[4px] overflow-hidden rounded-bar bg-fill-neutral-dim">
      <div
        className="h-full rounded-bar bg-fill-neutral"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          transition: animate ? "width 600ms var(--ease-smooth)" : "none",
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
  const columns = cn(
    "grid-cols-1",
    tileCount >= 3 ? "md:grid-cols-3" : tileCount === 2 ? "md:grid-cols-2" : "md:grid-cols-1",
  );

  return (
    <InstrumentStrip label={t("supply.title", "SUPPLY")}>
      {loading ? (
        <GlanceGrid className={columns}>
          {Array.from({ length: tileCount }).map((_, i) => (
            <GlanceTileSkeleton key={i} />
          ))}
        </GlanceGrid>
      ) : (
        <GlanceGrid className={columns}>
          {/* ── STOCK HEALTH ── */}
          {showStock && (
            <GlanceTile
              label={t("tile.stockHealth", "STOCK HEALTH")}
              right={
                <CtaHint>
                  {health.untracked > 0 && health.belowThreshold === 0
                    ? `[${t("tile.setThresholds", "SET THRESHOLDS")} →]`
                    : `[${t("tile.review", "REVIEW")} →]`}
                </CtaHint>
              }
              onClick={onDrillBelowThreshold}
            >
              {health.belowThreshold > 0 ? (
                <TileHero tone="rose">
                  {Math.round(belowCount)}
                  <HeroUnit>{t("tile.belowThreshold", "BELOW THRESHOLD")}</HeroUnit>
                </TileHero>
              ) : (
                <TileHero>{t("tile.nominal", "NOMINAL")}</TileHero>
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
              <TileSub>
                <span className="text-rose">{t("tile.critical", { n: health.critical })}</span>
                {" · "}
                <span className="text-tan">{t("tile.low", { n: health.low })}</span>
                {" · "}
                {t("tile.ok", { n: health.ok })}
                {health.untracked > 0 && <> {" · "}{t("tile.untracked", { n: health.untracked })}</>}
              </TileSub>
            </GlanceTile>
          )}

          {/* ── ON-HAND ── */}
          {showStock && (
            <GlanceTile
              label={t("tile.onHand", "ON-HAND")}
              right={<CtaHint>{`[${t("tile.counts", "COUNTS")} →]`}</CtaHint>}
              onClick={onOpenCounts}
            >
              {onHand.costedCount > 0 ? (
                <TileHero>{fmtMoney(onHandValue)}</TileHero>
              ) : (
                <TileHero>—</TileHero>
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
              <TileSub>
                {lastCountDate
                  ? t("tile.lastCount", { date: lastCountDate })
                  : t("tile.noSnapshots", "NO COUNTS SAVED")}
              </TileSub>
            </GlanceTile>
          )}

          {/* ── PRODUCTS ── */}
          {showProducts && product && (
            <GlanceTile
              label={t("tile.products", "PRODUCTS")}
              right={<CtaHint>{`[${t("tile.fixCosts", "FIX COSTS")} →]`}</CtaHint>}
              onClick={onFixCosts}
            >
              {avgMargin != null ? (
                <TileHero tone="olive">
                  {fmtMargin(avgMargin)}
                  <HeroUnit>{t("tile.avgMargin", "AVG MARGIN")}</HeroUnit>
                </TileHero>
              ) : (
                <TileHero>—</TileHero>
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
              <TileSub>
                {t("tile.activeOptions", { active: product.active, configured: product.configured })}
              </TileSub>
            </GlanceTile>
          )}
        </GlanceGrid>
      )}
    </InstrumentStrip>
  );
}

"use client";

/**
 * Catalog supply strip — the three owner QUESTIONS (stock health, on-hand value,
 * product margins), each answered with a working drill. Rendered on the unified
 * `MetricsStrip` (WEB OVERHAUL P6-2) so it reads identically to every other table
 * surface: one pinned glass strip of hairline-divided cells with a `// LABEL`,
 * a tabular mono hero, a per-cell mini-viz, and a terse sub line. The strip owns
 * the count-up + reduced-motion handling internally, so no `useCountUp` here.
 *
 * Honest zero states survive: uncosted tenants get `—` heroes (string values),
 * never fake zeroes; a healthy register reads `NOMINAL`, not `0`. The former
 * glance-tile richness (health ramp, coverage/margin meters, worst-variant + cost
 * coverage sub lines) maps 1:1 onto the strip's per-cell viz + sub slots.
 */

import { useMemo, type ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { fmtMoney, fmtMargin } from "./format";
import type { StockHealth, OnHand } from "@/lib/hooks/use-catalog-stock";
import { MetricsStrip, type MetricCell } from "@/components/ui/metrics-strip";

export interface ProductAggregate {
  avgMargin: number | null;
  missingCost: number;
  active: number;
  configured: number;
  total: number;
}

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
  const avgMargin = product?.avgMargin ?? null;

  const cells = useMemo<MetricCell[]>(() => {
    const out: MetricCell[] = [];

    // ── STOCK HEALTH ── below-threshold count (rose when any short); NOMINAL when
    //    clear. Ramp = ok/low/critical/untracked distribution. Sub = the breakdown.
    if (showStock) {
      const healthSub: ReactNode = (
        <>
          <span className="text-rose">{t("tile.critical", { n: health.critical })}</span>
          {" · "}
          <span className="text-tan">{t("tile.low", { n: health.low })}</span>
          {" · "}
          {t("tile.ok", { n: health.ok })}
          {health.untracked > 0 && <> {" · "}{t("tile.untracked", { n: health.untracked })}</>}
        </>
      );
      out.push({
        label: t("tile.stockHealth", "STOCK HEALTH"),
        value: health.belowThreshold > 0 ? health.belowThreshold : t("tile.nominal", "NOMINAL"),
        tone: health.belowThreshold > 0 ? "rose" : "default",
        viz: {
          type: "ramp",
          segments: [
            { value: health.ok, color: "var(--olive)" },
            { value: health.low, color: "var(--tan)" },
            { value: health.critical, color: "var(--rose)" },
            { value: health.untracked, color: "var(--fill-neutral-dim)" },
          ],
        },
        sub: healthSub,
        onClick: onDrillBelowThreshold,
      });

      // ── ON-HAND ── total costed value (— when nothing costed). Meter = costed
      //    coverage ratio. Sub = costed-of / no-costs-set + last-count line.
      const coverage = onHand.total > 0 ? onHand.costedCount / onHand.total : 0;
      const onHandSub: ReactNode = (
        <>
          {onHand.costedCount > 0
            ? t("tile.costedOf", { costed: onHand.costedCount, total: onHand.total })
            : t("tile.noneCosted", "NO COSTS SET")}
          {"  ·  "}
          {lastCountDate
            ? t("tile.lastCount", { date: lastCountDate })
            : t("tile.noSnapshots", "NO COUNTS SAVED")}
        </>
      );
      out.push({
        label: t("tile.onHand", "ON-HAND"),
        value: onHand.costedCount > 0 ? fmtMoney(onHand.value) : "—",
        viz: { type: "meter", pct: coverage, color: "var(--text-2)" },
        sub: onHandSub,
        onClick: onOpenCounts,
      });
    }

    // ── PRODUCTS ── avg margin (— when uncosted). Meter = active share of catalog.
    //    Sub = missing-cost nudge + active/with-options line.
    if (showProducts && product) {
      const activeShare = product.total > 0 ? product.active / product.total : 0;
      const productsSub: ReactNode = (
        <>
          {product.missingCost > 0 && (
            <>
              <span className="text-rose">{t("tile.missingCost", { n: product.missingCost })}</span>
              {"  ·  "}
            </>
          )}
          {t("tile.activeOptions", { active: product.active, configured: product.configured })}
        </>
      );
      out.push({
        label: t("tile.products", "PRODUCTS"),
        value: avgMargin != null ? fmtMargin(avgMargin) : "—",
        tone: avgMargin != null ? "olive" : "default",
        viz: { type: "meter", pct: activeShare, color: "var(--olive)" },
        sub: productsSub,
        onClick: onFixCosts,
      });
    }

    return out;
  }, [
    showStock,
    showProducts,
    product,
    avgMargin,
    health,
    onHand,
    lastCountDate,
    onDrillBelowThreshold,
    onOpenCounts,
    onFixCosts,
    t,
  ]);

  return (
    <MetricsStrip
      metrics={cells}
      isLoading={loading}
      label={t("supply.title", "SUPPLY")}
      ariaLabel={t("supply.title", "SUPPLY")}
    />
  );
}

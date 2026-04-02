"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useAnimatedValue } from "./shared/use-animated-value";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Aging buckets — colors from WT tokens per severity tier
// 31-60 uses WT.cost (muted rose #B58289) for contrast against 1-30 WT.warning
// ---------------------------------------------------------------------------
const BUCKETS = [
  { key: "current", labelKey: "receivablesAging.current", fallback: "Current", min: -Infinity, max: 0, color: WT.accent },
  { key: "1-30", labelKey: "invoiceAging.bucket1to30", fallback: "1-30", min: 1, max: 30, color: WT.warning },
  { key: "31-60", labelKey: "invoiceAging.bucket31to60", fallback: "31-60", min: 31, max: 60, color: WT.cost },
  { key: "61-90", labelKey: "invoiceAging.bucket61to90", fallback: "61-90", min: 61, max: 90, color: WT.errorMuted },
  { key: "90+", labelKey: "invoiceAging.bucket90plus", fallback: "90+", min: 91, max: Infinity, color: WT.error },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ReceivablesAgingWidgetProps {
  size: WidgetSize;
  invoices: Invoice[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ReceivablesAgingWidget({
  size,
  invoices,
  isLoading,
  onNavigate,
}: ReceivablesAgingWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const reducedMotion = useReducedMotion();

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    bucket: string;
    count: number;
    amount: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, bucket: "", count: 0, amount: 0, pct: 0 });

  // ── Compute aging buckets ─────────────────────────────────────────────
  const aging = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const excludeStatuses = new Set([
      InvoiceStatus.Paid, InvoiceStatus.Void, InvoiceStatus.WrittenOff, InvoiceStatus.Draft,
    ]);

    const unpaid = invoices.filter((inv) => !inv.deletedAt && !excludeStatuses.has(inv.status));

    const bucketData = BUCKETS.map((b) => ({
      ...b,
      count: 0,
      amount: 0,
      invoices: [] as Invoice[],
    }));

    for (const inv of unpaid) {
      const due = new Date(inv.dueDate);
      const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const daysOverdue = Math.floor((today.getTime() - dueDay.getTime()) / (1000 * 60 * 60 * 24));

      for (const bucket of bucketData) {
        if (daysOverdue >= bucket.min && daysOverdue <= bucket.max) {
          bucket.count++;
          bucket.amount += inv.balanceDue;
          bucket.invoices.push(inv);
          break;
        }
      }
    }

    const totalAmount = bucketData.reduce((s, b) => s + b.amount, 0);
    const totalCount = bucketData.reduce((s, b) => s + b.count, 0);
    const worstBucket = [...bucketData].reverse().find((b) => b.count > 0);

    return { buckets: bucketData, totalAmount, totalCount, worstBucket };
  }, [invoices]);

  // ── Collected receivables for LG dual graphic ─────────────────────────
  const collectedAmount = useMemo(() => {
    if (!showActions(size)) return 0;
    let total = 0;
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status === InvoiceStatus.Paid && inv.paidAt) {
        total += inv.amountPaid;
      }
    }
    return total;
  }, [invoices, size]);

  const animatedTotal = useAnimatedValue(isVisible ? Math.round(aging.totalAmount) : 0, 1000);
  const heroColor = aging.worstBucket?.color ?? WT.accent;

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (aging.totalCount === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              $0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("receivablesAging.allCurrent") ?? "All invoices current"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("receivablesAging.viewInvoices") ?? "View Invoices"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero = total outstanding, color by severity ───────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices?status=past_due")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span
            className={`font-mono ${formatCompactCurrency(animatedTotal).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none`}
            style={{ color: heroColor }}
          >
            {formatCompactCurrency(animatedTotal)}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("receivablesAging.outstanding") ?? "Outstanding"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + stacked aging bar with hover tooltips ──────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color: heroColor }}>
              {formatCompactCurrency(animatedTotal)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/invoices?status=past_due"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          {/* Row 3: Stacked aging bar with hover tooltips */}
          {aging.totalAmount > 0 && (
            <div className="relative mt-1.5">
              <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
                <TooltipRow label={tooltip.bucket} value={formatCompactCurrency(tooltip.amount)} />
                <TooltipRow label={t("receivablesAging.count") ?? "Count"} value={`${tooltip.count}`} />
                <TooltipRow label={t("receivablesAging.ofTotal") ?? "Of total"} value={`${Math.round(tooltip.pct)}%`} />
              </WidgetTooltip>
              <div className="w-full rounded-sm overflow-hidden flex" style={{ height: "6px" }}>
                {aging.buckets.filter(b => b.amount > 0).map((bucket) => {
                  const pct = (bucket.amount / aging.totalAmount) * 100;
                  return (
                    <div
                      key={bucket.key}
                      className="h-full cursor-pointer"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: bucket.color,
                      }}
                      onMouseEnter={(e) => {
                        const parentRect = ref.current?.getBoundingClientRect();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        if (!parentRect) return;
                        setTooltip({
                          visible: true,
                          x: rect.left - parentRect.left + rect.width / 2,
                          y: rect.top - parentRect.top,
                          bucket: t(bucket.labelKey) ?? bucket.fallback,
                          count: bucket.count,
                          amount: bucket.amount,
                          pct,
                        });
                      }}
                      onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG ───────────────────────────────────────────────────────────
  const nonEmptyBuckets = aging.buckets.filter((b) => b.amount > 0);
  const maxBucketAmount = Math.max(...nonEmptyBuckets.map(b => b.amount), 1);

  // LG: compute collected+outstanding ratio for dual graphic
  const totalCombined = collectedAmount + aging.totalAmount;
  const collectedPct = totalCombined > 0 ? (collectedAmount / totalCombined) * 100 : 0;
  const outstandingPct = totalCombined > 0 ? (aging.totalAmount / totalCombined) * 100 : 0;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {aging.totalCount} · {formatCompactCurrency(aging.totalAmount)}
          </span>
        </div>

        {/* Detail zone */}
        <div className="flex-1 min-h-0 flex flex-col">
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.bucket} value={formatCompactCurrency(tooltip.amount)} />
            <TooltipRow label={t("receivablesAging.count") ?? "Count"} value={`${tooltip.count}`} />
            <TooltipRow label={t("receivablesAging.ofTotal") ?? "Of total"} value={`${Math.round(tooltip.pct)}%`} />
          </WidgetTooltip>

          {/* Vertical bars — fill available height */}
          <div className="flex items-end gap-[6px] flex-1 min-h-[60px]">
            {nonEmptyBuckets.map((bucket, i) => {
              const pct = (bucket.amount / maxBucketAmount) * 100;
              const bucketPctOfTotal = aging.totalAmount > 0 ? (bucket.amount / aging.totalAmount) * 100 : 0;
              return (
                <div
                  key={bucket.key}
                  className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer"
                  onMouseEnter={(e) => {
                    const parentRect = ref.current?.getBoundingClientRect();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (!parentRect) return;
                    setTooltip({
                      visible: true,
                      x: rect.left - parentRect.left + rect.width / 2,
                      y: rect.top - parentRect.top,
                      bucket: t(bucket.labelKey) ?? bucket.fallback,
                      count: bucket.count,
                      amount: bucket.amount,
                      pct: bucketPctOfTotal,
                    });
                  }}
                  onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                >
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: isVisible ? `${pct}%` : "0%",
                      minHeight: bucket.amount > 0 ? "4px" : "0px",
                      backgroundColor: bucket.color,
                      transitionProperty: "height",
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                      transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />
                  <span className="font-kosugi text-micro-sm text-text-disabled mt-1 uppercase">
                    {t(bucket.labelKey) ?? bucket.fallback}
                  </span>
                </div>
              );
            })}
          </div>

          {/* LG: Collected vs Outstanding dual bar */}
          {showActions(size) && totalCombined > 0 && (
            <div className="mt-3 pt-2 border-t border-border-subtle">
              <div className="flex items-center justify-between mb-1">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("receivablesAging.collected") ?? "Collected"} {t("receivablesAging.vsOutstanding") ?? "vs Outstanding"}
                </span>
              </div>
              <div className="flex items-center gap-[2px] w-full h-[12px] rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-l-sm"
                  style={{
                    width: isVisible ? `${collectedPct}%` : "0%",
                    backgroundColor: WT.success,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
                <div
                  className="h-full rounded-r-sm"
                  style={{
                    width: isVisible ? `${outstandingPct}%` : "0%",
                    backgroundColor: heroColor,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : "80ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: WT.success }} />
                  <span className="font-mono text-micro text-text-secondary">{formatCompactCurrency(collectedAmount)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: heroColor }} />
                  <span className="font-mono text-micro text-text-secondary">{formatCompactCurrency(aging.totalAmount)}</span>
                </div>
              </div>
            </div>
          )}

          {/* LG: Top overdue invoices from worst bucket */}
          {showActions(size) && aging.worstBucket && aging.worstBucket.key !== "current" && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              {aging.worstBucket.invoices.slice(0, 5).map((inv, i) => {
                const due = new Date(inv.dueDate);
                const days = Math.floor((new Date().getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <WidgetLineItem
                    key={inv.id}
                    primary={inv.client?.name ?? `#${inv.invoiceNumber}`}
                    metric={formatCompactCurrency(inv.balanceDue)}
                    secondary={`${days}d`}
                    onClick={() => onNavigate(`/invoices/${inv.id}`)}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/invoices?status=past_due")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left shrink-0"
          >
            {t("receivablesAging.viewInvoices") ?? "View Invoices"}
          </button>
        )}
      </div>
    </Card>
  );
}

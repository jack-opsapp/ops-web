"use client";

import { useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useAnimatedValue } from "./shared/use-animated-value";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Aging buckets — colors from WT tokens per severity tier
// ---------------------------------------------------------------------------
const BUCKETS = [
  { key: "current", labelKey: "receivablesAging.current", fallback: "Current", min: -Infinity, max: 0, color: WT.accent },
  { key: "1-30", labelKey: "invoiceAging.bucket1to30", fallback: "1-30", min: 1, max: 30, color: WT.warning },
  { key: "31-60", labelKey: "invoiceAging.bucket31to60", fallback: "31-60", min: 31, max: 60, color: WT.receivables },
  { key: "61-90", labelKey: "invoiceAging.bucket61to90", fallback: "61-90", min: 61, max: 90, color: WT.errorMuted },
  { key: "90+", labelKey: "invoiceAging.bucket90plus", fallback: "90+", min: 91, max: Infinity, color: WT.error },
] as const;

// Severity rank for hero color — higher = worse
const SEVERITY_BY_KEY: Record<string, number> = {
  current: 0, "1-30": 1, "31-60": 2, "61-90": 3, "90+": 4,
};

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
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
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

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

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

  const animatedTotal = useAnimatedValue(isVisible ? Math.round(aging.totalAmount) : 0, 1000);
  const heroColor = aging.worstBucket?.color ?? WT.accent;

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("receivablesAging.title") ?? "Receivables"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
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
        <div className="h-full flex flex-col justify-center px-3">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mb-1">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          <span
            className={`font-mono ${HERO_SIZE_CLASS.compact} font-bold leading-none`}
            style={{ color: heroColor }}
          >
            {formatCurrency(animatedTotal)}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-1">
            {t("receivablesAging.outstanding") ?? "Outstanding"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + stacked bar + footer ───────────────────────────────────
  if (size === "sm") {
    const nonEmptyBuckets = aging.buckets.filter((b) => b.amount > 0);
    return (
      <Card className="h-full" ref={ref}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`font-mono ${HERO_SIZE_CLASS.compact} font-bold leading-none`}
              style={{ color: heroColor }}
            >
              {formatCurrency(animatedTotal)}
            </span>
          </div>

          {/* Stacked bar */}
          <div className="w-full h-[14px] rounded-sm overflow-hidden flex mt-2">
            {nonEmptyBuckets.map((bucket, i) => {
              const pct = aging.totalAmount > 0 ? (bucket.amount / aging.totalAmount) * 100 : 0;
              return (
                <div
                  key={bucket.key}
                  className="h-full"
                  style={{
                    width: isVisible ? `${pct}%` : "0%",
                    backgroundColor: bucket.color,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              );
            })}
          </div>

          <button
            onClick={() => onNavigate("/invoices?status=past_due")}
            className="mt-auto pt-1 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("receivablesAging.viewInvoices") ?? "View Invoices"}
          </button>
        </div>
      </Card>
    );
  }

  // ── MD / LG ───────────────────────────────────────────────────────────
  const nonEmptyBuckets = aging.buckets.filter((b) => b.amount > 0);

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("receivablesAging.title") ?? "Receivables"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {aging.totalCount} · {formatCurrency(aging.totalAmount)}
          </span>
        </div>

        {/* Detail zone */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.bucket} value={formatCurrency(tooltip.amount)} />
            <TooltipRow label={t("receivablesAging.count") ?? "Count"} value={`${tooltip.count}`} />
            <TooltipRow label={t("receivablesAging.ofTotal") ?? "Of total"} value={`${Math.round(tooltip.pct)}%`} />
          </WidgetTooltip>

          {/* Stacked horizontal bar */}
          <div className="w-full h-[20px] rounded-sm overflow-hidden flex">
            {nonEmptyBuckets.map((bucket, i) => {
              const pct = aging.totalAmount > 0 ? (bucket.amount / aging.totalAmount) * 100 : 0;
              return (
                <div
                  key={bucket.key}
                  className="h-full"
                  style={{
                    width: isVisible ? `${pct}%` : "0%",
                    backgroundColor: bucket.color,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                  onMouseEnter={(e) => {
                    const parentRect = ref.current?.getBoundingClientRect();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (!parentRect) return;
                    setTooltip({
                      visible: true,
                      x: rect.left - parentRect.left + rect.width / 2,
                      y: 0,
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

          {/* Bucket list */}
          <div className="flex flex-col gap-[4px] mt-2">
            {aging.buckets.map((bucket, i) => {
              if (bucket.count === 0) return null;
              return (
                <div
                  key={bucket.key}
                  className="flex items-center justify-between"
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transition: reducedMotion
                      ? "opacity 200ms ease"
                      : `opacity 300ms ease ${nonEmptyBuckets.length * 60 + 100 + i * 40}ms`,
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: bucket.color }} />
                    <span className="font-mohave text-micro text-text-secondary">
                      {t(bucket.labelKey) ?? bucket.fallback} {bucket.key !== "current" && (t("receivablesAging.days") ?? "days")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-micro text-text-tertiary">{bucket.count}</span>
                    <span className="font-mono text-micro text-text-primary">{formatCurrency(bucket.amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* LG: Top overdue invoices from worst bucket + action buttons */}
          {showActions(size) && aging.worstBucket && aging.worstBucket.key !== "current" && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              {aging.worstBucket.invoices.slice(0, 3).map((inv, i) => {
                const due = new Date(inv.dueDate);
                const days = Math.floor((new Date().getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between py-1 px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    style={{
                      opacity: isVisible ? 1 : 0,
                      transform: isVisible ? "translateY(0)" : "translateY(4px)",
                      transition: reducedMotion
                        ? "opacity 200ms ease"
                        : `opacity 300ms ease ${600 + i * 50}ms, transform 300ms ease ${600 + i * 50}ms`,
                    }}
                    onClick={() => onNavigate(`/invoices/${inv.id}`)}
                  >
                    <span className="font-mohave text-caption-sm text-text-secondary truncate flex-1 min-w-0">
                      {inv.client?.name ?? `#${inv.invoiceNumber}`}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-micro text-text-primary">{formatCurrency(inv.balanceDue)}</span>
                      <span className="font-mono text-micro-sm text-text-tertiary">{days}d</span>
                      {days >= 30 && (
                        <button
                          className="font-mohave text-button-sm px-2 py-0.5 rounded-sm transition-colors"
                          style={{ backgroundColor: `${WT.receivables}15`, color: WT.receivables }}
                          onClick={(e) => { e.stopPropagation(); onNavigate(`/invoices/${inv.id}`); }}
                        >
                          {t("receivablesAging.sendReminder") ?? "Send Reminder"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/invoices?status=past_due")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("receivablesAging.viewInvoices") ?? "View Invoices"}
          </button>
        )}
      </div>
    </Card>
  );
}

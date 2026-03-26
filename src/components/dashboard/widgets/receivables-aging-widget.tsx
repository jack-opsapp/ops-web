"use client";

import { useMemo, useState, useRef } from "react";
import { Clock, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Aging buckets
// ---------------------------------------------------------------------------
const BUCKETS = [
  { key: "current", label: "Current", min: -Infinity, max: 0, color: "#597794" },
  { key: "1-30", label: "1-30 days", min: 1, max: 30, color: "#C4A868" },
  { key: "31-60", label: "31-60 days", min: 31, max: 60, color: "#F97316" },
  { key: "61-90", label: "61-90 days", min: 61, max: 90, color: "rgba(181,130,137,0.7)" },
  { key: "90+", label: "90+ days", min: 91, max: Infinity, color: "#B58289" },
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

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    bucket: string;
    count: number;
    amount: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, bucket: "", count: 0, amount: 0, pct: 0 });

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
    // Find worst non-empty bucket for urgency indicator
    const worstBucket = [...bucketData].reverse().find((b) => b.count > 0);

    return { buckets: bucketData, totalAmount, totalCount, worstBucket };
  }, [invoices]);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            Receivables
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (aging.totalCount === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            Receivables
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex items-center gap-2 h-[calc(100%-28px)]">
          <Check className="w-4 h-4 text-status-success" />
          <span className="font-mohave text-[13px] text-status-success">All invoices current</span>
        </CardContent>
      </Card>
    );
  }

  // ── SM ──────────────────────────────────────────────────────────────────
  if (size === "sm") {
    const worstColor = aging.worstBucket?.color ?? "var(--text-tertiary)";
    const isOverdue90 = aging.buckets[4].count > 0;
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            Receivables
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[20px] font-medium leading-none"
              style={{ color: isOverdue90 ? "#B58289" : "var(--text-primary)" }}
            >
              {formatCurrency(aging.totalAmount)}
            </span>
            <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ backgroundColor: worstColor }} />
          </div>
          <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider mt-1 block">
            Outstanding
          </span>
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG ─────────────────────────────────────────────────────────────
  const nonEmptyBuckets = aging.buckets.filter((b) => b.amount > 0);

  return (
    <Card
      className="h-full cursor-pointer"
      ref={ref}
      onClick={() => onNavigate("/invoices?status=past_due")}
    >
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          Receivables
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">
          {aging.totalCount} · {formatCurrency(aging.totalAmount)}
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden relative">
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchor="above">
          <TooltipRow label={tooltip.bucket} value={formatCurrency(tooltip.amount)} />
          <TooltipRow label="Count" value={`${tooltip.count}`} />
          <TooltipRow label="Of total" value={`${Math.round(tooltip.pct)}%`} />
        </WidgetTooltip>

        {/* Stacked horizontal bar */}
        <div className="w-full h-[20px] rounded-sm overflow-hidden flex">
          {nonEmptyBuckets.map((bucket, i) => {
            const pct = aging.totalAmount > 0 ? (bucket.amount / aging.totalAmount) * 100 : 0;
            return (
              <div
                key={bucket.key}
                className="h-full transition-all"
                style={{
                  width: isVisible ? `${pct}%` : "0%",
                  backgroundColor: bucket.color,
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
                    bucket: bucket.label,
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
                  <span className="font-mohave text-[11px] text-text-secondary">{bucket.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-text-tertiary">{bucket.count}</span>
                  <span className="font-mono text-[11px] text-text-primary">{formatCurrency(bucket.amount)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* LG: Top 3 overdue invoices from worst bucket */}
        {size === "lg" && aging.worstBucket && aging.worstBucket.key !== "current" && (
          <div className="mt-2 pt-2 border-t border-border-primary">
            {aging.worstBucket.invoices.slice(0, 3).map((inv) => {
              const due = new Date(inv.dueDate);
              const days = Math.floor((new Date().getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between py-[3px] px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                  onClick={(e) => { e.stopPropagation(); onNavigate(`/invoices/${inv.id}`); }}
                >
                  <span className="font-mohave text-[12px] text-text-secondary truncate flex-1 min-w-0">
                    {inv.client?.name ?? `#${inv.invoiceNumber}`}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[11px] text-text-primary">{formatCurrency(inv.balanceDue)}</span>
                    <span className="font-mono text-[9px] text-text-tertiary">{days}d</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

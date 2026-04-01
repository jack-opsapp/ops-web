"use client";

import { useMemo, useState, useRef } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useAnimatedValue } from "./shared/use-animated-value";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Chart palette — ranked by spend, from WT tokens (no hardcoded hex)
// Categories don't have semantic meaning → palette assigned by rank
// ---------------------------------------------------------------------------
const CHART_PALETTE = [
  WT.accent,       // Top category
  WT.warning,      // 2nd
  WT.cost,         // 3rd
  WT.receivables,  // 4th
  WT.success,      // 5th
  WT.accentMuted,  // 6th
  WT.muted,        // 7th+
] as const;

function getPaletteColor(index: number): string {
  return CHART_PALETTE[Math.min(index, CHART_PALETTE.length - 1)];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ExpenseTrackerWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  expenses: ExpenseLineItem[];
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

function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "last-month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { start, end };
    }
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end: now };
    case "this-month":
    default:
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ExpenseTrackerWidget({
  size,
  config,
  expenses,
  isLoading,
  onNavigate,
}: ExpenseTrackerWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const period = (config.period as string) ?? "this-month";
  const { start, end } = getPeriodRange(period);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    category: string;
    amount: number;
    pct: number;
    count: number;
  }>({ visible: false, x: 0, y: 0, category: "", amount: 0, pct: 0, count: 0 });

  // ── Compute categories ────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const filtered = expenses.filter((e) => {
      if (e.deletedAt) return false;
      if (e.status !== "approved") return false;
      if (!e.expenseDate) return false;
      const d = new Date(e.expenseDate);
      return d >= start && d <= end;
    });

    const catMap = new Map<string, { amount: number; count: number }>();
    for (const e of filtered) {
      const cat = e.categoryName ?? "Other";
      const existing = catMap.get(cat) ?? { amount: 0, count: 0 };
      existing.amount += e.amount;
      existing.count++;
      catMap.set(cat, existing);
    }

    const total = Array.from(catMap.values()).reduce((s, c) => s + c.amount, 0);

    // Sort descending — palette color assigned by rank
    const entries = Array.from(catMap.entries())
      .map(([name, data]) => ({
        name,
        amount: data.amount,
        count: data.count,
        pct: total > 0 ? (data.amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .map((entry, i) => ({ ...entry, color: getPaletteColor(i) }));

    return { categories: entries, total };
  }, [expenses, start, end]);

  // ── Prior period for delta (XS) ───────────────────────────────────────
  const priorTotal = useMemo(() => {
    if (size !== "xs") return 0;
    // Compute prior period total for delta
    const now = new Date();
    let priorStart: Date;
    let priorEnd: Date;
    if (period === "last-month") {
      priorStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      priorEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
    } else if (period === "ytd") {
      priorStart = new Date(now.getFullYear() - 1, 0, 1);
      priorEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      priorStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      priorEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    }
    let total = 0;
    for (const e of expenses) {
      if (e.deletedAt || e.status !== "approved" || !e.expenseDate) continue;
      const d = new Date(e.expenseDate);
      if (d >= priorStart && d <= priorEnd) total += e.amount;
    }
    return total;
  }, [expenses, period, size]);

  const animatedTotal = useAnimatedValue(isVisible ? Math.round(categoryData.total) : 0, 1000);
  const trend: "up" | "down" | "neutral" = categoryData.total > priorTotal ? "up" : categoryData.total < priorTotal ? "down" : "neutral";

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state — $0 hero, no floating icon ───────────────────────────
  if (categoryData.total === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/expenses")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              $0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("expenseTracker.noExpenses") ?? "No expenses recorded"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("expenseTracker.viewAll") ?? "View Expenses"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero = total expenses + delta ─────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/expenses")}>
        <div className="h-full flex flex-col pt-3">
          <span className={`font-mono ${formatCurrency(animatedTotal).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none text-text-primary`}>
            {formatCurrency(animatedTotal)}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          <div className="flex items-center gap-0.5">
            {trend === "up" ? (
              <ChevronUp className="w-3 h-3" style={{ color: WT.error }} />
            ) : trend === "down" ? (
              <ChevronDown className="w-3 h-3" style={{ color: WT.success }} />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-disabled" />
            )}
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("expenseTracker.delta") ?? "vs last period"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + top category ─────────────────────────────────────
  if (size === "sm") {
    const topCat = categoryData.categories[0];
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {formatCurrency(animatedTotal)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/expenses"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          {/* Row 3: Top category */}
          {topCat && (
            <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
              {topCat.name}: {formatCurrency(topCat.amount)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Category bars + footer ───────────────────────────────────
  const maxBars = showActions(size) ? 7 : 5;
  const displayCats = categoryData.categories.slice(0, maxBars);
  const maxAmount = displayCats[0]?.amount ?? 1;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          <span className="font-mono text-micro text-text-primary">{formatCurrency(categoryData.total)}</span>
        </div>

        {/* Detail zone */}
        <ScrollFade>
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.category} value={formatCurrency(tooltip.amount)} />
            <TooltipRow label={t("expenseTracker.ofTotal") ?? "of total"} value={`${Math.round(tooltip.pct)}%`} />
          </WidgetTooltip>

          <div className={cn("flex flex-col", showActions(size) ? "gap-3" : "gap-[6px]")}>
            {displayCats.map((cat, i) => {
              const barPct = (cat.amount / maxAmount) * 100;
              return (
                <div
                  key={cat.name}
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => onNavigate(`/expenses?category=${encodeURIComponent(cat.name)}`)}
                  onMouseEnter={(e) => {
                    const parentRect = ref.current?.getBoundingClientRect();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (!parentRect) return;
                    setTooltip({
                      visible: true,
                      x: rect.left - parentRect.left + rect.width / 2,
                      y: rect.top - parentRect.top,
                      category: cat.name,
                      amount: cat.amount,
                      pct: cat.pct,
                      count: cat.count,
                    });
                  }}
                  onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                >
                  <span className="font-mohave text-micro text-text-secondary w-[80px] shrink-0 truncate">
                    {cat.name}
                  </span>
                  <div className="flex-1 h-[8px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: isVisible ? `${barPct}%` : "0%",
                        backgroundColor: cat.color,
                        transitionProperty: "width",
                        transitionDuration: reducedMotion ? "200ms" : "500ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    />
                  </div>
                  <span className="font-mono text-micro text-text-primary shrink-0 w-[50px] text-right">
                    {formatCurrency(cat.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/expenses")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("expenseTracker.viewAll") ?? "View Expenses"}
          </button>
        )}
      </div>
    </Card>
  );
}

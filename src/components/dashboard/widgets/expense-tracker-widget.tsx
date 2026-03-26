"use client";

import { useMemo, useState, useRef } from "react";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Category colors (9 categories from spec)
// ---------------------------------------------------------------------------
const CATEGORY_COLORS: Record<string, string> = {
  Materials: "#597794",
  Equipment: "#C4A868",
  Fuel: "#8B7355",
  Subcontractor: "#7A8B6F",
  Permits: "#9B8BA0",
  Tools: "#6B7B8D",
  Safety: "#6B8F71",
  Office: "#8195B5",
  Other: "rgba(255,255,255,0.3)",
};

function getCategoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? CATEGORY_COLORS.Other;
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

  const categoryData = useMemo(() => {
    // Filter approved expenses in period
    const filtered = expenses.filter((e) => {
      if (e.deletedAt) return false;
      if (e.status !== "approved") return false;
      if (!e.expenseDate) return false;
      const d = new Date(e.expenseDate);
      return d >= start && d <= end;
    });

    // Group by category
    const catMap = new Map<string, { amount: number; count: number }>();
    for (const e of filtered) {
      const cat = e.categoryName ?? "Other";
      const existing = catMap.get(cat) ?? { amount: 0, count: 0 };
      existing.amount += e.amount;
      existing.count++;
      catMap.set(cat, existing);
    }

    const total = Array.from(catMap.values()).reduce((s, c) => s + c.amount, 0);

    // Sort descending, group small categories as "Other"
    const entries = Array.from(catMap.entries())
      .map(([name, data]) => ({
        name,
        amount: data.amount,
        count: data.count,
        pct: total > 0 ? (data.amount / total) * 100 : 0,
        color: getCategoryColor(name),
      }))
      .sort((a, b) => b.amount - a.amount);

    return { categories: entries, total };
  }, [expenses, start, end]);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (categoryData.total === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex flex-col items-center justify-center h-[calc(100%-28px)]">
          <Receipt className="w-6 h-6 text-text-quaternary opacity-20 mb-1" />
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("expenseTracker.noExpenses") ?? "No expenses recorded"}
          </span>
        </CardContent>
      </Card>
    );
  }

  // ── SM ──────────────────────────────────────────────────────────────────
  if (size === "sm") {
    const top = categoryData.categories[0];
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <span className="font-mono text-[20px] text-text-primary font-medium leading-none">
            {formatCurrency(categoryData.total)}
          </span>
          {top && (
            <p className="font-mono text-[11px] text-text-tertiary mt-1">
              {top.name}: {formatCurrency(top.amount)}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG ─────────────────────────────────────────────────────────────
  const maxBars = size === "lg" ? 7 : 5;
  const displayCats = categoryData.categories.slice(0, maxBars);
  const maxAmount = displayCats[0]?.amount ?? 1;

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("expenseTracker.title") ?? "Expenses"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-primary">{formatCurrency(categoryData.total)}</span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden relative">
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchor="above">
          <TooltipRow label={tooltip.category} value={formatCurrency(tooltip.amount)} />
          <TooltipRow label={t("expenseTracker.ofTotal") ?? "of total"} value={`${Math.round(tooltip.pct)}%`} />
        </WidgetTooltip>

        <div className="flex flex-col gap-[6px]">
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
                <span className="font-mohave text-[11px] text-text-secondary w-[80px] shrink-0 truncate">
                  {cat.name}
                </span>
                <div className="flex-1 h-[8px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: isVisible ? `${barPct}%` : "0%",
                      backgroundColor: cat.color,
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
                <span className="font-mono text-[11px] text-text-primary shrink-0 w-[50px] text-right">
                  {formatCurrency(cat.amount)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo, useState, useRef } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useAnimatedValue } from "./shared/use-animated-value";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { useTeamMembers } from "@/lib/hooks";

// ---------------------------------------------------------------------------
// Chart palette — ranked by spend, from WT tokens (no hardcoded hex)
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

  const reducedMotion = useReducedMotion();

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

  // ── Filter expenses in period ─────────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (e.deletedAt) return false;
      if (e.status !== "approved") return false;
      if (!e.expenseDate) return false;
      const d = new Date(e.expenseDate);
      return d >= start && d <= end;
    });
  }, [expenses, start, end]);

  // ── Compute categories ────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const catMap = new Map<string, { amount: number; count: number }>();
    for (const e of filteredExpenses) {
      const cat = e.categoryName ?? "Other";
      const existing = catMap.get(cat) ?? { amount: 0, count: 0 };
      existing.amount += e.amount;
      existing.count++;
      catMap.set(cat, existing);
    }

    const total = Array.from(catMap.values()).reduce((s, c) => s + c.amount, 0);

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
  }, [filteredExpenses]);

  // ── Team member breakdown (LG only) ───────────────────────────────────
  const { data: teamMembersData } = useTeamMembers(undefined, { enabled: showActions(size) });
  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teamMembersData?.users) {
      for (const u of teamMembersData.users) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id;
        map.set(u.id, name);
      }
    }
    return map;
  }, [teamMembersData]);

  const teamData = useMemo(() => {
    if (!showActions(size)) return [];
    const memberMap = new Map<string, { name: string; amount: number; count: number }>();
    for (const e of filteredExpenses) {
      const id = e.submittedBy ?? "unknown";
      const name = userNameMap.get(id) ?? t("expenseTracker.unknownMember") ?? "Unassigned";
      const existing = memberMap.get(id) ?? { name, amount: 0, count: 0 };
      existing.amount += e.amount;
      existing.count++;
      memberMap.set(id, existing);
    }

    const entries = Array.from(memberMap.values())
      .sort((a, b) => b.amount - a.amount);

    return entries;
  }, [filteredExpenses, size, t, userNameMap]);

  // ── Prior period for delta (XS) ───────────────────────────────────────
  const priorTotal = useMemo(() => {
    if (size !== "xs") return 0;
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
        <div className="px-3 pt-2 pb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (categoryData.total === 0) {
    if (size === "xs") {
      return (
        <Card className="h-full cursor-pointer" onClick={() => onNavigate("/accounting")}>
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">$0</span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("expenseTracker.title") ?? "Expenses"}
            </span>
          </div>
        </Card>
      );
    }
    if (size === "sm") {
      return (
        <Card className="h-full p-0">
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold text-text-disabled leading-none">$0</span>
              <button onClick={() => onNavigate("/accounting")} className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("expenseTracker.title") ?? "Expenses"}
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1 truncate">
              {t("expenseTracker.noExpenses") ?? "No expenses recorded"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/accounting")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">$0</span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("expenseTracker.noExpenses") ?? "No expenses recorded"}
            </span>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
            {t("expenseTracker.viewAll") ?? "View Expenses"}
          </span>
        </div>
      </Card>
    );
  }

  // ── XS: Hero = total expenses + delta ─────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/accounting")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className={`font-mono ${formatCompactCurrency(animatedTotal).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none text-text-primary`}>
            {formatCompactCurrency(animatedTotal)}
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
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {formatCompactCurrency(animatedTotal)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/accounting"); }}
              className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          {topCat && (
            <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
              {topCat.name}: {formatCompactCurrency(topCat.amount)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Category bars + team breakdown (LG) ─────────────────────
  const maxBars = showActions(size) ? 7 : 5;
  const displayCats = categoryData.categories.slice(0, maxBars);
  const maxAmount = displayCats[0]?.amount ?? 1;

  // LG: per-member category breakdown for hover highlight
  const memberCategoryMap = useMemo(() => {
    if (!showActions(size)) return new Map<string, Map<string, number>>();
    const map = new Map<string, Map<string, number>>();
    for (const e of filteredExpenses) {
      const id = e.submittedBy ?? "unknown";
      const cat = e.categoryName ?? "Other";
      if (!map.has(id)) map.set(id, new Map());
      const catMap = map.get(id)!;
      catMap.set(cat, (catMap.get(cat) ?? 0) + e.amount);
    }
    return map;
  }, [filteredExpenses, size]);

  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("expenseTracker.title") ?? "Expenses"}
          </span>
          <span className="font-mono text-micro text-text-primary">{formatCompactCurrency(categoryData.total)}</span>
        </div>

        {/* Detail zone — fills available space */}
        <ScrollFade>
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.category} value={formatCompactCurrency(tooltip.amount)} />
            <TooltipRow label={t("expenseTracker.ofTotal") ?? "of total"} value={`${Math.round(tooltip.pct)}%`} />
          </WidgetTooltip>

          {/* Category bars — stacked vertically, flex to fill space */}
          <div className="flex flex-col flex-1 min-h-0" style={{ gap: "2px" }}>
            {displayCats.map((cat, i) => {
              const barPct = (cat.amount / maxAmount) * 100;
              const memberContribution = hoveredMemberId
                ? memberCategoryMap.get(hoveredMemberId)?.get(cat.name) ?? 0
                : 0;
              const memberBarPct = hoveredMemberId && maxAmount > 0
                ? (memberContribution / maxAmount) * 100
                : 0;

              const displayAmount = hoveredMemberId ? memberContribution : cat.amount;
              const displayPct = hoveredMemberId
                ? (categoryData.total > 0 ? Math.round((memberContribution / categoryData.total) * 100) : 0)
                : Math.round(cat.pct);
              const dimmed = hoveredMemberId && memberContribution === 0;

              return (
                <div
                  key={cat.name}
                  className="flex-1 flex flex-col justify-center cursor-pointer min-h-[28px]"
                  onClick={() => onNavigate("/accounting")}
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
                  {/* Bar — full width */}
                  <div className="w-full h-[8px] rounded-sm overflow-hidden relative" style={{ backgroundColor: WT.faint }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{
                        width: isVisible ? `${barPct}%` : "0%",
                        backgroundColor: cat.color,
                        opacity: hoveredMemberId ? 0.25 : 1,
                        transitionProperty: "width, opacity",
                        transitionDuration: reducedMotion ? "200ms" : "500ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    />
                    {hoveredMemberId && memberContribution > 0 && (
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${memberBarPct}%`,
                          backgroundColor: cat.color,
                          transition: reducedMotion ? "none" : "width 300ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      />
                    )}
                  </div>
                  {/* Label + value beneath bar */}
                  <div className="flex items-center justify-between mt-[2px]">
                    <span className="font-mohave text-micro-sm text-text-tertiary truncate">
                      {cat.name}
                    </span>
                    <span
                      className="font-mono text-micro-sm shrink-0"
                      style={{
                        color: dimmed ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
                        transition: reducedMotion ? "none" : "color 200ms ease",
                      }}
                    >
                      {formatCompactCurrency(displayAmount)}
                      {showActions(size) && (
                        <span className="text-text-disabled ml-1">{displayPct}%</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* LG: Team member breakdown */}
          {showActions(size) && teamData.length > 0 && (
            <div className="mt-3 pt-2 border-t border-border-subtle">
              <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider mb-1 block">
                {t("expenseTracker.byTeamMember") ?? "By Team Member"}
              </span>
              {teamData.slice(0, 5).map((member, i) => {
                const memberPct = categoryData.total > 0 ? Math.round((member.amount / categoryData.total) * 100) : 0;
                const memberId = filteredExpenses.find((e) => {
                  const name = userNameMap.get(e.submittedBy ?? "") ?? "";
                  return name === member.name;
                })?.submittedBy ?? `member-${i}`;
                return (
                  <div
                    key={i}
                    className="rounded-sm transition-colors"
                    style={{
                      backgroundColor: hoveredMemberId === memberId ? "rgba(255,255,255,0.06)" : "transparent",
                      borderLeft: hoveredMemberId === memberId ? `2px solid ${WT.accent}` : "2px solid transparent",
                      transition: reducedMotion ? "none" : "background-color 200ms ease, border-color 200ms ease",
                    }}
                    onMouseEnter={() => setHoveredMemberId(memberId)}
                    onMouseLeave={() => setHoveredMemberId(null)}
                  >
                    <WidgetLineItem
                      indicator={{ type: "avatar", color: WT.accent, initials: member.name.slice(0, 2) }}
                      primary={member.name}
                      metric={
                        <span className="flex items-center gap-1">
                          <span className="font-mono text-micro-sm text-text-secondary">{formatCompactCurrency(member.amount)}</span>
                          <span className="font-mono text-micro-sm text-text-disabled">{memberPct}%</span>
                        </span>
                      }
                      index={i}
                      isVisible={isVisible}
                      reducedMotion={reducedMotion}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/accounting")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left shrink-0"
          >
            {t("expenseTracker.viewAll") ?? "View Expenses"}
          </button>
        )}
      </div>
    </Card>
  );
}

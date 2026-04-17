"use client";

/**
 * Financial Insight Card — Inline dashboard for the weekly financial digest.
 * Rendered inside the ActionCard's expanded section when actionType === "financial_insight".
 *
 * Four sections:
 * 1. Revenue (always visible) — bar chart + forecast
 * 2. Cash Flow (always visible) — stat boxes + projection bars
 * 3. Pricing (collapsible) — service win rate table
 * 4. Seasonal (collapsible) — monthly activity heatmap
 *
 * Design: dark theme, frosted glass per section, Mohave uppercase headers,
 * Kosugi [square bracket] captions, 56dp touch targets, no shadows.
 */

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useLocale } from "@/i18n/client";
import type { FinancialInsightActionData, FinancialAlert } from "@/lib/types/approval-queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(amount: number, locale: string): string {
  return amount.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(value: number): string {
  return `${value}%`;
}

// ─── Section Wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4">
      <h3 className="font-mohave text-[13px] text-text-3 uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  showLabel,
  hideLabel,
  children,
}: {
  title: string;
  showLabel: string;
  hideLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 min-h-[56px] text-left"
      >
        <h3 className="font-mohave text-[13px] text-text-3 uppercase tracking-wider">
          {title}
        </h3>
        <span className="flex items-center gap-1 font-mono text-[11px] text-text-3">
          {open ? hideLabel : showLabel}
          {open ? (
            <ChevronUp className="w-[14px] h-[14px]" />
          ) : (
            <ChevronDown className="w-[14px] h-[14px]" />
          )}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="px-4 pb-4"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Stat Box ─────────────────────────────────────────────────────────────────

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex-1 min-w-[100px] rounded-[4px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3">
      <span className="font-mono text-[11px] text-text-3 uppercase block">
        [{label}]
      </span>
      <span
        className="font-mono text-[16px] font-medium block mt-1"
        style={{ color: color ?? "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── CSS Bar Chart ────────────────────────────────────────────────────────────

function BarChart({
  data,
  maxValue,
  accentColor = "#6F94B0",
  barLabel,
}: {
  data: Array<{ label: string; value: number; isProjected?: boolean }>;
  maxValue: number;
  accentColor?: string;
  barLabel?: (value: number) => string;
}) {
  const safeMax = maxValue > 0 ? maxValue : 1;
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="flex items-end gap-[3px] h-[80px]">
      {data.map((d, i) => {
        const heightPct = Math.max((d.value / safeMax) * 100, 2);
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            {/* Fixed height container — bar scales via transform only */}
            <div className="w-full h-full relative">
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t-[2px]"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: d.isProjected
                    ? `${accentColor}66`
                    : accentColor,
                  borderTop: d.isProjected
                    ? `1px dashed ${accentColor}`
                    : "none",
                  transformOrigin: "bottom",
                  transform: shouldReduceMotion ? "scaleY(1)" : "scaleY(1)",
                  opacity: 1,
                }}
                title={barLabel ? barLabel(d.value) : `${d.value}`}
              />
            </div>
            <span className="font-mono text-micro text-text-3 truncate w-full text-center">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Projection Bar ───────────────────────────────────────────────────────────

function ProjectionBar({
  label,
  expected,
  pipeline,
  maxValue,
  locale: loc,
}: {
  label: string;
  expected: number;
  pipeline: number;
  maxValue: number;
  locale: string;
}) {
  const safeMax = maxValue > 0 ? maxValue : 1;
  const expectedPct = Math.min((expected / safeMax) * 100, 100);
  const pipelinePct = Math.min((pipeline / safeMax) * 100, 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-text-3">{label}</span>
        <span className="font-mono text-[11px] text-text-2">
          {fmtCurrency(expected + pipeline, loc)}
        </span>
      </div>
      <div className="flex gap-[2px] h-[6px] rounded-[2px] overflow-hidden bg-[rgba(255,255,255,0.04)]">
        {expectedPct > 0 && (
          <div
            className="h-full rounded-l-[2px]"
            style={{ width: `${expectedPct}%`, backgroundColor: "#6F94B0" }}
          />
        )}
        {pipelinePct > 0 && (
          <div
            className="h-full"
            style={{ width: `${pipelinePct}%`, backgroundColor: "#6F94B066" }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Heatmap Cell ─────────────────────────────────────────────────────────────

function HeatmapCell({ month, index }: { month: string; index: number }) {
  // index: 0-200+ where 100 = average
  const intensity = Math.min(index / 150, 1); // cap at 150% for full intensity
  const alpha = Math.max(0.05, intensity * 0.6);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-full aspect-square rounded-[2px] border border-[rgba(255,255,255,0.06)]"
        style={{ backgroundColor: `rgba(111, 148, 176, ${alpha})` }}
        title={`${month}: ${index}%`}
      />
      <span className="font-mono text-micro text-text-3">{month}</span>
    </div>
  );
}

// ─── Alert Ribbon ─────────────────────────────────────────────────────────────

function AlertRibbon({
  alerts,
  t,
  locale: loc,
}: {
  alerts: FinancialAlert[];
  t: (key: string) => string;
  locale: string;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => {
        const isUrgent = alert.type === "low_cash";
        const borderColor = isUrgent ? "#93321A" : "#C4A868";
        const textColor = isUrgent ? "#93321A" : "#C4A868";

        // Build alert text from structured params
        let text = "";
        switch (alert.type) {
          case "low_cash":
            text = t("financial.alert.lowCash")
              .replace("{{overdue}}", fmtCurrency(Number(alert.params.overdue), loc))
              .replace("{{outstanding}}", fmtCurrency(Number(alert.params.outstanding), loc));
            break;
          case "concentration_risk":
            text = t("financial.alert.concentrationRisk")
              .replace("{{clientName}}", String(alert.params.clientName))
              .replace("{{percentage}}", String(alert.params.percentage));
            break;
          case "aging_warning":
            text = t("financial.alert.agingWarning")
              .replace("{{count}}", String(alert.params.count))
              .replace("{{days}}", String(alert.params.days))
              .replace("{{totalAmount}}", fmtCurrency(Number(alert.params.totalAmount), loc));
            break;
        }

        return (
          <div
            key={i}
            className="rounded-[4px] px-3 py-2 text-[12px] font-mono"
            style={{
              borderLeft: `3px solid ${borderColor}`,
              backgroundColor: `${borderColor}10`,
              color: textColor,
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface FinancialInsightCardProps {
  data: FinancialInsightActionData;
  t: (key: string) => string;
  /** Inline mode: compact summary for collapsed card view */
  inline?: boolean;
}

export function FinancialInsightCard({ data, t, inline }: FinancialInsightCardProps) {
  const { locale } = useLocale();

  // ── Inline mode: compact summary for card header ──
  if (inline) {
    const trendArrow = data.revenue.yoy_change !== null
      ? data.revenue.yoy_change > 0
      : null;

    return (
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <span className="font-mono text-[11px] text-text-2">
          {fmtCurrency(data.cashflow.outstanding, locale)} {t("financial.cashflow.outstanding").toLowerCase()}
        </span>
        {data.cashflow.overdue > 0 && (
          <span className="font-mono text-[11px] text-[#93321A]">
            {fmtCurrency(data.cashflow.overdue, locale)} {t("financial.cashflow.overdue").toLowerCase()}
          </span>
        )}
        {data.revenue.yoy_change !== null && (
          <span className="flex items-center gap-1 font-mono text-[11px]" style={{
            color: trendArrow ? "#A5B368" : "#93321A",
          }}>
            {trendArrow ? (
              <TrendingUp className="w-[12px] h-[12px]" />
            ) : (
              <TrendingDown className="w-[12px] h-[12px]" />
            )}
            {Math.abs(data.revenue.yoy_change)}% {t("financial.revenue.yoyChange").toLowerCase()}
          </span>
        )}
        {data.revenue.pipeline_value > 0 && (
          <span className="font-mono text-[11px] text-[#C4A868]">
            {fmtCurrency(data.revenue.pipeline_value, locale)} {t("financial.revenue.pipelineValue").toLowerCase()}
          </span>
        )}
      </div>
    );
  }

  // ── Expanded mode: full financial dashboard ──

  // Compute chart data
  const allRevenue = [
    ...data.revenue.monthly_revenue.slice(-6),
    ...data.revenue.forecast.map((f) => ({
      month: f.month,
      amount: f.projected,
    })),
  ];
  const maxRevenue = Math.max(...allRevenue.map((r) => r.amount), 1);
  const barData = allRevenue.map((r, i) => ({
    label: r.month.split(" ")[0], // "Jan 2026" → "Jan"
    value: r.amount,
    isProjected: i >= data.revenue.monthly_revenue.slice(-6).length,
  }));

  // Projection max for bars
  const projMax = Math.max(
    ...data.cashflow.projection.map((p) => p.expected + p.pipeline),
    1
  );

  return (
    <div className="space-y-3">
      {/* Alert ribbon at top */}
      <AlertRibbon alerts={data.alerts} t={t} locale={locale} />

      {/* Section 1 — Revenue */}
      <Section title={t("financial.revenue")}>
        <div className="space-y-3">
          {/* Revenue bar chart */}
          <BarChart
            data={barData}
            maxValue={maxRevenue}
            barLabel={(v) => fmtCurrency(v, locale)}
          />

          {/* Metrics row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="font-mono text-[11px] text-text-3 uppercase block">
                [{t("financial.revenue.avgMonthly")}]
              </span>
              <span className="font-mono text-[14px] text-text font-medium">
                {fmtCurrency(data.revenue.avg_monthly, locale)}
              </span>
            </div>
            <div>
              <span className="font-mono text-[11px] text-text-3 uppercase block">
                [{t("financial.revenue.pipelineValue")}]
              </span>
              <span className="font-mono text-[14px] text-[#C4A868] font-medium">
                {fmtCurrency(data.revenue.pipeline_value, locale)}
              </span>
            </div>
            {data.revenue.yoy_change !== null && (
              <div>
                <span className="font-mono text-[11px] text-text-3 uppercase block">
                  [{t("financial.revenue.yoyChange")}]
                </span>
                <span className="flex items-center gap-1 font-mono text-[14px] font-medium" style={{
                  color: data.revenue.yoy_change > 0 ? "#A5B368" : data.revenue.yoy_change < 0 ? "#93321A" : "var(--text-secondary)",
                }}>
                  {data.revenue.yoy_change > 0 ? (
                    <TrendingUp className="w-[14px] h-[14px]" />
                  ) : data.revenue.yoy_change < 0 ? (
                    <TrendingDown className="w-[14px] h-[14px]" />
                  ) : null}
                  {data.revenue.yoy_change > 0 ? "+" : ""}{data.revenue.yoy_change}%
                </span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-[8px] h-[8px] rounded-[1px]" style={{ backgroundColor: "#6F94B0" }} />
              <span className="font-mono text-micro text-text-3">{t("financial.revenue.actual")}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-[8px] h-[8px] rounded-[1px]" style={{ backgroundColor: "#6F94B066" }} />
              <span className="font-mono text-micro text-text-3">{t("financial.revenue.projected")}</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Section 2 — Cash Flow */}
      <Section title={t("financial.cashflow")}>
        <div className="space-y-3">
          {/* Stat boxes */}
          <div className="flex gap-2 flex-wrap">
            <StatBox
              label={t("financial.cashflow.outstanding")}
              value={fmtCurrency(data.cashflow.outstanding, locale)}
            />
            <StatBox
              label={t("financial.cashflow.overdue")}
              value={fmtCurrency(data.cashflow.overdue, locale)}
              color={data.cashflow.overdue > 0 ? "#93321A" : undefined}
            />
            <StatBox
              label={t("financial.cashflow.receivedThisMonth")}
              value={fmtCurrency(data.cashflow.received_this_month, locale)}
              color="#A5B368"
            />
          </div>

          {/* Projection bars */}
          <div className="space-y-2">
            {data.cashflow.projection.map((p) => (
              <ProjectionBar
                key={p.period}
                label={t(`financial.cashflow.projection${p.period.replace("-day", "")}`)}
                expected={p.expected}
                pipeline={p.pipeline}
                maxValue={projMax}
                locale={locale}
              />
            ))}
          </div>

          {/* Projection legend */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-[8px] h-[8px] rounded-[1px]" style={{ backgroundColor: "#6F94B0" }} />
              <span className="font-mono text-micro text-text-3">{t("financial.cashflow.expected")}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-[8px] h-[8px] rounded-[1px]" style={{ backgroundColor: "#6F94B066" }} />
              <span className="font-mono text-micro text-text-3">{t("financial.cashflow.pipeline")}</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Section 3 — Pricing (collapsible) */}
      {data.pricing.service_analysis.length > 0 && (
        <CollapsibleSection
          title={t("financial.pricing")}
          showLabel={t("financial.digest.showPricing")}
          hideLabel={t("financial.digest.hidePricing")}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="font-mono text-[11px] text-text-3 uppercase pb-2 pr-3">
                    [{t("financial.pricing.service")}]
                  </th>
                  <th className="font-mono text-[11px] text-text-3 uppercase pb-2 pr-3">
                    [{t("financial.pricing.winRate")}]
                  </th>
                  <th className="font-mono text-[11px] text-text-3 uppercase pb-2 pr-3">
                    [{t("financial.pricing.avgPrice")}]
                  </th>
                  <th className="font-mono text-[11px] text-text-3 uppercase pb-2">
                    [{t("financial.pricing.suggestion")}]
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.pricing.service_analysis.map((svc, i) => {
                  const winColor = svc.win_rate > 80
                    ? "#A5B368"
                    : svc.win_rate < 40
                    ? "#C4A868"
                    : "var(--text-secondary)";

                  return (
                    <tr key={i} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td className="font-mohave text-[13px] text-text py-2 pr-3">
                        {svc.service}
                      </td>
                      <td className="font-mono text-[13px] py-2 pr-3" style={{ color: winColor }}>
                        {fmtPct(svc.win_rate)}
                      </td>
                      <td className="font-mono text-[13px] text-text-2 py-2 pr-3">
                        {fmtCurrency(svc.avg_win_price, locale)}
                      </td>
                      <td className="font-mono text-[11px] py-2" style={{ color: winColor }}>
                        {svc.suggestion.type === "increase"
                          ? t("financial.pricing.increase")
                          : svc.suggestion.type === "decrease"
                          ? t("financial.pricing.decrease")
                          : t("financial.pricing.neutral")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      {/* Section 4 — Seasonal (collapsible) */}
      {data.seasonal.monthly_index.length > 0 && (
        <CollapsibleSection
          title={t("financial.seasonal")}
          showLabel={t("financial.digest.showSeasonal")}
          hideLabel={t("financial.digest.hideSeasonal")}
        >
          <div className="space-y-3">
            {/* Monthly heatmap */}
            <div className="grid grid-cols-12 gap-1">
              {data.seasonal.monthly_index.map((m) => (
                <HeatmapCell key={m.month} month={m.month} index={m.index} />
              ))}
            </div>

            {/* Peak/slow labels */}
            <div className="flex items-center gap-4 flex-wrap">
              {data.seasonal.peak_months.length > 0 && (
                <div>
                  <span className="font-mono text-[11px] text-text-3 uppercase block">
                    [{t("financial.seasonal.peakMonths")}]
                  </span>
                  <span className="font-mohave text-[13px] text-[#A5B368]">
                    {data.seasonal.peak_months.join(", ")}
                  </span>
                </div>
              )}
              {data.seasonal.slow_months.length > 0 && (
                <div>
                  <span className="font-mono text-[11px] text-text-3 uppercase block">
                    [{t("financial.seasonal.slowMonths")}]
                  </span>
                  <span className="font-mohave text-[13px] text-[#C4A868]">
                    {data.seasonal.slow_months.join(", ")}
                  </span>
                </div>
              )}
            </div>

            {/* Service patterns */}
            {data.seasonal.service_patterns.length > 0 && (
              <div>
                <span className="font-mono text-[11px] text-text-3 uppercase block mb-1">
                  [{t("financial.seasonal.servicePatterns")}]
                </span>
                <div className="space-y-1">
                  {data.seasonal.service_patterns.map((sp, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="font-mohave text-[12px] text-text-2">
                        {sp.service}
                      </span>
                      <span className="font-mono text-[11px] text-[#A5B368]">
                        {sp.peak_months.join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

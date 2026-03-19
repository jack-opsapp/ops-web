"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, useSpring } from "framer-motion";
import { Trophy, XCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getWeightedValue,
  getActiveStages,
  getStageDisplayName,
  formatCurrency,
  isActiveStage,
} from "@/lib/types/pipeline";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineMetricsBarProps {
  opportunities: Opportunity[];
  clients: Map<string, string>;
  onOpenDetail: (opportunity: Opportunity) => void;
  isLoading: boolean;
}

interface StageDistData {
  stage: OpportunityStage;
  name: string;
  count: number;
  value: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Animated number — spring count-up (heavily damped, no bounce)
// ---------------------------------------------------------------------------

function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(format(value));
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 80, damping: 25 });

  useEffect(() => {
    if (prefersReducedMotion) {
      motionVal.jump(value);
      setDisplay(format(value));
    } else {
      motionVal.set(value);
    }
  }, [value, motionVal, prefersReducedMotion, format]);

  useEffect(() => {
    return spring.on("change", (latest) => {
      setDisplay(format(Math.round(latest)));
    });
  }, [spring, format]);

  return <span>{display}</span>;
}

// ---------------------------------------------------------------------------
// Stage distribution bar — proportional segments with hover tooltips
// ---------------------------------------------------------------------------

const ACTIVE_STAGES = getActiveStages();

function StageDistributionBar({ stages }: { stages: StageDistData[] }) {
  const total = stages.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="h-[8px] rounded-full bg-[rgba(255,255,255,0.04)]" />
    );
  }

  return (
    <div className="flex items-center gap-[2px] h-[8px]">
      {stages.map((s) => {
        if (s.count === 0) return null;
        const widthPercent = (s.count / total) * 100;

        return (
          <div
            key={s.stage}
            className="h-full rounded-[2px] relative group/seg cursor-default transition-all duration-700"
            style={{
              width: `${widthPercent}%`,
              backgroundColor: s.color,
              opacity: 0.7,
              transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {/* Hover: brighten */}
            <div className="absolute inset-0 bg-white/0 group-hover/seg:bg-white/10 transition-colors duration-150 rounded-[2px]" />

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[6px] opacity-0 group-hover/seg:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
              <div className="bg-[rgba(10,10,10,0.90)] backdrop-blur-[12px] border border-[rgba(255,255,255,0.1)] rounded-[4px] px-[8px] py-[4px] whitespace-nowrap flex items-center gap-[6px]">
                <span
                  className="w-[5px] h-[5px] rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-mohave text-body-sm text-text-primary">
                  {s.name}
                </span>
                <span className="font-mono text-[11px] text-text-tertiary">
                  {s.count}
                </span>
                <span className="font-mohave text-body-sm text-text-disabled">
                  {formatCurrency(s.value)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Win rate ring — SVG radial progress
// ---------------------------------------------------------------------------

function WinRateRing({ rate }: { rate: number }) {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  // Color: green >= 50%, amber >= 25%, red < 25%
  const color =
    rate >= 50 ? "#A5B368" : rate >= 25 ? "#C4A868" : "#93321A";

  // On mount, animate from empty (circumference) to filled
  // On reduced motion, show filled immediately
  const dashOffset =
    prefersReducedMotion || !mounted
      ? circumference * (1 - rate / 100)
      : circumference * (1 - rate / 100);

  const initialOffset = !mounted ? circumference : undefined;

  return (
    <div className="flex flex-col items-center gap-[4px]">
      <svg viewBox="0 0 44 44" className="w-[44px] h-[44px]">
        {/* Track */}
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="3"
        />
        {/* Fill arc */}
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? dashOffset : circumference}
          transform="rotate(-90 22 22)"
          style={{
            transition: prefersReducedMotion
              ? "none"
              : "stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
        {/* Center percentage */}
        <text
          x="22"
          y="22"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          className="text-text-primary"
          style={{ fontSize: "13px", fontFamily: "Mohave, sans-serif" }}
        >
          {rate}%
        </text>
      </svg>
      <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.12em]">
        WIN RATE
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proportion bar — mini horizontal fill showing value vs pipeline total
// ---------------------------------------------------------------------------

function ProportionBar({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;

  return (
    <div className="w-full h-[3px] rounded-full bg-[rgba(255,255,255,0.04)] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${pct}%`,
          backgroundColor: color,
          opacity: 0.6,
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function MetricDivider() {
  return (
    <div className="h-[40px] w-px bg-[rgba(255,255,255,0.06)] self-center shrink-0" />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelineMetricsBar({
  opportunities,
  clients,
  onOpenDetail,
  isLoading,
}: PipelineMetricsBarProps) {
  const { t } = useDictionary("pipeline");
  const prefersReducedMotion = useReducedMotion();

  const [expandedPanel, setExpandedPanel] = useState<"won" | "lost" | null>(
    null
  );

  // -- Compute all metrics ---------------------------------------------------
  const metrics = useMemo(() => {
    const activeDeals = opportunities.filter((opp) =>
      isActiveStage(opp.stage)
    );
    const wonDeals = opportunities.filter(
      (opp) => opp.stage === OpportunityStage.Won
    );
    const lostDeals = opportunities.filter(
      (opp) => opp.stage === OpportunityStage.Lost
    );

    const pipelineValue = activeDeals.reduce(
      (sum, opp) => sum + getWeightedValue(opp),
      0
    );
    const activeCount = activeDeals.length;

    const wonCount = wonDeals.length;
    const wonValue = wonDeals.reduce(
      (sum, opp) => sum + (opp.actualValue ?? opp.estimatedValue ?? 0),
      0
    );

    const lostCount = lostDeals.length;
    const lostValue = lostDeals.reduce(
      (sum, opp) => sum + (opp.actualValue ?? opp.estimatedValue ?? 0),
      0
    );

    const conversionDenom = wonCount + lostCount;
    const conversionRate =
      conversionDenom > 0
        ? Math.round((wonCount / conversionDenom) * 100)
        : 0;

    return {
      pipelineValue,
      activeCount,
      wonCount,
      wonValue,
      wonDeals,
      lostCount,
      lostValue,
      lostDeals,
      conversionRate,
    };
  }, [opportunities]);

  // -- Stage distribution data -----------------------------------------------
  const stageData = useMemo<StageDistData[]>(() => {
    return ACTIVE_STAGES.map((stage) => {
      const stageOpps = opportunities.filter(
        (o) => o.stage === stage
      );
      return {
        stage,
        name: getStageDisplayName(stage),
        count: stageOpps.length,
        value: stageOpps.reduce(
          (s, o) => s + (o.estimatedValue ?? 0),
          0
        ),
        color: OPPORTUNITY_STAGE_COLORS[stage],
      };
    });
  }, [opportunities]);

  // -- Expandable panel data -------------------------------------------------
  const expandedDeals =
    expandedPanel === "won"
      ? metrics.wonDeals
      : expandedPanel === "lost"
        ? metrics.lostDeals
        : [];

  const expandedColor =
    expandedPanel === "won"
      ? OPPORTUNITY_STAGE_COLORS[OpportunityStage.Won]
      : OPPORTUNITY_STAGE_COLORS[OpportunityStage.Lost];

  function resolveName(opp: Opportunity): string {
    if (opp.clientId) {
      return clients.get(opp.clientId) ?? opp.contactName ?? "Unknown";
    }
    return opp.contactName ?? "Unknown";
  }

  // -- Currency formatter ref for AnimatedNumber -----------------------------
  const formatCurrencyRef = useRef(formatCurrency);

  return (
    <div className="bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] rounded-[4px] overflow-hidden">
      {/* ── Metrics row ──────────────────────────────────────────────── */}
      <div className="flex items-stretch">
        {/* 1. Pipeline Value */}
        <div className="flex flex-col justify-center px-4 py-[10px] shrink-0">
          <span className="font-mohave text-[22px] leading-tight text-text-primary">
            {isLoading ? (
              "--"
            ) : (
              <AnimatedNumber
                value={metrics.pipelineValue}
                format={formatCurrencyRef.current}
              />
            )}
          </span>
          <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.12em] mt-[2px]">
            {t("metrics.pipelineValue")}
          </span>
        </div>

        <MetricDivider />

        {/* 2. Stage Distribution (flex center — the visual centerpiece) */}
        <div className="flex-1 flex flex-col justify-center px-4 py-[10px] gap-[6px] min-w-0">
          <StageDistributionBar stages={stageData} />

          {/* Stage legend: colored dots + counts */}
          <div className="flex items-center gap-[10px]">
            {stageData.map((s) => (
              <div
                key={s.stage}
                className="flex items-center gap-[3px]"
                title={`${s.name}: ${s.count}`}
              >
                <span
                  className="w-[5px] h-[5px] rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-mono text-[12px] text-text-disabled">
                  {s.count}
                </span>
              </div>
            ))}
            <span className="font-kosugi text-[11px] text-text-disabled uppercase tracking-[0.08em] ml-auto hidden sm:inline">
              {metrics.activeCount} {t("metrics.active").toLowerCase()}
            </span>
          </div>
        </div>

        <MetricDivider />

        {/* 3. Win Rate Ring */}
        <div className="flex items-center justify-center px-4 py-[8px] shrink-0">
          <WinRateRing rate={isLoading ? 0 : metrics.conversionRate} />
        </div>

        <MetricDivider />

        {/* 4. Won — clickable */}
        <button
          onClick={() =>
            setExpandedPanel((prev) => (prev === "won" ? null : "won"))
          }
          className={cn(
            "flex flex-col items-center justify-center px-4 py-[8px] shrink-0 cursor-pointer transition-colors group/won",
            expandedPanel === "won"
              ? "bg-[rgba(165,179,104,0.06)]"
              : "hover:bg-[rgba(255,255,255,0.02)]"
          )}
        >
          <div className="flex items-center gap-[6px]">
            <Trophy
              className="w-[14px] h-[14px] shrink-0"
              style={{
                color:
                  expandedPanel === "won"
                    ? OPPORTUNITY_STAGE_COLORS[OpportunityStage.Won]
                    : "var(--text-tertiary, #777)",
              }}
            />
            <span className="font-mohave text-body-lg text-text-primary">
              {isLoading ? "--" : metrics.wonCount}
            </span>
          </div>
          {!isLoading && metrics.wonValue > 0 && (
            <span className="font-mohave text-body-sm text-text-tertiary">
              {formatCurrency(metrics.wonValue)}
            </span>
          )}
          {/* Mini proportion bar */}
          {!isLoading && (
            <div className="w-[48px] mt-[4px]">
              <ProportionBar
                value={metrics.wonValue}
                total={metrics.pipelineValue + metrics.wonValue + metrics.lostValue}
                color={OPPORTUNITY_STAGE_COLORS[OpportunityStage.Won]}
              />
            </div>
          )}
          <div className="flex items-center gap-[2px] mt-[2px]">
            <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.12em]">
              {t("metrics.won")}
            </span>
            <ChevronDown
              className={cn(
                "w-[10px] h-[10px] text-text-disabled transition-transform duration-200",
                expandedPanel === "won" && "rotate-180"
              )}
            />
          </div>
        </button>

        <MetricDivider />

        {/* 5. Lost — clickable */}
        <button
          onClick={() =>
            setExpandedPanel((prev) => (prev === "lost" ? null : "lost"))
          }
          className={cn(
            "flex flex-col items-center justify-center px-4 py-[8px] shrink-0 cursor-pointer transition-colors group/lost",
            expandedPanel === "lost"
              ? "bg-[rgba(147,50,26,0.06)]"
              : "hover:bg-[rgba(255,255,255,0.02)]"
          )}
        >
          <div className="flex items-center gap-[6px]">
            <XCircle
              className="w-[14px] h-[14px] shrink-0"
              style={{
                color:
                  expandedPanel === "lost"
                    ? OPPORTUNITY_STAGE_COLORS[OpportunityStage.Lost]
                    : "var(--text-tertiary, #777)",
              }}
            />
            <span className="font-mohave text-body-lg text-text-primary">
              {isLoading ? "--" : metrics.lostCount}
            </span>
          </div>
          {!isLoading && metrics.lostValue > 0 && (
            <span className="font-mohave text-body-sm text-text-tertiary">
              {formatCurrency(metrics.lostValue)}
            </span>
          )}
          {/* Mini proportion bar */}
          {!isLoading && (
            <div className="w-[48px] mt-[4px]">
              <ProportionBar
                value={metrics.lostValue}
                total={metrics.pipelineValue + metrics.wonValue + metrics.lostValue}
                color={OPPORTUNITY_STAGE_COLORS[OpportunityStage.Lost]}
              />
            </div>
          )}
          <div className="flex items-center gap-[2px] mt-[2px]">
            <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.12em]">
              LOST
            </span>
            <ChevronDown
              className={cn(
                "w-[10px] h-[10px] text-text-disabled transition-transform duration-200",
                expandedPanel === "lost" && "rotate-180"
              )}
            />
          </div>
        </button>
      </div>

      {/* ── Expandable deals panel ─────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expandedPanel && (
          <motion.div
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { height: 0, opacity: 0 }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { height: "auto", opacity: 1 }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { height: 0, opacity: 0 }
            }
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="overflow-hidden"
          >
            <div className="border-t border-[rgba(255,255,255,0.06)] px-3 py-[8px]">
              {expandedDeals.length > 0 ? (
                <div className="flex flex-wrap gap-[6px]">
                  {expandedDeals.map((deal) => (
                    <button
                      key={deal.id}
                      onClick={() => onOpenDetail(deal)}
                      className="flex items-center gap-[8px] px-[10px] py-[6px] rounded-[4px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.14)] transition-colors cursor-pointer"
                    >
                      <span
                        className="w-[5px] h-[5px] rounded-full shrink-0"
                        style={{ backgroundColor: expandedColor }}
                      />
                      <span className="font-mohave text-body-sm text-text-primary truncate max-w-[140px]">
                        {resolveName(deal)}
                      </span>
                      <span className="font-mohave text-body-sm text-text-tertiary shrink-0">
                        {deal.actualValue ?? deal.estimatedValue
                          ? formatCurrency(
                              deal.actualValue ?? deal.estimatedValue ?? 0
                            )
                          : "--"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="font-mohave text-body-sm text-text-disabled">
                  {expandedPanel === "won"
                    ? "No won deals yet"
                    : "No lost deals"}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

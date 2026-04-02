"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import type { Project } from "@/lib/types/models";
import { ProjectStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function backlogColor(weeks: number): string {
  if (weeks >= 3 && weeks <= 6) return WT.success;
  if ((weeks >= 1 && weeks < 3) || (weeks > 6 && weeks <= 8)) return WT.warning;
  return WT.error;
}

function backlogLabel(weeks: number, t: (key: string) => string | undefined): string {
  if (weeks >= 3 && weeks <= 6) return t("backlogDepth.healthy") ?? "Healthy";
  if ((weeks >= 1 && weeks < 3) || (weeks > 6 && weeks <= 8)) return t("backlogDepth.caution") ?? "Caution";
  return t("backlogDepth.risk") ?? "Risk";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface BacklogDepthWidgetProps {
  size: WidgetSize;
  projects: Project[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BacklogDepthWidget({
  size,
  projects,
  isLoading,
  onNavigate,
}: BacklogDepthWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const reducedMotion = useReducedMotion();

  const backlog = useMemo(() => {
    const signedProjects = projects.filter(
      (p) => !p.deletedAt && (p.status === ProjectStatus.Accepted || p.status === ProjectStatus.InProgress)
    );

    if (signedProjects.length === 0) return { weeks: 0, projectCount: 0 };

    let totalDays = 0;
    for (const p of signedProjects) {
      if (p.duration && p.duration > 0) {
        totalDays += p.duration;
      } else {
        totalDays += 5; // Fallback: 5 days per project
      }
    }

    const weeks = Math.round((totalDays / 5) * 10) / 10;
    return { weeks, projectCount: signedProjects.length };
  }, [projects]);

  const animatedWeeks = useAnimatedValue(isVisible ? Math.round(backlog.weeks * 10) : 0, 1000);
  const displayWeeks = (animatedWeeks / 10).toFixed(1);
  const color = backlogColor(backlog.weeks);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("backlogDepth.title") ?? "Backlog"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (backlog.projectCount === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/projects")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("backlogDepth.noPending") ?? "No signed projects pending"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("backlogDepth.viewProjects") ?? "View Projects"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // Gauge scale constants
  const maxWeeks = 10;
  const gaugePct = Math.min((backlog.weeks / maxWeeks) * 100, 100);

  // ── XS: Hero weeks + color ────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/projects")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none" style={{ color }}>
            {displayWeeks}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("backlogDepth.weeks") ?? "wk"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + gauge bar + status label ─────────────────────────
  if (size === "sm") {
    const gaugeHeight = 8;
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
              {displayWeeks}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/projects"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          {/* Row 3: Gauge bar + status label */}
          <div className="relative w-full rounded-sm overflow-hidden mt-1.5" style={{ height: `${gaugeHeight}px` }}>
            <div className="absolute inset-0 flex">
              <div className="h-full" style={{ width: "10%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "30%", backgroundColor: WT.successMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
            </div>
            <div
              className="absolute top-0 h-full w-[3px] rounded-sm transition-all"
              style={{
                left: isVisible ? `${gaugePct}%` : "0%",
                backgroundColor: color,
                transitionDuration: reducedMotion ? "200ms" : "600ms",
                transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
          </div>
          <span className="font-kosugi text-micro-sm uppercase tracking-wider mt-1 block" style={{ color }}>
            {backlogLabel(backlog.weeks, t)}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD: Hero + gauge + detail + footer ─────────────────────────────────
  const gaugeHeight = 10;
  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {backlog.projectCount} {t("backlogDepth.projects") ?? "projects"}
          </span>
        </div>

        {/* HERO */}
        <div className="flex items-center gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold`} style={{ color }}>
            {displayWeeks}
          </span>
          <div className="flex flex-col">
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("backlogDepth.weeks") ?? "wk"}</span>
            <span className="font-kosugi text-micro-sm uppercase" style={{ color }}>{backlogLabel(backlog.weeks, t)}</span>
          </div>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            {/* Gauge */}
            <div className="relative w-full rounded-sm overflow-hidden" style={{ height: `${gaugeHeight}px` }}>
              <div className="absolute inset-0 flex">
                <div className="h-full" style={{ width: "10%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "30%", backgroundColor: WT.successMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "20%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
              </div>
              <div
                className="absolute top-0 h-full w-[3px] rounded-sm transition-all"
                style={{
                  left: isVisible ? `${gaugePct}%` : "0%",
                  backgroundColor: color,
                  transitionDuration: reducedMotion ? "200ms" : "600ms",
                  transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-kosugi text-micro-sm text-text-disabled uppercase">0</span>
              <span className="font-kosugi text-micro-sm text-text-disabled uppercase">10+ {t("backlogDepth.weeks") ?? "wk"}</span>
            </div>
          </ScrollFade>
        )}

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/projects")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("backlogDepth.viewProjects") ?? "View Projects"}
          </button>
        )}
      </div>
    </Card>
  );
}

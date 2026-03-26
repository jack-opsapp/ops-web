"use client";

import { useMemo, useRef } from "react";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Project } from "@/lib/types/models";
import { ProjectStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Color zones
// ---------------------------------------------------------------------------
function backlogColor(weeks: number): string {
  if (weeks >= 3 && weeks <= 6) return "#6B8F71";  // Healthy
  if ((weeks >= 1 && weeks < 3) || (weeks > 6 && weeks <= 8)) return "#C4A868"; // Caution
  return "#B58289"; // Risk (< 1 or > 8)
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BacklogDepthWidget({
  size,
  projects,
  isLoading,
}: BacklogDepthWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const backlog = useMemo(() => {
    // Accepted or In Progress projects = signed work
    const signedProjects = projects.filter(
      (p) => !p.deletedAt && (p.status === ProjectStatus.Accepted || p.status === ProjectStatus.InProgress)
    );

    if (signedProjects.length === 0) return { weeks: 0, projectCount: 0 };

    // Estimate weeks of work: sum of project durations / 5 (work days per week)
    let totalDays = 0;
    for (const p of signedProjects) {
      if (p.duration && p.duration > 0) {
        totalDays += p.duration;
      } else {
        // Fallback: estimate 5 days per project
        totalDays += 5;
      }
    }

    const weeks = Math.round((totalDays / 5) * 10) / 10; // One decimal
    return { weeks, projectCount: signedProjects.length };
  }, [projects]);

  const animatedWeeks = useAnimatedValue(isVisible ? Math.round(backlog.weeks * 10) : 0, 1000);
  const displayWeeks = (animatedWeeks / 10).toFixed(1);
  const color = backlogColor(backlog.weeks);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("backlogDepth.title") ?? "Backlog"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (backlog.projectCount === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("backlogDepth.title") ?? "Backlog"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex flex-col items-start justify-center h-[calc(100%-28px)]">
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("backlogDepth.noPending") ?? "No signed projects pending"}
          </span>
        </CardContent>
      </Card>
    );
  }

  // ── XS ──────────────────────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full flex flex-col items-start justify-center px-3" ref={ref}>
        <span className="font-mono text-[28px] font-medium leading-none" style={{ color }}>
          {displayWeeks}
        </span>
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider mt-1">
          {t("backlogDepth.weeks") ?? "wk"}
        </span>
      </Card>
    );
  }

  // ── SM: Bullet gauge ───────────────────────────────────────────────────
  // Gauge: 0-10 weeks scale, with zone bands
  const maxWeeks = 10;
  const gaugePct = Math.min((backlog.weeks / maxWeeks) * 100, 100);

  if (size === "sm") {
    return (
      <Card className="h-full" ref={ref}>
        <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("backlogDepth.title") ?? "Backlog"}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {backlog.projectCount} {t("backlogDepth.projects") ?? "projects"}
          </span>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[20px] font-medium" style={{ color }}>
              {displayWeeks}
            </span>
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase">
              {t("backlogDepth.weeks") ?? "wk"}
            </span>
          </div>
          {/* Gauge bar */}
          <div className="relative w-full h-[8px] rounded-sm overflow-hidden">
            {/* Zone bands */}
            <div className="absolute inset-0 flex">
              <div className="h-full" style={{ width: "10%", backgroundColor: "rgba(181,130,137,0.2)" }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: "rgba(196,168,104,0.2)" }} />
              <div className="h-full" style={{ width: "30%", backgroundColor: "rgba(107,143,113,0.2)" }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: "rgba(196,168,104,0.2)" }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: "rgba(181,130,137,0.2)" }} />
            </div>
            {/* Indicator */}
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
          <span className="font-kosugi text-[9px] uppercase tracking-wider mt-1 block" style={{ color }}>
            {backlogLabel(backlog.weeks, t)}
          </span>
        </CardContent>
      </Card>
    );
  }

  // ── MD: Gauge + detail ──────────────────────────────────────────────────
  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("backlogDepth.title") ?? "Backlog"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">
          {backlog.projectCount} {t("backlogDepth.projects") ?? "projects"}
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-[24px] font-medium" style={{ color }}>
            {displayWeeks}
          </span>
          <div className="flex flex-col">
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase">{t("backlogDepth.weeks") ?? "wk"}</span>
            <span className="font-kosugi text-[9px] uppercase" style={{ color }}>{backlogLabel(backlog.weeks, t)}</span>
          </div>
        </div>
        {/* Gauge */}
        <div className="relative w-full h-[10px] rounded-sm overflow-hidden">
          <div className="absolute inset-0 flex">
            <div className="h-full" style={{ width: "10%", backgroundColor: "rgba(181,130,137,0.2)" }} />
            <div className="h-full" style={{ width: "20%", backgroundColor: "rgba(196,168,104,0.2)" }} />
            <div className="h-full" style={{ width: "30%", backgroundColor: "rgba(107,143,113,0.2)" }} />
            <div className="h-full" style={{ width: "20%", backgroundColor: "rgba(196,168,104,0.2)" }} />
            <div className="h-full" style={{ width: "20%", backgroundColor: "rgba(181,130,137,0.2)" }} />
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
          <span className="font-mono text-[9px] text-text-quaternary">0</span>
          <span className="font-mono text-[9px] text-text-quaternary">10+ wk</span>
        </div>
      </CardContent>
    </Card>
  );
}

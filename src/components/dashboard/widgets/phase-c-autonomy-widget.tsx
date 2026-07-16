"use client";

/**
 * PhaseCAutonomyWidget — Inbox v2 dashboard widget.
 *
 * Weekly summary of what Phase C did + per-category autonomy levels.
 *
 * Metrics shown:
 *   - AUTO    — auto_send / auto_follow_up / auto_archive triggers this week
 *   - DRAFT   — drafts generated for user review (auto_draft outcomes)
 *   - SURFACED — new CUSTOMER + URGENT + PLATFORM_BID threads surfaced
 *
 * Per-category bars (MD+): horizontal stripe colored by autonomy level, one
 * row per non-off category. Click a row → deep-link to
 * /settings/email-category-autonomy.
 */

import { useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WidgetTitle } from "./shared/widget-title";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { isCompact, WT } from "@/lib/widget-tokens";
import { cn } from "@/lib/utils/cn";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadAutonomyLevel,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import {
  categoryDotClassName,
  categoryLabel,
} from "@/components/ops/inbox/category-chip";

interface PhaseCAutonomyWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

interface PhaseCWeekData {
  auto: number;
  draft: number;
  surfaced: number;
  autonomyMap: Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
}

// ─── Data ────────────────────────────────────────────────────────────────────

async function fetchWeekData(): Promise<PhaseCWeekData> {
  const response = await authedFetch("/api/agent/phase-c-week-summary");
  if (!response.ok) {
    throw new Error("Failed to load Phase C summary");
  }
  return (await response.json()) as PhaseCWeekData;
}

// ─── Level → color + label ───────────────────────────────────────────────────

// Autonomy ramp by how much the agent acts on its own: passive grays →
// bright-neutral "prepares a draft, waits for you" → earth-tone "acts
// autonomously". Tokenized (no hardcoded hex); auto_draft is bright-neutral
// (text-2), NEVER the steel-blue accent — accent is CTA/focus only (DESIGN.md §3).
function levelTone(level: EmailThreadAutonomyLevel): { bg: string; fg: string; label: string } {
  switch (level) {
    case "auto_send":
      return { bg: "color-mix(in srgb, var(--olive) 18%, transparent)", fg: "var(--olive)", label: "Auto-send" };
    case "auto_follow_up":
      return { bg: "color-mix(in srgb, var(--olive) 12%, transparent)", fg: "var(--olive)", label: "Auto follow-up" };
    case "auto_archive":
      return { bg: "color-mix(in srgb, var(--tan) 14%, transparent)", fg: "var(--tan)", label: "Auto-archive" };
    case "auto_draft":
      return { bg: "color-mix(in srgb, var(--text-2) 12%, transparent)", fg: "var(--text-2)", label: "Auto-draft" };
    case "draft_on_request":
      return { bg: "var(--surface-input)", fg: "var(--text-3)", label: "On request" };
    case "off":
      return { bg: "rgba(255,255,255,0.02)", fg: "var(--text-mute)", label: "Off" };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhaseCAutonomyWidget({ size, config: _config }: PhaseCAutonomyWidgetProps) {
  const { t: _t } = useDictionary("dashboard");
  const router = useRouter();
  const { currentUser } = useAuthStore();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const _reducedMotion = useReducedMotion();

  const { data, isLoading } = useQuery({
    queryKey: ["phase-c-autonomy-widget", currentUser?.id ?? ""],
    queryFn: fetchWeekData,
    enabled: !!currentUser?.id && isVisible,
    refetchInterval: 120_000,
  });

  const navigateSettings = useCallback(() => {
    router.push("/settings/email-category-autonomy");
  }, [router]);

  const activeCategories = useMemo(() => {
    if (!data) return [];
    return EMAIL_THREAD_CATEGORIES.filter((c) => data.autonomyMap[c] !== "off");
  }, [data]);

  const auto = data?.auto ?? 0;
  const draft = data?.draft ?? 0;
  const surfaced = data?.surfaced ?? 0;
  const total = auto + draft + surfaced;

  // ── Compact (XS/SM) ───────────────────────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0 cursor-pointer group" ref={ref} onClick={navigateSettings}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-display font-bold text-text leading-none tabular-nums">
                {isLoading ? "—" : total}
              </span>
              <WidgetTitle className="mt-1 block">Phase C · 7d</WidgetTitle>
            </div>
            <Sparkles className="w-[14px] h-[14px] text-text-mute group-hover:text-text-2 transition-colors" strokeWidth={1.75} />
          </div>

          {size === "sm" && total > 0 && (
            <div className="mt-auto pt-2 flex items-center gap-2">
              <MiniBar value={auto} total={total} color="var(--olive)" label="AUTO" />
              <MiniBar value={draft} total={total} color="var(--text-2)" label="DRAFT" />
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ── Expanded (MD/LG) ──────────────────────────────────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>Phase C · last 7 days</WidgetTitle>
          <button
            type="button"
            onClick={navigateSettings}
            className="font-mono text-micro uppercase tracking-[0.16em] text-text-mute hover:text-text-2 transition-colors inline-flex items-center gap-1"
          >
            Configure
            <ArrowUpRight className="w-[11px] h-[11px]" />
          </button>
        </div>

        {/* Metric row */}
        <div className="flex items-stretch gap-3 mb-3">
          <MetricCell value={auto} label="Auto" tone="var(--olive)" />
          <MetricCell value={draft} label="Drafts" tone="var(--text-2)" />
          <MetricCell value={surfaced} label="Surfaced" tone="var(--tan)" />
        </div>

        {/* Per-category bars */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {activeCategories.length === 0 ? (
            <div className="py-6 flex flex-col items-start">
              <p className="font-mono text-micro uppercase tracking-[0.16em] text-text-mute">
                {"// Phase C standing by"}
              </p>
              <p className="font-mohave text-[12.5px] text-text-2 mt-1">
                Nothing configured yet.
              </p>
              <p className="font-mohave text-[11.5px] text-text-3 mt-0.5">
                Flip a category to auto-draft to hand work over.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {activeCategories.map((cat) => {
                const level = data!.autonomyMap[cat];
                const tone = levelTone(level);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={navigateSettings}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 rounded-chip",
                      "hover:bg-surface-hover transition-colors text-left"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "w-[6px] h-[6px] rounded-full shrink-0",
                        categoryDotClassName(cat)
                      )}
                    />
                    <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2 min-w-[110px]">
                      {categoryLabel(cat)}
                    </span>
                    <span
                      aria-hidden
                      className="flex-1 h-[6px] rounded-bar relative overflow-hidden"
                      style={{ backgroundColor: WT.fillNeutralDim }}
                    >
                      <span
                        className="absolute left-0 top-0 bottom-0"
                        style={{
                          width: "100%",
                          backgroundColor: tone.bg,
                          borderLeft: `2px solid ${tone.fg}`,
                        }}
                      />
                    </span>
                    <span
                      className="font-mono text-micro uppercase tracking-[0.14em] tabular-nums min-w-[76px] text-right"
                      style={{ color: tone.fg }}
                    >
                      {tone.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Small sub-components ────────────────────────────────────────────────────

function MiniBar({
  value,
  total,
  color,
  label,
}: {
  value: number;
  total: number;
  color: string;
  label: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="h-[3px] rounded-[1px] bg-fill-neutral-dim overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="font-mono text-micro uppercase tracking-[0.14em] text-text-mute mt-1 tabular-nums">
        {label} {value}
      </p>
    </div>
  );
}

function MetricCell({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div
      className="flex-1 rounded px-2.5 py-2 border"
      style={{
        borderColor: `color-mix(in srgb, ${tone} 20%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${tone} 6%, transparent)`,
      }}
    >
      <p className="font-mono text-data-sm text-text tabular-nums" style={{ color: tone }}>
        {value}
      </p>
      <p className="font-cakemono font-light uppercase text-cake-badge tracking-[0.18em] text-text-3 mt-1">
        {label}
      </p>
    </div>
  );
}

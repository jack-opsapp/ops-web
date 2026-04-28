"use client";

/**
 * PhaseCAutonomyWidget — Inbox v2 dashboard widget.
 *
 * Weekly summary of what Phase C did + per-category autonomy levels.
 *
 * Metrics shown:
 *   - AUTO    — auto_send / auto_follow_up / auto_archive triggers this week
 *   - DRAFT   — drafts generated for user review (auto_draft outcomes)
 *   - SURFACED — new LEAD + URGENT + PLATFORM_BID threads surfaced
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
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { isCompact, WT } from "@/lib/widget-tokens";
import { cn } from "@/lib/utils/cn";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadAutonomyLevel,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import {
  categoryDotColor,
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

async function fetchWeekData(companyId: string): Promise<PhaseCWeekData> {
  const supabase = requireSupabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // 1. Auto = completed pending_auto_sends in the last 7 days.
  const autoCountPromise = supabase
    .from("pending_auto_sends")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "sent")
    .gte("sent_at", sevenDaysAgo);

  // 2. Draft = ai_draft_history rows with status='drafted' created in last 7d.
  const draftCountPromise = supabase
    .from("ai_draft_history")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "drafted")
    .gte("created_at", sevenDaysAgo);

  // 3. Surfaced = LEAD + PLATFORM_BID threads + threads with URGENT label,
  //    created in the last 7 days.
  const surfacedPromise = supabase
    .from("email_threads")
    .select("id, primary_category, labels")
    .eq("company_id", companyId)
    .gte("first_message_at", sevenDaysAgo);

  // 4. Autonomy map — merge across all connections for the company.
  const autonomyPromise = supabase
    .from("email_connections")
    .select("auto_send_settings")
    .eq("company_id", companyId);

  const [autoCount, draftCount, surfaced, autonomy] = await Promise.all([
    autoCountPromise,
    draftCountPromise,
    surfacedPromise,
    autonomyPromise,
  ]);

  const surfacedCount =
    ((surfaced.data as Array<{
      primary_category: string;
      labels: string[] | null;
    }> | null) ?? []).filter((row) =>
      row.primary_category === "LEAD" ||
      row.primary_category === "PLATFORM_BID" ||
      (Array.isArray(row.labels) && row.labels.includes("URGENT"))
    ).length;

  // Merge category_autonomy across connections — latest non-off wins.
  const mergedMap = {} as Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
  for (const c of EMAIL_THREAD_CATEGORIES) mergedMap[c] = "off";

  for (const row of (autonomy.data ?? []) as Array<{
    auto_send_settings: Record<string, unknown> | null;
  }>) {
    const settings = row.auto_send_settings ?? {};
    const catMap = (settings.category_autonomy as Record<string, string>) ?? {};
    for (const cat of EMAIL_THREAD_CATEGORIES) {
      const value = catMap[`primary:${cat}`] as EmailThreadAutonomyLevel | undefined;
      if (value && value !== "off" && mergedMap[cat] === "off") {
        mergedMap[cat] = value;
      }
    }
  }

  return {
    auto: autoCount.count ?? 0,
    draft: draftCount.count ?? 0,
    surfaced: surfacedCount,
    autonomyMap: mergedMap,
  };
}

// ─── Level → color + label ───────────────────────────────────────────────────

function levelTone(level: EmailThreadAutonomyLevel): { bg: string; fg: string; label: string } {
  switch (level) {
    case "auto_send":
      return { bg: "rgba(157,181,130,0.18)", fg: "#9DB582", label: "Auto-send" };
    case "auto_follow_up":
      return { bg: "rgba(157,181,130,0.12)", fg: "#9DB582", label: "Auto follow-up" };
    case "auto_archive":
      return { bg: "rgba(196,168,104,0.14)", fg: "#C4A868", label: "Auto-archive" };
    case "auto_draft":
      return { bg: "rgba(111,148,176,0.14)", fg: "#6F94B0", label: "Auto-draft" };
    case "draft_on_request":
      return { bg: "rgba(255,255,255,0.04)", fg: "#8A8A8A", label: "On request" };
    case "off":
      return { bg: "rgba(255,255,255,0.02)", fg: "#6A6A6A", label: "Off" };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhaseCAutonomyWidget({ size, config: _config }: PhaseCAutonomyWidgetProps) {
  const { t: _t } = useDictionary("dashboard");
  const router = useRouter();
  const { company } = useAuthStore();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const _reducedMotion = useReducedMotion();

  const { data, isLoading } = useQuery({
    queryKey: ["phase-c-autonomy-widget", company?.id ?? ""],
    queryFn: () => fetchWeekData(company!.id),
    enabled: !!company?.id && isVisible,
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
              <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.18em] text-text-3 mt-1 block">
                Phase C · 7d
              </span>
            </div>
            <Sparkles className="w-[14px] h-[14px] text-text-mute group-hover:text-text-2 transition-colors" strokeWidth={1.75} />
          </div>

          {size === "sm" && total > 0 && (
            <div className="mt-auto pt-2 flex items-center gap-2">
              <MiniBar value={auto} total={total} color="#9DB582" label="AUTO" />
              <MiniBar value={draft} total={total} color="#6F94B0" label="DRAFT" />
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
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {"// Phase C · last 7 days"}
          </span>
          <button
            type="button"
            onClick={navigateSettings}
            className="font-mono text-micro uppercase tracking-wider text-text-mute hover:text-text-2 transition-colors inline-flex items-center gap-1"
          >
            Configure
            <ArrowUpRight className="w-[11px] h-[11px]" />
          </button>
        </div>

        {/* Metric row */}
        <div className="flex items-stretch gap-3 mb-3">
          <MetricCell value={auto} label="Auto" tone="#9DB582" />
          <MetricCell value={draft} label="Drafts" tone="#6F94B0" />
          <MetricCell value={surfaced} label="Surfaced" tone="#C4A868" />
        </div>

        {/* Per-category bars */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {activeCategories.length === 0 ? (
            <div className="py-6 flex flex-col items-start">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
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
                      "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px]",
                      "hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                    )}
                  >
                    <span
                      aria-hidden
                      className="w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ backgroundColor: categoryDotColor(cat) }}
                    />
                    <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2 min-w-[110px]">
                      {categoryLabel(cat)}
                    </span>
                    <span
                      aria-hidden
                      className="flex-1 h-[6px] rounded-[2px] relative overflow-hidden"
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
                      className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums min-w-[76px] text-right"
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
      <div className="h-[3px] rounded-[1px] bg-[rgba(255,255,255,0.05)] overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-mute mt-1 tabular-nums">
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
      className="flex-1 rounded-[5px] px-2.5 py-2 border"
      style={{
        borderColor: `${tone}33`,
        backgroundColor: `${tone}0F`,
      }}
    >
      <p className="font-mono text-data-sm text-text tabular-nums" style={{ color: tone }}>
        {value}
      </p>
      <p className="font-cakemono font-light uppercase text-[10px] tracking-[0.18em] text-text-3 mt-1">
        {label}
      </p>
    </div>
  );
}

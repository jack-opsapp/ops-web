"use client";

/**
 * InboxLeadsWidget — Inbox v2 dashboard widget.
 *
 * Surfaces unread CUSTOMER thread count + 7-day median response-time
 * sparkline. Clicking the widget opens /inbox filtered to CUSTOMER. The
 * widget keeps the "LEADS" display label because the operator-facing surface
 * is still about new lead inflow — the underlying email category was just
 * unified post-migration.
 *
 * Data source: Supabase `email_threads` (unread CUSTOMER threads in the
 * current company) + `activities` (for response-time computation — each
 * CUSTOMER thread's first outbound after the first inbound).
 *
 * Responsive:
 *   - XS: big number + "LEADS"
 *   - SM: big number + sparkline + "NEW LEADS" + trend ctx
 *   - MD/LG: all of the above + median response-time readout + inline CTA
 */

import { useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Inbox, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WidgetTitle } from "./shared/widget-title";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { isCompact, WT } from "@/lib/widget-tokens";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

// ─── Props ───────────────────────────────────────────────────────────────────

interface InboxLeadsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ─── Data ────────────────────────────────────────────────────────────────────

interface InboxLeadsData {
  unreadCount: number;
  totalLastWeek: number;
  medianResponseSeconds: number | null;
  dailyCounts: number[]; // length 7, oldest → newest
}

async function fetchInboxLeadsData(
  companyId: string
): Promise<InboxLeadsData> {
  const supabase = requireSupabase();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  // 1. Unread CUSTOMER threads — current count.
  const { data: unreadRows } = await supabase
    .from("email_threads")
    .select("id, first_message_at, last_message_at, unread_count")
    .eq("company_id", companyId)
    .eq("primary_category", "CUSTOMER")
    .is("archived_at", null)
    .gt("unread_count", 0);

  const unreadCount = unreadRows?.length ?? 0;

  // 2. All CUSTOMER threads from the last 7 days — for sparkline + response time.
  const { data: weekRows } = await supabase
    .from("email_threads")
    .select("id, first_message_at, provider_thread_id")
    .eq("company_id", companyId)
    .eq("primary_category", "CUSTOMER")
    .gte("first_message_at", sevenDaysAgo.toISOString())
    .order("first_message_at", { ascending: true });

  const totalLastWeek = weekRows?.length ?? 0;

  // Build daily counts (length 7) by day bucket.
  const dailyCounts = new Array<number>(7).fill(0);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const row of weekRows ?? []) {
    const t = new Date(row.first_message_at as string).getTime();
    const diffDays = Math.floor((dayStart - t) / 86_400_000);
    if (diffDays >= 0 && diffDays < 7) {
      // Index 6 is today, index 0 is 6 days ago.
      dailyCounts[6 - diffDays] += 1;
    }
  }

  // 3. Response time — median (seconds) from first inbound to first outbound,
  // computed across the week's threads via activities joins.
  let medianResponseSeconds: number | null = null;
  if (weekRows && weekRows.length > 0) {
    const providerThreadIds = weekRows
      .map((r) => r.provider_thread_id as string)
      .filter(Boolean);

    if (providerThreadIds.length > 0) {
      const { data: acts } = await supabase
        .from("activities")
        .select("email_thread_id, direction, created_at")
        .eq("company_id", companyId)
        .eq("type", "email")
        .in("email_thread_id", providerThreadIds)
        .order("created_at", { ascending: true });

      const firstInbound = new Map<string, number>();
      const firstOutbound = new Map<string, number>();
      for (const a of (acts ?? []) as Array<{
        email_thread_id: string;
        direction: string;
        created_at: string;
      }>) {
        const id = a.email_thread_id;
        const ts = new Date(a.created_at).getTime();
        if (a.direction === "inbound" && !firstInbound.has(id)) {
          firstInbound.set(id, ts);
        } else if (a.direction === "outbound" && !firstOutbound.has(id)) {
          firstOutbound.set(id, ts);
        }
      }

      const diffs: number[] = [];
      for (const [id, inboundTs] of firstInbound) {
        const outboundTs = firstOutbound.get(id);
        if (outboundTs && outboundTs > inboundTs) {
          diffs.push((outboundTs - inboundTs) / 1000);
        }
      }
      if (diffs.length > 0) {
        diffs.sort((a, b) => a - b);
        const mid = Math.floor(diffs.length / 2);
        medianResponseSeconds =
          diffs.length % 2 === 0
            ? (diffs[mid - 1] + diffs[mid]) / 2
            : diffs[mid];
      }
    }
  }

  return { unreadCount, totalLastWeek, medianResponseSeconds, dailyCounts };
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

interface SparklineProps {
  values: number[];
  width: number;
  height: number;
  color: string;
}

function Sparkline({ values, width, height, color }: SparklineProps) {
  if (values.length === 0 || Math.max(...values) === 0) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke={WT.faint}
          strokeWidth={1}
        />
      </svg>
    );
  }
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * (height - 2) - 1;
    return `${x},${y}`;
  });
  const d = `M ${points.join(" L ")}`;
  return (
    <svg width={width} height={height} aria-hidden style={{ overflow: "visible" }}>
      <path d={d} stroke={color} strokeWidth={1.2} fill="none" strokeLinejoin="round" />
      {values.map((v, i) => {
        const x = i * stepX;
        const y = height - (v / max) * (height - 2) - 1;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={1.5}
            fill={color}
            opacity={i === values.length - 1 ? 1 : 0.5}
          />
        );
      })}
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InboxLeadsWidget({ size, config: _config }: InboxLeadsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const { company } = useAuthStore();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const _reducedMotion = useReducedMotion();
  // When inbox_ui is off for this company, CTA points to /pipeline instead.
  const inboxEnabled = useFeatureFlagsStore((s) => s.canAccessFeature("inbox_ui"));

  const { data, isLoading } = useQuery({
    queryKey: ["inbox-leads-widget", company?.id ?? ""],
    queryFn: () => fetchInboxLeadsData(company!.id),
    enabled: !!company?.id && isVisible,
    refetchInterval: 60_000,
  });

  const navigate = useCallback(() => {
    router.push(inboxEnabled ? "/inbox?category=LEAD&filter=needs_reply" : "/pipeline");
  }, [router, inboxEnabled]);

  const unread = data?.unreadCount ?? 0;
  const weekly = data?.totalLastWeek ?? 0;
  const median = data?.medianResponseSeconds ?? null;
  const daily = useMemo(() => data?.dailyCounts ?? new Array(7).fill(0), [data]);

  // ── Compact rendering (XS/SM) ────────────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card
        className="h-full p-0 cursor-pointer group"
        ref={ref}
        onClick={navigate}
      >
        <div className="h-full flex flex-col p-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-display font-bold text-text leading-none tabular-nums">
                {isLoading ? "—" : unread}
              </span>
              <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.18em] text-text-3 mt-1 block">
                New leads
              </span>
            </div>
            <ArrowUpRight className="w-[14px] h-[14px] text-text-mute group-hover:text-text-2 transition-colors" />
          </div>
          {size === "sm" && (
            <div className="mt-auto pt-2">
              <Sparkline values={daily} width={120} height={22} color={WT.accent} />
            </div>
          )}
          <WidgetTrendContext
            variant="snapshot"
            label={weekly > 0 ? `${weekly} / 7d` : t("trend.unread") ?? "Unread"}
          />
        </div>
      </Card>
    );
  }

  // ── Expanded rendering (MD/LG) ───────────────────────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>New leads</WidgetTitle>
          <button
            type="button"
            onClick={navigate}
            className="font-mono text-micro uppercase tracking-[0.16em] text-text-mute hover:text-text-2 transition-colors inline-flex items-center gap-1"
          >
            Open inbox
            <ArrowUpRight className="w-[11px] h-[11px]" />
          </button>
        </div>

        {/* Hero row */}
        <div className="flex items-end gap-4">
          <div className="flex flex-col">
            <span className="font-mono text-display font-bold text-text leading-none tabular-nums">
              {isLoading ? "—" : unread}
            </span>
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-text-mute mt-1">
              Unread in inbox
            </span>
          </div>

          <div className="flex-1" />

          <div className="flex flex-col items-end">
            <Sparkline values={daily} width={180} height={28} color={WT.accent} />
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-text-mute mt-1">
              Last 7 days · {weekly}
            </span>
          </div>
        </div>

        {/* Metric row */}
        <div className="mt-4 pt-3 border-t border-border-subtle flex items-center gap-6">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-text-mute">
              Median response
            </p>
            <p className="font-mono text-data-sm text-text mt-0.5 tabular-nums">
              {formatDuration(median)}
            </p>
          </div>
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-text-mute">
              New leads (7d)
            </p>
            <p className="font-mono text-data-sm text-text mt-0.5 tabular-nums">
              {weekly}
            </p>
          </div>
          <div className="flex-1 text-right">
            <Inbox className="w-[14px] h-[14px] text-text-mute inline-block" />
          </div>
        </div>
      </div>
    </Card>
  );
}

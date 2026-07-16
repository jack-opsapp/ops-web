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
 * Data source: the authenticated Inbox metrics endpoint, which applies the
 * same opportunity + inbox authorization intersection as the Inbox itself.
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

async function fetchInboxLeadsData(): Promise<InboxLeadsData> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");

  const response = await fetch("/api/inbox/widgets/leads", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Inbox metrics fetch failed: ${response.status}`);
  }
  return response.json();
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
    <svg
      width={width}
      height={height}
      aria-hidden
      style={{ overflow: "visible" }}
    >
      <path
        d={d}
        stroke={color}
        strokeWidth={1.2}
        fill="none"
        strokeLinejoin="round"
      />
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

export function InboxLeadsWidget({
  size,
  config: _config,
}: InboxLeadsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const { company } = useAuthStore();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const _reducedMotion = useReducedMotion();
  // When inbox_ui is off for this company, CTA points to /pipeline instead.
  const inboxEnabled = useFeatureFlagsStore((s) =>
    s.canAccessFeature("inbox_ui")
  );

  const { data, isLoading } = useQuery({
    queryKey: ["inbox-leads-widget", company?.id ?? ""],
    queryFn: fetchInboxLeadsData,
    enabled: !!company?.id && isVisible,
    refetchInterval: 60_000,
  });

  const navigate = useCallback(() => {
    router.push(
      inboxEnabled ? "/inbox?category=LEAD&filter=needs_reply" : "/pipeline"
    );
  }, [router, inboxEnabled]);

  const unread = data?.unreadCount ?? 0;
  const weekly = data?.totalLastWeek ?? 0;
  const median = data?.medianResponseSeconds ?? null;
  const daily = useMemo(
    () => data?.dailyCounts ?? new Array(7).fill(0),
    [data]
  );

  // ── Compact rendering (XS/SM) ────────────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card
        className="group h-full cursor-pointer p-0"
        ref={ref}
        onClick={navigate}
      >
        <div className="flex h-full flex-col p-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-display font-bold tabular-nums leading-none text-text">
                {isLoading ? "—" : unread}
              </span>
              <span className="mt-1 block font-cakemono text-[11px] font-light uppercase tracking-[0.18em] text-text-3">
                New leads
              </span>
            </div>
            <ArrowUpRight className="h-[14px] w-[14px] text-text-mute transition-colors group-hover:text-text-2" />
          </div>
          {size === "sm" && (
            <div className="mt-auto pt-2">
              <Sparkline
                values={daily}
                width={120}
                height={22}
                color={WT.accent}
              />
            </div>
          )}
          <WidgetTrendContext
            variant="snapshot"
            label={
              weekly > 0 ? `${weekly} / 7d` : (t("trend.unread") ?? "Unread")
            }
          />
        </div>
      </Card>
    );
  }

  // ── Expanded rendering (MD/LG) ───────────────────────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="flex h-full flex-col p-3">
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <WidgetTitle>New leads</WidgetTitle>
          <button
            type="button"
            onClick={navigate}
            className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-[0.16em] text-text-mute transition-colors hover:text-text-2"
          >
            Open inbox
            <ArrowUpRight className="h-[11px] w-[11px]" />
          </button>
        </div>

        {/* Hero row */}
        <div className="flex items-end gap-4">
          <div className="flex flex-col">
            <span className="font-mono text-display font-bold tabular-nums leading-none text-text">
              {isLoading ? "—" : unread}
            </span>
            <span className="mt-1 font-mono text-micro uppercase tracking-[0.18em] text-text-mute">
              Unread in inbox
            </span>
          </div>

          <div className="flex-1" />

          <div className="flex flex-col items-end">
            <Sparkline
              values={daily}
              width={180}
              height={28}
              color={WT.accent}
            />
            <span className="mt-1 font-mono text-micro uppercase tracking-[0.18em] text-text-mute">
              Last 7 days · {weekly}
            </span>
          </div>
        </div>

        {/* Metric row */}
        <div className="mt-4 flex items-center gap-6 border-t border-border-subtle pt-3">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-text-mute">
              Median response
            </p>
            <p className="mt-0.5 font-mono text-data-sm tabular-nums text-text">
              {formatDuration(median)}
            </p>
          </div>
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-text-mute">
              New leads (7d)
            </p>
            <p className="mt-0.5 font-mono text-data-sm tabular-nums text-text">
              {weekly}
            </p>
          </div>
          <div className="flex-1 text-right">
            <Inbox className="inline-block h-[14px] w-[14px] text-text-mute" />
          </div>
        </div>
      </div>
    </Card>
  );
}

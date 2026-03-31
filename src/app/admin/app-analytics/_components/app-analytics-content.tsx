"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminDonutChart } from "../../_components/charts/donut-chart";
import { FunnelChart } from "../../_components/charts/funnel-chart";
import { Sparkline } from "../../_components/sparkline";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type {
  ActiveUsersData,
  SessionData,
  FeatureUsageRow,
  FunnelStepData,
  ErrorRow,
  ChartDataPoint,
  AppAnalyticsPlatform,
} from "@/lib/admin/types";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "engagement" | "features" | "funnels";

interface AppAnalyticsContentProps {
  activeUsers: ActiveUsersData;
  sessions: SessionData;
  featureUsage: FeatureUsageRow[];
  funnel: FunnelStepData[];
  errors: ErrorRow[];
  syncTrend: ChartDataPoint[];
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchActiveUsers(platform: AppAnalyticsPlatform) {
  const from = new Date(Date.now() - 91 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const qs = new URLSearchParams({ from, to, platform });
  const res = await fetch(`/api/admin/app-analytics/active-users?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch active users");
  return (await res.json()).data as ActiveUsersData;
}

async function fetchFeatureUsage(platform: AppAnalyticsPlatform) {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const qs = new URLSearchParams({ from, to, platform });
  const res = await fetch(`/api/admin/app-analytics/feature-usage?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch feature usage");
  return (await res.json()).data as FeatureUsageRow[];
}

async function fetchFunnel(platform: AppAnalyticsPlatform, steps: string[]) {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const qs = new URLSearchParams({ from, to, platform, steps: steps.join(",") });
  const res = await fetch(`/api/admin/app-analytics/funnels?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch funnel");
  return (await res.json()).data as FunnelStepData[];
}

async function fetchErrors(platform: AppAnalyticsPlatform) {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const qs = new URLSearchParams({ from, to, platform, limit: "20" });
  const res = await fetch(`/api/admin/app-analytics/errors?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch errors");
  return (await res.json()).data as ErrorRow[];
}

async function fetchSessions(platform: AppAnalyticsPlatform) {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const qs = new URLSearchParams({ from, to, platform });
  const res = await fetch(`/api/admin/app-analytics/sessions?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return (await res.json()).data as SessionData;
}

async function fetchSyncTrend(platform: AppAnalyticsPlatform) {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const qs = new URLSearchParams({ from, to, platform });
  const res = await fetch(`/api/admin/app-analytics/sync-trend?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch sync trend");
  return (await res.json()).data as ChartDataPoint[];
}

// ─── Default Funnels ─────────────────────────────────────────────────────────

const PRESET_FUNNELS = [
  {
    label: "First Project",
    steps: ["sign_up", "complete_onboarding", "project_created", "task_created"],
  },
  {
    label: "Task Completion",
    steps: ["task_form", "task_created", "task_completed"],
  },
  {
    label: "Expense Logging",
    steps: ["accounting", "expense_logged"],
  },
] as const;

// ─── Platform Selector ──────────────────────────────────────────────────────

const PLATFORMS: { value: AppAnalyticsPlatform; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "ios", label: "iOS" },
  { value: "android", label: "ANDROID" },
  { value: "web", label: "WEB" },
];

function PlatformSelector({
  value,
  onChange,
}: {
  value: AppAnalyticsPlatform;
  onChange: (v: AppAnalyticsPlatform) => void;
}) {
  return (
    <div className="flex gap-1">
      {PLATFORMS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`px-3 py-1 font-kosugi text-[11px] uppercase tracking-wider rounded transition-colors ${
            value === p.value
              ? "bg-white/[0.08] text-[#E5E5E5]"
              : "text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.04]"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

const TABS: { value: Tab; label: string }[] = [
  { value: "engagement", label: "ENGAGEMENT OVERVIEW" },
  { value: "features", label: "FEATURE ADOPTION" },
  { value: "funnels", label: "FUNNELS & FRICTION" },
];

// ─── Column Defs ─────────────────────────────────────────────────────────────

const FEATURE_COLUMNS = [
  { key: "eventName", label: "Event" },
  { key: "totalCount", label: "Count" },
  { key: "companiesUsing", label: "Companies" },
  { key: "adoptionRate", label: "Adoption" },
  { key: "avgPerUserPerWeek", label: "Avg/User/Week" },
];

const ERROR_COLUMNS = [
  { key: "eventName", label: "Error" },
  { key: "count", label: "Count" },
  { key: "affectedUsers", label: "Users" },
  { key: "topProperty", label: "Top Cause" },
  { key: "lastSeen", label: "Last Seen" },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function AppAnalyticsContent({
  activeUsers,
  sessions,
  featureUsage,
  funnel,
  errors,
  syncTrend,
}: AppAnalyticsContentProps) {
  const [tab, setTab] = useState<Tab>("engagement");
  const [platform, setPlatform] = useState<AppAnalyticsPlatform>("all");
  const [selectedFunnel, setSelectedFunnel] = useState(0);

  // ── Queries (refetch on platform change) ─────────────────────────────────

  const activeUsersQuery = useQuery({
    queryKey: ["app-analytics-active-users", platform],
    queryFn: () => fetchActiveUsers(platform),
    initialData: platform === "all" ? activeUsers : undefined,
    staleTime: 0,
  });

  const sessionsQuery = useQuery({
    queryKey: ["app-analytics-sessions", platform],
    queryFn: () => fetchSessions(platform),
    initialData: platform === "all" ? sessions : undefined,
    staleTime: 0,
  });

  const featureQuery = useQuery({
    queryKey: ["app-analytics-features", platform],
    queryFn: () => fetchFeatureUsage(platform),
    initialData: platform === "all" ? featureUsage : undefined,
    staleTime: 0,
  });

  const funnelSteps = PRESET_FUNNELS[selectedFunnel].steps as unknown as string[];
  const funnelQuery = useQuery({
    queryKey: ["app-analytics-funnel", platform, selectedFunnel],
    queryFn: () => fetchFunnel(platform, funnelSteps),
    initialData: platform === "all" && selectedFunnel === 0 ? funnel : undefined,
    staleTime: 0,
  });

  const errorsQuery = useQuery({
    queryKey: ["app-analytics-errors", platform],
    queryFn: () => fetchErrors(platform),
    initialData: platform === "all" ? errors : undefined,
    staleTime: 0,
  });

  const syncTrendQuery = useQuery({
    queryKey: ["app-analytics-sync-trend", platform],
    queryFn: () => fetchSyncTrend(platform),
    initialData: platform === "all" ? syncTrend : undefined,
    staleTime: 0,
  });

  // ── Sort State ───────────────────────────────────────────────────────────

  const featureSort = useSortState("totalCount");
  const errorSort = useSortState("count");
  const sortedFeatures = featureSort.sorted(featureQuery.data ?? []);
  const sortedErrors = errorSort.sorted(errorsQuery.data ?? []);

  return (
    <div className="space-y-6">
      {/* Tab Bar + Platform Selector */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-4 py-2 font-mohave text-[13px] uppercase tracking-widest rounded transition-colors ${
                tab === t.value
                  ? "bg-white/[0.08] text-[#E5E5E5]"
                  : "text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.04]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <PlatformSelector value={platform} onChange={setPlatform} />
      </div>

      {/* ═══ TAB 1: Engagement Overview ═══ */}
      {tab === "engagement" && (
        <div className="space-y-6">
          {/* Active Users Sparkline (13-week trend) */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
              Active Users — Daily Trend [13 Weeks]
            </p>
            <AdminLineChart
              data={activeUsersQuery.data?.sparkline ?? []}
              color="#597794"
              height={240}
              isLoading={activeUsersQuery.isFetching && !activeUsersQuery.data?.sparkline?.length}
            />
          </div>

          {/* Platform Breakdown + Session Duration */}
          <div className="grid grid-cols-2 gap-6">
            <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
              <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
                Platform Breakdown
              </p>
              <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-4">
                [distinct users last 30 days]
              </p>
              <AdminDonutChart data={activeUsersQuery.data?.platformBreakdown ?? []} />
            </div>

            <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
              <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
                Avg Session Duration
              </p>
              <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-4">
                [seconds · from app_close lifecycle events]
              </p>
              <AdminLineChart
                data={sessionsQuery.data?.durationTrend ?? []}
                color="#C4A868"
                height={180}
                isLoading={sessionsQuery.isFetching && !sessionsQuery.data?.durationTrend?.length}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB 2: Feature Adoption ═══ */}
      {tab === "features" && (
        <div className="space-y-6">
          {/* Top Features Bar Chart */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
              Top Features by Usage [Last 30 Days]
            </p>
            <AdminBarChart
              data={(featureQuery.data ?? []).slice(0, 10).map((f) => ({
                label: f.eventName.replace(/_/g, " "),
                value: f.totalCount,
              }))}
              color="#597794"
              height={260}
              isLoading={featureQuery.isFetching && !featureQuery.data?.length}
            />
          </div>

          {/* Feature Table with Sparklines */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
              Feature Adoption Detail
            </p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <SortableTableHeader
                    columns={[
                      ...FEATURE_COLUMNS,
                      { key: "trend", label: "Weekly Trend" },
                    ]}
                    sort={featureSort.sort}
                    onSort={featureSort.toggle}
                  />
                </thead>
                <tbody>
                  {sortedFeatures.map((f) => (
                    <tr
                      key={f.eventName}
                      className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2.5 font-mohave text-[13px] text-[#E5E5E5] pr-3">
                        {f.eventName.replace(/_/g, " ")}
                      </td>
                      <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0] pr-3 text-right tabular-nums">
                        {f.totalCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0] pr-3 text-right tabular-nums">
                        {f.companiesUsing}
                      </td>
                      <td className="py-2.5 font-mohave text-[14px] text-[#E5E5E5] pr-3 text-right tabular-nums">
                        {f.adoptionRate}%
                      </td>
                      <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0] pr-3 text-right tabular-nums">
                        {f.avgPerUserPerWeek}
                      </td>
                      <td className="py-2.5 pr-1 w-[120px]">
                        {f.sparkline.length > 0 ? (
                          <Sparkline data={f.sparkline} height={28} color="#597794" />
                        ) : (
                          <span className="font-kosugi text-[11px] text-[#6B6B6B]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sortedFeatures.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center font-kosugi text-[12px] text-[#6B6B6B]">
                        [no action events in this period]
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB 3: Funnels & Friction ═══ */}
      {tab === "funnels" && (
        <div className="space-y-6">
          {/* Funnel Selector + Chart */}
          <div className="grid grid-cols-2 gap-6">
            <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
              <div className="flex items-center justify-between mb-6">
                <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
                  Conversion Funnel
                </p>
                <div className="flex gap-1">
                  {PRESET_FUNNELS.map((f, i) => (
                    <button
                      key={f.label}
                      onClick={() => setSelectedFunnel(i)}
                      className={`px-3 py-1 font-kosugi text-[11px] uppercase tracking-wider rounded transition-colors ${
                        selectedFunnel === i
                          ? "bg-white/[0.08] text-[#E5E5E5]"
                          : "text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.04]"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <FunnelChart
                steps={(funnelQuery.data ?? []).map((s) => ({
                  step: s.step,
                  count: s.count,
                }))}
              />
            </div>

            {/* Sync Failure Trend */}
            <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
              <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
                Sync Failure Trend
              </p>
              <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
                [sync_failed error events per day]
              </p>
              <AdminLineChart
                data={syncTrendQuery.data ?? []}
                color="#93321A"
                height={200}
                isLoading={syncTrendQuery.isFetching && !syncTrendQuery.data?.length}
              />
            </div>
          </div>

          {/* Error Inventory Table */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
              Error Inventory [Last 30 Days]
            </p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <SortableTableHeader
                    columns={ERROR_COLUMNS}
                    sort={errorSort.sort}
                    onSort={errorSort.toggle}
                  />
                </thead>
                <tbody>
                  {sortedErrors.map((e) => (
                    <tr
                      key={e.eventName}
                      className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2.5 font-mohave text-[13px] text-[#E5E5E5] pr-3">
                        {e.eventName.replace(/_/g, " ")}
                      </td>
                      <td className="py-2.5 font-mohave text-[14px] text-[#93321A] pr-3 text-right tabular-nums">
                        {e.count.toLocaleString()}
                      </td>
                      <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0] pr-3 text-right tabular-nums">
                        {e.affectedUsers}
                      </td>
                      <td className="py-2.5 font-kosugi text-[12px] text-[#6B6B6B] pr-3 max-w-[200px] truncate">
                        {e.topProperty ?? "—"}
                      </td>
                      <td className="py-2.5 font-kosugi text-[12px] text-[#6B6B6B] pr-3 whitespace-nowrap">
                        {formatLastSeen(e.lastSeen)}
                      </td>
                    </tr>
                  ))}
                  {sortedErrors.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center font-kosugi text-[12px] text-[#6B6B6B]">
                        [no error events in this period]
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime()); // guard against future timestamps (clock skew)

  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

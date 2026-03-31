/**
 * OPS Admin — App Analytics Queries
 *
 * Reads from the `analytics_events` Supabase table (service role).
 * Powers the /admin/app-analytics dashboard.
 */
import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type {
  ActiveUsersData,
  SessionData,
  FeatureUsageRow,
  FunnelStepData,
  ErrorRow,
  ChartDataPoint,
  DonutSegment,
  AppAnalyticsPlatform,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function db() {
  return getAdminSupabase();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── Active Users ────────────────────────────────────────────────────────────

async function _getActiveUsers(
  from: string,
  to: string,
  platform: AppAnalyticsPlatform
): Promise<ActiveUsersData> {
  const supabase = db();
  const now = new Date(to);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const monthStart = new Date(now.getTime() - 30 * 86_400_000);

  // Prior period for trend calculation
  const priorDayStart = new Date(dayStart.getTime() - 86_400_000);
  const priorWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);
  const priorMonthStart = new Date(monthStart.getTime() - 30 * 86_400_000);

  // Distinct user counts via RPC (efficient) with client-side fallback
  const fetchDistinctCount = async (start: Date, end: Date): Promise<number> => {
    let q = supabase
      .from("analytics_events")
      .select("user_id")
      .not("user_id", "is", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
    if (platform !== "all") q = q.eq("platform", platform);

    // Use RPC if available, fallback to client-side dedup
    const { data, error } = await supabase.rpc("count_distinct_users", {
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      platform_filter: platform === "all" ? null : platform,
    });

    if (!error && data !== null) return Number(data);

    // Fallback: fetch and deduplicate client-side (for smaller date ranges)
    const { data: rows } = await q.limit(50000);
    if (!rows) return 0;
    return new Set(rows.map((r: { user_id: string }) => r.user_id)).size;
  };

  const [dau, wau, mau, priorDau, priorWau, priorMau] = await Promise.all([
    fetchDistinctCount(dayStart, now),
    fetchDistinctCount(weekStart, now),
    fetchDistinctCount(monthStart, now),
    fetchDistinctCount(priorDayStart, dayStart),
    fetchDistinctCount(priorWeekStart, weekStart),
    fetchDistinctCount(priorMonthStart, monthStart),
  ]);

  // Trend = ((current - prior) / prior) * 100
  const trend = (current: number, prior: number) =>
    prior === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - prior) / prior) * 100);

  // Sparkline: daily distinct users over 13 weeks (91 days)
  const sparklineStart = new Date(now.getTime() - 91 * 86_400_000);
  const sparkline = await buildDailySparkline(sparklineStart, now, platform);

  // Platform breakdown
  const platformBreakdown = await getPlatformBreakdown(monthStart, now);

  return {
    dau,
    wau,
    mau,
    dauTrend: trend(dau, priorDau),
    wauTrend: trend(wau, priorWau),
    mauTrend: trend(mau, priorMau),
    sparkline,
    platformBreakdown,
  };
}

async function buildDailySparkline(
  start: Date,
  end: Date,
  platform: AppAnalyticsPlatform
): Promise<ChartDataPoint[]> {
  const supabase = db();
  let q = supabase
    .from("analytics_events")
    .select("user_id, created_at")
    .not("user_id", "is", null)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: true });

  if (platform !== "all") q = q.eq("platform", platform);
  const { data: rows } = await q.limit(100000);
  if (!rows || rows.length === 0) return [];

  // Group by date, count distinct user_ids
  const byDay = new Map<string, Set<string>>();
  for (const row of rows) {
    const day = new Date(row.created_at).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day)!.add(row.user_id);
  }

  // Fill gaps for days with zero events
  const result: ChartDataPoint[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    result.push({
      label: formatDate(cursor.toISOString()),
      value: byDay.get(key)?.size ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

async function getPlatformBreakdown(
  start: Date,
  end: Date
): Promise<DonutSegment[]> {
  const supabase = db();
  const { data: rows } = await supabase
    .from("analytics_events")
    .select("platform, user_id")
    .not("user_id", "is", null)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .limit(100000);

  if (!rows || rows.length === 0) return [];

  // Distinct users per platform
  const byPlatform = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!byPlatform.has(row.platform)) byPlatform.set(row.platform, new Set());
    byPlatform.get(row.platform)!.add(row.user_id);
  }

  const colors: Record<string, string> = {
    ios: "#597794",
    android: "#9DB582",
    web: "#C4A868",
  };

  return Array.from(byPlatform.entries()).map(([platform, users]) => ({
    name: platform.toUpperCase(),
    value: users.size,
    color: colors[platform] ?? "#6B6B6B",
  }));
}

export const getActiveUsers = unstable_cache(
  _getActiveUsers,
  ["app-analytics-active-users"],
  { revalidate: 300 }
);

// ─── Session Data ────────────────────────────────────────────────────────────

async function _getSessionData(
  from: string,
  to: string,
  platform: AppAnalyticsPlatform
): Promise<SessionData> {
  const supabase = db();

  // Get app_close events which contain session duration
  // duration_ms is a top-level column; properties.session_duration_ms is a fallback
  let q = supabase
    .from("analytics_events")
    .select("properties, duration_ms, created_at, platform, user_id, session_id")
    .eq("event_type", "lifecycle")
    .eq("event_name", "app_close")
    .gte("created_at", from)
    .lt("created_at", to);

  if (platform !== "all") q = q.eq("platform", platform);
  const { data: rows } = await q.limit(50000);

  if (!rows || rows.length === 0) {
    return {
      avgDurationMs: 0,
      sessionsPerUser: 0,
      totalSessions: 0,
      durationTrend: [],
      platformBreakdown: [],
    };
  }

  // Compute avg session duration — prefer top-level duration_ms, fall back to properties
  let totalDuration = 0;
  let durationCount = 0;
  const uniqueUsers = new Set<string>();
  const uniqueSessions = new Set<string>();

  const byDay = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    const dur = row.duration_ms
      ?? (row.properties as Record<string, unknown>)?.session_duration_ms;
    if (typeof dur === "number" && dur > 0) {
      totalDuration += dur;
      durationCount++;

      const day = new Date(row.created_at).toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { total: 0, count: 0 });
      const entry = byDay.get(day)!;
      entry.total += dur;
      entry.count++;
    }
    if (row.user_id) uniqueUsers.add(row.user_id);
    if (row.session_id) uniqueSessions.add(row.session_id);
  }

  const avgDurationMs = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
  const totalSessions = uniqueSessions.size || rows.length;
  const sessionsPerUser = uniqueUsers.size > 0
    ? Math.round((totalSessions / uniqueUsers.size) * 10) / 10
    : 0;

  // Duration trend: avg per day
  const durationTrend: ChartDataPoint[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { total, count }]) => ({
      label: formatDate(new Date(day).toISOString()),
      value: Math.round(total / count / 1000), // seconds
    }));

  // Platform breakdown for sessions
  const platformBreakdown = await getPlatformBreakdown(new Date(from), new Date(to));

  return {
    avgDurationMs,
    sessionsPerUser,
    totalSessions,
    durationTrend,
    platformBreakdown,
  };
}

export const getSessionData = unstable_cache(
  _getSessionData,
  ["app-analytics-sessions"],
  { revalidate: 300 }
);

// ─── Feature Usage ───────────────────────────────────────────────────────────

async function _getFeatureUsage(
  from: string,
  to: string,
  platform: AppAnalyticsPlatform
): Promise<FeatureUsageRow[]> {
  const supabase = db();

  // Get action + feature_use events (both represent feature engagement)
  let q = supabase
    .from("analytics_events")
    .select("event_name, user_id, company_id, platform, created_at")
    .in("event_type", ["action", "feature_use"])
    .gte("created_at", from)
    .lt("created_at", to);

  if (platform !== "all") q = q.eq("platform", platform);
  const { data: rows } = await q.limit(100000);

  if (!rows || rows.length === 0) return [];

  // Get total companies for adoption rate
  const { count: totalCompanies } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true });

  const total = totalCompanies ?? 1;

  // Aggregate by event_name
  const agg = new Map<
    string,
    {
      count: number;
      companies: Set<string>;
      users: Set<string>;
      weeklyEvents: Map<string, number>;
      platforms: { ios: number; android: number; web: number };
      daily: Map<string, number>;
    }
  >();

  for (const row of rows) {
    if (!agg.has(row.event_name)) {
      agg.set(row.event_name, {
        count: 0,
        companies: new Set(),
        users: new Set(),
        weeklyEvents: new Map(),
        platforms: { ios: 0, android: 0, web: 0 },
        daily: new Map(),
      });
    }
    const entry = agg.get(row.event_name)!;
    entry.count++;
    if (row.company_id) entry.companies.add(row.company_id);
    if (row.user_id) entry.users.add(row.user_id);

    const p = row.platform as "ios" | "android" | "web";
    if (p in entry.platforms) entry.platforms[p]++;

    // Weekly buckets for sparkline
    const d = new Date(row.created_at);
    const weekKey = getWeekKey(d);
    entry.weeklyEvents.set(weekKey, (entry.weeklyEvents.get(weekKey) ?? 0) + 1);
  }

  // Calculate weeks in range for avg per user per week
  const msRange = new Date(to).getTime() - new Date(from).getTime();
  const weeksInRange = Math.max(1, msRange / (7 * 86_400_000));

  const result: FeatureUsageRow[] = Array.from(agg.entries())
    .map(([eventName, data]) => {
      const sparkline: ChartDataPoint[] = Array.from(data.weeklyEvents.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, count]) => ({ label: week, value: count }));

      return {
        eventName,
        totalCount: data.count,
        companiesUsing: data.companies.size,
        adoptionRate: Math.round((data.companies.size / total) * 100),
        avgPerUserPerWeek:
          data.users.size > 0
            ? Math.round((data.count / data.users.size / weeksInRange) * 10) / 10
            : 0,
        sparkline,
        platformBreakdown: data.platforms,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount);

  return result;
}

function getWeekKey(d: Date): string {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  // Include short year to avoid collisions across year boundaries
  const yr = String(start.getFullYear()).slice(2);
  return `${start.getMonth() + 1}/${start.getDate()}/${yr}`;
}

export const getFeatureUsage = unstable_cache(
  _getFeatureUsage,
  ["app-analytics-feature-usage"],
  { revalidate: 300 }
);

// ─── Funnels ─────────────────────────────────────────────────────────────────

async function _getFunnelData(
  from: string,
  to: string,
  platform: AppAnalyticsPlatform,
  steps: string[]
): Promise<FunnelStepData[]> {
  if (steps.length === 0) return [];

  const supabase = db();

  // For each step, count distinct users who performed it
  const stepCounts = await Promise.all(
    steps.map(async (eventName) => {
      let q = supabase
        .from("analytics_events")
        .select("user_id")
        .eq("event_name", eventName)
        .not("user_id", "is", null)
        .gte("created_at", from)
        .lt("created_at", to);

      if (platform !== "all") q = q.eq("platform", platform);
      const { data: rows } = await q.limit(50000);
      if (!rows) return 0;
      return new Set(rows.map((r: { user_id: string }) => r.user_id)).size;
    })
  );

  return steps.map((eventName, i) => ({
    step: eventName.replace(/_/g, " "),
    eventName,
    count: stepCounts[i],
    dropOffRate:
      i === 0 || stepCounts[i - 1] === 0
        ? 0
        : Math.round((1 - stepCounts[i] / stepCounts[i - 1]) * 100),
  }));
}

export const getFunnelData = unstable_cache(
  _getFunnelData,
  ["app-analytics-funnels"],
  { revalidate: 300 }
);

// ─── Error Aggregation ───────────────────────────────────────────────────────

async function _getErrorAggregation(
  from: string,
  to: string,
  platform: AppAnalyticsPlatform,
  limit: number = 20
): Promise<ErrorRow[]> {
  const supabase = db();

  let q = supabase
    .from("analytics_events")
    .select("event_name, user_id, properties, created_at")
    .eq("event_type", "error")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });

  if (platform !== "all") q = q.eq("platform", platform);
  const { data: rows } = await q.limit(10000);

  if (!rows || rows.length === 0) return [];

  const agg = new Map<
    string,
    {
      count: number;
      users: Set<string>;
      lastSeen: string;
      propertyKeys: Map<string, number>;
    }
  >();

  for (const row of rows) {
    if (!agg.has(row.event_name)) {
      agg.set(row.event_name, {
        count: 0,
        users: new Set(),
        lastSeen: row.created_at,
        propertyKeys: new Map(),
      });
    }
    const entry = agg.get(row.event_name)!;
    entry.count++;
    if (row.user_id) entry.users.add(row.user_id);
    if (row.created_at > entry.lastSeen) entry.lastSeen = row.created_at;

    // Track top property value (error_type or endpoint)
    const props = row.properties as Record<string, unknown>;
    const key = (props?.error_type ?? props?.endpoint ?? props?.form_type ?? null) as
      | string
      | null;
    if (key) {
      entry.propertyKeys.set(key, (entry.propertyKeys.get(key) ?? 0) + 1);
    }
  }

  return Array.from(agg.entries())
    .map(([eventName, data]) => {
      // Find most common property value
      let topProperty: string | null = null;
      let topCount = 0;
      for (const [key, count] of data.propertyKeys) {
        if (count > topCount) {
          topProperty = key;
          topCount = count;
        }
      }

      return {
        eventName,
        count: data.count,
        lastSeen: data.lastSeen,
        affectedUsers: data.users.size,
        topProperty,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export const getErrorAggregation = unstable_cache(
  _getErrorAggregation,
  ["app-analytics-errors"],
  { revalidate: 300 }
);

// ─── Sync Failure Trend ──────────────────────────────────────────────────────

async function _getSyncFailureTrend(
  from: string,
  to: string,
  platform: AppAnalyticsPlatform
): Promise<ChartDataPoint[]> {
  const supabase = db();

  let q = supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_type", "error")
    .eq("event_name", "sync_failed")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: true });

  if (platform !== "all") q = q.eq("platform", platform);
  const { data: rows } = await q.limit(10000);

  if (!rows || rows.length === 0) return [];

  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = new Date(row.created_at).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({
      label: formatDate(new Date(day).toISOString()),
      value: count,
    }));
}

export const getSyncFailureTrend = unstable_cache(
  _getSyncFailureTrend,
  ["app-analytics-sync-trend"],
  { revalidate: 300 }
);

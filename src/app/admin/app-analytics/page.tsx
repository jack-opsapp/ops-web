import {
  getActiveUsers,
  getSessionData,
  getFeatureUsage,
  getFunnelData,
  getErrorAggregation,
  getSyncFailureTrend,
} from "@/lib/admin/app-analytics-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { AppAnalyticsContent } from "./_components/app-analytics-content";

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function trendDirection(pct: number): "up" | "down" | "flat" {
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
}

async function fetchDashboardData() {
  const now = new Date().toISOString();
  const from30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const from90d = new Date(Date.now() - 91 * 86_400_000).toISOString();

  const defaultFunnel = ["sign_up", "complete_onboarding", "project_created", "task_created"];

  const [activeUsers, sessions, featureUsage, funnel, errors, syncTrend] = await Promise.all([
    getActiveUsers(from90d, now, "all"),
    getSessionData(from30d, now, "all"),
    getFeatureUsage(from30d, now, "all"),
    getFunnelData(from30d, now, "all", defaultFunnel),
    getErrorAggregation(from30d, now, "all", 20),
    getSyncFailureTrend(from30d, now, "all"),
  ]);

  return { activeUsers, sessions, featureUsage, funnel, errors, syncTrend };
}

export default async function AppAnalyticsPage() {
  let data;
  try {
    data = await fetchDashboardData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">App Analytics Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#EDEDED] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="App Analytics"
        caption="analytics_events · real-time from Supabase · all platforms"
      />

      <div className="p-8 space-y-8">
        {/* Hero KPI Row */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Daily Active Users"
            value={data.activeUsers.dau}
            caption="last 24 hours"
            trend={{
              direction: trendDirection(data.activeUsers.dauTrend),
              value: `${Math.abs(data.activeUsers.dauTrend)}%`,
            }}
            sparklineData={data.activeUsers.sparkline.slice(-14)}
          />
          <StatCard
            label="Weekly Active Users"
            value={data.activeUsers.wau}
            caption="last 7 days"
            trend={{
              direction: trendDirection(data.activeUsers.wauTrend),
              value: `${Math.abs(data.activeUsers.wauTrend)}%`,
            }}
          />
          <StatCard
            label="Monthly Active Users"
            value={data.activeUsers.mau}
            caption="last 30 days"
            trend={{
              direction: trendDirection(data.activeUsers.mauTrend),
              value: `${Math.abs(data.activeUsers.mauTrend)}%`,
            }}
          />
          <StatCard
            label="Avg Session Duration"
            value={formatDuration(data.sessions.avgDurationMs)}
            caption={`${data.sessions.sessionsPerUser} sessions/user · ${data.sessions.totalSessions.toLocaleString()} total`}
          />
        </div>

        {/* Interactive content with tabs */}
        <AppAnalyticsContent
          activeUsers={data.activeUsers}
          sessions={data.sessions}
          featureUsage={data.featureUsage}
          funnel={data.funnel}
          errors={data.errors}
          syncTrend={data.syncTrend}
        />
      </div>
    </div>
  );
}

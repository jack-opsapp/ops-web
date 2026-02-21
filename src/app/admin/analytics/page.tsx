import { listAllAuthUsers, calcActiveUsers } from "@/lib/firebase/admin-sdk";
import {
  getOnboardingFunnel,
  getEventByDate,
  getTopScreens,
  getEventByPlatform,
  getFormAbandonment,
} from "@/lib/analytics/ga4-client";
import { AdminPageHeader } from "../_components/admin-page-header";
import { AnalyticsTabs } from "./_components/analytics-tabs";

export default async function AnalyticsPage() {
  // Fetch everything in parallel
  const [
    authUsers,
    onboardingFunnel,
    signupsByPlatform,
    taskCreatedByDate,
    projectCreatedByDate,
    topScreens,
    formAbandonment,
    teamInvitedByPlatform,
    subscribeByPlatform,
    beginTrialByPlatform,
  ] = await Promise.all([
    listAllAuthUsers(),
    getOnboardingFunnel(90),
    getEventByPlatform("sign_up", 30),
    getEventByDate("task_created", 30),
    getEventByDate("create_project", 30),
    getTopScreens(30),
    getFormAbandonment(30),
    getEventByPlatform("team_member_invited", 30),
    getEventByPlatform("subscribe", 90),
    getEventByPlatform("begin_trial", 90),
  ]);

  const { dau, wau, mau } = calcActiveUsers(authUsers);

  // Build signup trend by week from auth users
  const signupTrend = buildWeeklyTrend(authUsers.map((u) => u.metadata.creationTime ?? ""));

  return (
    <div>
      <AdminPageHeader title="Analytics" caption="GA4 data ~24-48hr delay · Auth data real-time" />
      <div className="p-8">
        <AnalyticsTabs
          dau={dau}
          wau={wau}
          mau={mau}
          signupTrend={signupTrend}
          signupsByPlatform={signupsByPlatform}
          onboardingFunnel={onboardingFunnel}
          taskCreatedByDate={taskCreatedByDate.map((d) => ({ label: d.dimension, value: d.count }))}
          projectCreatedByDate={projectCreatedByDate.map((d) => ({ label: d.dimension, value: d.count }))}
          topScreens={topScreens.map((d) => ({ label: d.dimension, value: d.count }))}
          formAbandonment={formAbandonment}
          teamInvitedByPlatform={teamInvitedByPlatform}
          subscribeByPlatform={subscribeByPlatform}
          beginTrialByPlatform={beginTrialByPlatform}
        />
      </div>
    </div>
  );
}

function buildWeeklyTrend(creationTimes: string[]) {
  const weeks: Record<string, number> = {};
  const now = Date.now();
  for (const t of creationTimes) {
    if (!t) continue;
    const diff = now - new Date(t).getTime();
    if (diff > 84 * 24 * 3_600_000) continue; // last 12 weeks
    const weekNum = Math.floor(diff / (7 * 24 * 3_600_000));
    const label = `W-${weekNum}`;
    weeks[label] = (weeks[label] ?? 0) + 1;
  }
  return Object.entries(weeks)
    .sort(([a], [b]) => b.localeCompare(a))
    .reverse()
    .map(([label, value]) => ({ label, value }));
}

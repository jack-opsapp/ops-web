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

const emptyEventData: { dimension: string; count: number }[] = [];
const emptyFunnel: { step: string; eventName: string; count: number }[] = [];

export default async function AnalyticsPage() {
  const ga4Available = !!process.env.GA4_PROPERTY_ID;

  try {
    // Firebase Auth data (always available)
    const authUsers = await listAllAuthUsers();
    const { dau, wau, mau } = calcActiveUsers(authUsers);
    const signupTrend = buildWeeklyTrend(authUsers.map((u) => u.metadata.creationTime ?? ""));

    // GA4 data (only if configured)
    let onboardingFunnel = emptyFunnel;
    let signupsByPlatform = emptyEventData;
    let taskCreatedByDate = emptyEventData;
    let projectCreatedByDate = emptyEventData;
    let topScreens = emptyEventData;
    let formAbandonment = emptyEventData;
    let teamInvitedByPlatform = emptyEventData;
    let subscribeByPlatform = emptyEventData;
    let beginTrialByPlatform = emptyEventData;

    if (ga4Available) {
      [
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
    }

    return (
      <div>
        <AdminPageHeader
          title="Analytics"
          caption={ga4Available
            ? "GA4 data ~24-48hr delay · Auth data real-time"
            : "GA4 not configured (set GA4_PROPERTY_ID) · showing Auth data only"
          }
        />
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
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Analytics Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }
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

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

/** Wrap a promise so it returns a fallback on error instead of rejecting. */
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}

const emptyEvents: { dimension: string; count: number }[] = [];
const emptyFunnel: { step: string; eventName: string; count: number }[] = [];

export default async function AnalyticsPage() {
  const ga4Available = !!process.env.GA4_PROPERTY_ID;

  try {
    // Firebase Auth data (always available)
    const authUsers = await listAllAuthUsers();
    const { dau, wau, mau } = calcActiveUsers(authUsers);
    const signupTrend = buildWeeklyTrend(authUsers.map((u) => u.metadata.creationTime ?? ""));

    // GA4 data — each call is individually wrapped so one bad query
    // doesn't take down the whole page (custom dimensions may not exist yet)
    const [
      onboardingFunnel,
      signupsByPlatform,
      taskCreatedByDate,
      projectCreatedByDate,
      topScreens,
      formAbandonment,
      teamInvitedByPlatform,
      subscribeByPlatform,
      beginTrialByPlatform,
    ] = ga4Available ? await Promise.all([
      safe(getOnboardingFunnel(90), emptyFunnel),
      safe(getEventByPlatform("sign_up", 30), emptyEvents),
      safe(getEventByDate("task_created", 30), emptyEvents),
      safe(getEventByDate("create_project", 30), emptyEvents),
      safe(getTopScreens(30), emptyEvents),
      safe(getFormAbandonment(30), emptyEvents),
      safe(getEventByPlatform("team_member_invited", 30), emptyEvents),
      safe(getEventByPlatform("subscribe", 90), emptyEvents),
      safe(getEventByPlatform("begin_trial", 90), emptyEvents),
    ]) : [emptyFunnel, emptyEvents, emptyEvents, emptyEvents, emptyEvents, emptyEvents, emptyEvents, emptyEvents, emptyEvents];

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

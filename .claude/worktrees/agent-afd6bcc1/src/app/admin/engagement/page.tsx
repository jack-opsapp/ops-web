import { listAllAuthUsers, calcActiveUsers } from "@/lib/firebase/admin-sdk";
import {
  getFeatureAdoption,
  getEngagementDistribution,
  getCohortRetention,
  getActiveUsersSparkline,
} from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { EngagementContent } from "./_components/engagement-content";

async function fetchEngagementData() {
  const [authUsers, featureAdoption, engagementDist, cohortRetention] = await Promise.all([
    listAllAuthUsers(),
    getFeatureAdoption(),
    getEngagementDistribution(),
    getCohortRetention(),
  ]);

  const { dau, wau, mau } = calcActiveUsers(authUsers);
  const activeUsersSparkline = getActiveUsersSparkline(authUsers, 13); // 90 days

  return { dau, wau, mau, activeUsersSparkline, featureAdoption, engagementDist, cohortRetention };
}

export default async function EngagementPage() {
  let data;
  try {
    data = await fetchEngagementData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Engagement Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Engagement" caption="Auth data real-time · entity data from Supabase" />

      <div className="p-8 space-y-8">
        {/* DAU/WAU/MAU */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Daily Active Users" value={data.dau} caption="last 24 hours" />
          <StatCard label="Weekly Active Users" value={data.wau} caption="last 7 days" />
          <StatCard label="Monthly Active Users" value={data.mau} caption="last 30 days" />
        </div>

        {/* Charts (client component for interactivity) */}
        <EngagementContent
          activeUsersSparkline={data.activeUsersSparkline}
          featureAdoption={data.featureAdoption}
          engagementDist={data.engagementDist}
          cohortRetention={data.cohortRetention}
        />
      </div>
    </div>
  );
}

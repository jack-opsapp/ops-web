import { AdminPageHeader } from "../_components/admin-page-header";
import { OnboardingContent } from "./_components/onboarding-content";
import {
  getOnboardingOverview,
  getOnboardingFunnel,
  getTriageBreakdown,
  getDailyOnboardingStats,
} from "@/lib/admin/onboarding-queries";

async function fetchOnboardingData() {
  const [overview, funnel, triage, daily] = await Promise.all([
    getOnboardingOverview(30),
    getOnboardingFunnel(30),
    getTriageBreakdown(30),
    getDailyOnboardingStats(30),
  ]);
  return { overview, funnel, triage, daily };
}

export default async function OnboardingPage() {
  let data;
  try {
    data = await fetchOnboardingData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">
          Onboarding Data Fetch Failed
        </h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Onboarding"
        caption="try-ops funnel, triage decisions, variant performance"
      />
      <div className="p-8">
        <OnboardingContent data={data} />
      </div>
    </div>
  );
}

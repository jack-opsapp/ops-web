import {
  getEventCountTotal,
  getEventByDimension,
} from "@/lib/analytics/ga4-client";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { AcquisitionCharts } from "./_components/acquisition-charts";

/** Wrap a promise so it returns a fallback on error instead of rejecting. */
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}

async function fetchAcquisitionData() {
  const ga4Available = !!process.env.GA4_PROPERTY_ID;
  if (!ga4Available) {
    return {
      ga4Available: false,
      landingPageViews: 0,
      ctaClicks: 0,
      ctr: 0,
      avgScrollDepth: 0,
      sectionEngagement: [],
      abVariants: [],
      tutorialFunnel: [],
      signupFunnel: [],
      megaFunnel: [],
    };
  }

  const [
    landingPageViews,
    ctaClicks,
    scrollDepthData,
    sectionEngagement,
    abVariantData,
    tutorialStepViews,
    tutorialComplete,
    tutorialSkip,
    signupStepViews,
    signupComplete,
    megaSteps,
  ] = await Promise.all([
    safe(getEventCountTotal("landing_page_view", 30), 0),
    safe(getEventCountTotal("landing_cta_click", 30), 0),
    safe(getEventByDimension("scroll_depth_milestone", "customEvent:depth", 30), []),
    safe(getEventByDimension("section_view", "customEvent:section", 30), []),
    safe(getEventByDimension("landing_page_view", "customEvent:variant", 30), []),
    safe(getEventByDimension("tutorial_step_view", "customEvent:step_id", 30), []),
    safe(getEventCountTotal("tutorial_complete", 30), 0),
    safe(getEventCountTotal("tutorial_skip", 30), 0),
    safe(getEventByDimension("signup_step_view", "customEvent:step_name", 30), []),
    safe(getEventCountTotal("signup_complete", 30), 0),
    safe(Promise.all([
      safe(getEventCountTotal("landing_page_view", 90), 0),
      safe(getEventCountTotal("landing_cta_click", 90), 0),
      safe(getEventCountTotal("tutorial_complete", 90), 0),
      safe(getEventCountTotal("signup_complete", 90), 0),
      safe(getEventCountTotal("sign_up", 90), 0),
      safe(getEventCountTotal("begin_trial", 90), 0),
      safe(getEventCountTotal("complete_onboarding", 90), 0),
      safe(getEventCountTotal("create_first_project", 90), 0),
    ]), [0, 0, 0, 0, 0, 0, 0, 0]),
  ]);

  const ctr = landingPageViews > 0 ? Math.round((ctaClicks / landingPageViews) * 100) : 0;

  // Calculate avg scroll depth from milestone data
  const depthValues = scrollDepthData.map((d) => parseInt(d.dimension) || 0);
  const avgScrollDepth = depthValues.length > 0
    ? Math.round(depthValues.reduce((a, b) => a + b, 0) / depthValues.length) : 0;

  // Tutorial funnel
  const tutorialStarted = tutorialStepViews.reduce((s, d) => s + d.count, 0);
  const tutorialHalfway = tutorialStepViews
    .filter((_, i) => i >= Math.floor(tutorialStepViews.length / 2))
    .reduce((s, d) => s + d.count, 0);
  const tutorialFunnel = [
    { step: "Started", count: tutorialStarted },
    { step: "Halfway", count: tutorialHalfway },
    { step: "Completed", count: tutorialComplete },
    { step: "Skipped", count: tutorialSkip },
  ];

  // Signup funnel from step views
  const signupFunnel = signupStepViews.map((d) => ({
    step: d.dimension,
    count: d.count,
  }));
  signupFunnel.push({ step: "Complete", count: signupComplete });

  // Mega funnel
  const megaFunnelSteps = [
    "Landing Page View", "CTA Click", "Tutorial Complete", "Signup Complete",
    "Sign Up (Firebase)", "Begin Trial", "Complete Onboarding", "First Project",
  ];
  const megaFunnel = megaSteps.map((count, i) => ({
    step: megaFunnelSteps[i],
    count,
  }));

  return {
    ga4Available: true,
    landingPageViews,
    ctaClicks,
    ctr,
    avgScrollDepth,
    sectionEngagement,
    abVariants: abVariantData,
    tutorialFunnel,
    signupFunnel,
    megaFunnel,
  };
}

export default async function AcquisitionPage() {
  let data;
  try {
    data = await fetchAcquisitionData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Acquisition Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Acquisition"
        caption={data.ga4Available
          ? "GA4 data ~24-48hr delay"
          : "GA4 not configured (set GA4_PROPERTY_ID)"
        }
      />

      <div className="p-8 space-y-8">
        {/* Landing Page KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Page Views" value={data.landingPageViews.toLocaleString()} caption="last 30 days" />
          <StatCard label="CTA Clicks" value={data.ctaClicks.toLocaleString()} caption="last 30 days" />
          <StatCard label="CTR" value={`${data.ctr}%`} />
          <StatCard label="Avg Scroll Depth" value={`${data.avgScrollDepth}%`} />
        </div>

        {/* Charts */}
        <AcquisitionCharts
          sectionEngagement={data.sectionEngagement}
          abVariants={data.abVariants}
          tutorialFunnel={data.tutorialFunnel}
          signupFunnel={data.signupFunnel}
          megaFunnel={data.megaFunnel}
        />
      </div>
    </div>
  );
}

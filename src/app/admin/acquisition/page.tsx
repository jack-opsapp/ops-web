import Link from "next/link";
import {
  getEventCountTotal,
  getEventByDimension,
  getPropertyId,
} from "@/lib/analytics/ga4-client";
import { isGA4PropertyConfigured } from "@/lib/analytics/ga4-properties";
import {
  isGoogleAdsConfigured,
  getCachedAccountSummary,
  getCachedCostPerConversion,
} from "@/lib/analytics/google-ads-client";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { AcquisitionCharts } from "./_components/acquisition-charts";
import { safe } from "@/lib/utils/safe";
import type { ConversionBreakdown } from "@/lib/analytics/google-ads-types";

async function fetchAcquisitionData() {
  const ga4Available = isGA4PropertyConfigured("marketing");
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
      ga4PropertyId: null,
    };
  }

  const ga4PropertyId = getPropertyId("marketing").replace("properties/", "");
  const adsConfigured = isGoogleAdsConfigured();

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
    adsSummary,
    adsConversions,
  ] = await Promise.all([
    getEventCountTotal("marketing", "landing_page_view", 30),
    getEventCountTotal("marketing", "landing_cta_click", 30),
    getEventByDimension(
      "marketing",
      "scroll_depth_milestone",
      "customEvent:depth",
      30
    ),
    getEventByDimension("marketing", "section_view", "customEvent:section", 30),
    getEventByDimension(
      "marketing",
      "landing_page_view",
      "customEvent:variant",
      30
    ),
    getEventByDimension(
      "marketing",
      "tutorial_step_view",
      "customEvent:step_id",
      30
    ),
    getEventCountTotal("marketing", "tutorial_complete", 30),
    getEventCountTotal("marketing", "tutorial_skip", 30),
    getEventByDimension(
      "marketing",
      "signup_step_view",
      "customEvent:step_name",
      30
    ),
    getEventCountTotal("marketing", "signup_complete", 30),
    Promise.all([
      getEventCountTotal("marketing", "landing_page_view", 90),
      getEventCountTotal("marketing", "landing_cta_click", 90),
      getEventCountTotal("marketing", "tutorial_complete", 90),
      getEventCountTotal("marketing", "signup_complete", 90),
      getEventCountTotal("marketing", "sign_up", 90),
      getEventCountTotal("marketing", "begin_trial", 90),
      getEventCountTotal("marketing", "complete_onboarding", 90),
      getEventCountTotal("marketing", "create_first_project", 90),
    ]),
    adsConfigured ? safe(getCachedAccountSummary(30), null) : Promise.resolve(null),
    adsConfigured ? safe(getCachedCostPerConversion(30), [] as ConversionBreakdown[]) : Promise.resolve([] as ConversionBreakdown[]),
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
    adsSummary,
    adsConversions,
    ga4PropertyId,
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
        <pre className="text-[13px] text-[#EDEDED] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
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
          ? `MARKETING GA4 · PROPERTY ${data.ga4PropertyId} · 24–48H DELAY`
          : "MARKETING GA4 · NOT CONFIGURED"
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

        {/* Paid Acquisition — Google Ads */}
        {data.adsSummary && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-micro uppercase tracking-wider text-[#6B6B6B]">
                Paid Acquisition
              </p>
              <Link
                href="/admin/google-ads"
                className="font-mono text-[11px] text-[#6F94B0] hover:text-[#EDEDED] transition-colors"
              >
                View details &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Ad Spend (30d)"
                value={`$${data.adsSummary.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              />
              <StatCard
                label="Paid Signups"
                value={(() => {
                  const signup = data.adsConversions.find(
                    (c) => c.actionName.toLowerCase().includes("signup") || c.actionName.toLowerCase().includes("trial")
                  );
                  return signup ? signup.conversions.toFixed(0) : "\u2014";
                })()}
              />
              <StatCard
                label="Paid CPA"
                value={(() => {
                  const signup = data.adsConversions.find(
                    (c) => c.actionName.toLowerCase().includes("signup") || c.actionName.toLowerCase().includes("trial")
                  );
                  return signup ? `$${signup.cpa.toFixed(2)}` : "\u2014";
                })()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

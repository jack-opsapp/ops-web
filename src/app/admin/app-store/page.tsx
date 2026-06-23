import { AdminPageHeader } from "@/app/admin/_components/admin-page-header";
import { isAppStoreConfigured } from "@/lib/analytics/app-store-client";
import {
  getAscKpis,
  getAscConversionSeries,
  getAscTrafficSeries,
  getAscSourceBreakdown,
  getAscTerritories,
  getAscIngestState,
} from "@/lib/admin/app-store-queries";
import { AppStoreContent } from "./_components/app-store-content";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;

function defaultRange() {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - DEFAULT_DAYS * 86_400_000).toISOString();
  return { from, to, granularity: "daily" as const };
}

function StatePanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-8">
      <div className="max-w-xl rounded-[10px] border border-white/[0.09] bg-[#121214]/60 p-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A8A]">// {title}</p>
        <p className="mt-3 text-[14px] leading-relaxed text-[#B5B5B5]">{body}</p>
      </div>
    </div>
  );
}

export default async function AppStorePage() {
  const configured = isAppStoreConfigured();
  const ingest = await getAscIngestState(configured);

  if (!configured) {
    return (
      <div>
        <AdminPageHeader title="APP STORE" caption="APP STORE CONNECT · ACQUISITION FUNNEL" />
        <StatePanel
          title="SETUP REQUIRED"
          body="Connect App Store Connect to pull live conversion data. Add the API key, issuer ID, private key, and numeric app ID to the environment, then the daily sync takes over."
        />
      </div>
    );
  }

  if (!ingest.hasFacts && !ingest.hasProcessedInstance) {
    return (
      <div>
        <AdminPageHeader title="APP STORE" caption="APP STORE CONNECT · ACQUISITION FUNNEL" />
        <StatePanel
          title="AWAITING FIRST REPORT"
          body="Connected. Apple generates the first analytics report 24 to 48 hours after connection. Data lands automatically — nothing else to do."
        />
      </div>
    );
  }

  const range = defaultRange();
  let initial;
  try {
    const [kpis, conversion, traffic, source, territories] = await Promise.all([
      getAscKpis(range.from, range.to),
      getAscConversionSeries(range.from, range.to, range.granularity),
      getAscTrafficSeries(range.from, range.to, range.granularity),
      getAscSourceBreakdown(range.from, range.to),
      getAscTerritories(range.from, range.to, range.granularity),
    ]);
    initial = { ...range, kpis, conversion, traffic, source, territories };
  } catch (err: unknown) {
    return (
      <div>
        <AdminPageHeader title="APP STORE" caption="APP STORE CONNECT · ACQUISITION FUNNEL" />
        <div className="p-8">
          <h1 className="mb-4 font-mono text-[13px] text-[#B58289]">App Store data fetch failed</h1>
          <pre className="whitespace-pre-wrap rounded-[10px] bg-white/[0.05] p-4 text-[12px] text-[#EDEDED]">
            {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="APP STORE" caption="APP STORE CONNECT · ACQUISITION FUNNEL" />
      <AppStoreContent initial={initial} />
    </div>
  );
}

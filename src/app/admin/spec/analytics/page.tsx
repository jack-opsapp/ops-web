import { getSpecAnalyticsPayload } from "@/lib/admin/spec-analytics-queries";
import { getSpecTestMode } from "@/lib/admin/spec-test-mode";
import { SpecSubPageHeader } from "../_components/spec-sub-page-header";
import { SpecAnalyticsContent } from "./_components/spec-analytics-content";

export const dynamic = "force-dynamic";

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 13);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default async function SpecAnalyticsPage() {
  const testMode = await getSpecTestMode();
  const range = defaultDateRange();

  try {
    const payload = await getSpecAnalyticsPayload(range.from, range.to);

    return (
      <div className="flex min-h-screen flex-col bg-black">
        <SpecSubPageHeader
          title="ANALYTICS"
          testMode={testMode}
          backHref="/admin/spec"
          rightMeta={`${payload.summary.paidDeposits} DEPOSITS · ${payload.summary.adCampaignFilter}`}
        />
        <SpecAnalyticsContent initialPayload={payload} />
      </div>
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      <div className="flex min-h-screen flex-col bg-black">
        <SpecSubPageHeader
          title="ANALYTICS"
          testMode={testMode}
          backHref="/admin/spec"
          rightMeta="FETCH FAILED"
        />
        <div className="m-8 rounded-[10px] border border-[#B58289]/40 bg-[#B58289]/8 p-6">
          <h2 className="font-cakemono text-[15px] font-light uppercase text-[#B58289]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            SPEC ANALYTICS FETCH FAILED
          </h2>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] text-[#EDEDED]">
            {msg}
          </pre>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6A6A6A]">
            [check ads sync tables · GA4 credentials · service-role access]
          </p>
        </div>
      </div>
    );
  }
}

import { getPipelineStats, getFinancialStats, getPortalStats } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { PlatformHealthCharts } from "./_components/platform-health-charts";

async function fetchPlatformHealthData() {
  const [pipelineStats, financialStats, portalStats] = await Promise.all([
    getPipelineStats(),
    getFinancialStats(),
    getPortalStats(),
  ]);

  return { pipelineStats, financialStats, portalStats };
}

export default async function PlatformHealthPage() {
  let data;
  try {
    data = await fetchPlatformHealthData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Platform Health Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  const { pipelineStats, financialStats, portalStats } = data;

  return (
    <div>
      <AdminPageHeader title="Platform Health" caption="cross-company operational metrics" />

      <div className="p-8 space-y-8">
        {/* Pipeline KPIs */}
        <div>
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Pipeline
          </p>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Active Deals" value={pipelineStats.activeDeals} />
            <StatCard label="Pipeline Value" value={`$${pipelineStats.pipelineValue.toLocaleString()}`} />
            <StatCard label="Won This Month" value={pipelineStats.wonThisMonth} accent={pipelineStats.wonThisMonth > 0} />
            <StatCard label="Win Rate" value={`${pipelineStats.winRate}%`} />
          </div>
        </div>

        {/* Financial KPIs */}
        <div>
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Financials
          </p>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Estimates Total" value={`$${financialStats.estimateTotal.toLocaleString()}`} />
            <StatCard label="Approval Rate" value={`${financialStats.estimateApprovalRate}%`} />
            <StatCard label="Outstanding Invoices" value={`$${financialStats.outstandingInvoices.toLocaleString()}`} accent={financialStats.outstandingInvoices > 0} />
            <StatCard label="Payments (Month)" value={`$${financialStats.paymentsThisMonth.toLocaleString()}`} />
          </div>
        </div>

        {/* Portal KPIs */}
        <div>
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Portal & Integrations
          </p>
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Portal Enabled"
              value={portalStats.portalEnabled}
              caption={`of ${portalStats.total} companies`}
            />
            <StatCard label="Branding Configured" value={portalStats.brandingConfigured} />
            <StatCard label="Gmail Connected" value={portalStats.gmailConnected} />
            <StatCard label="Accounting Connected" value={portalStats.accountingConnected} />
          </div>
        </div>

        {/* Charts */}
        <PlatformHealthCharts
          stageDistribution={pipelineStats.stageDistribution}
          invoiceAging={financialStats.invoiceAging}
          estimateStatuses={financialStats.estimateStatuses}
        />
      </div>
    </div>
  );
}

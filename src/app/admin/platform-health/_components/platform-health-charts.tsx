"use client";

import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminDonutChart } from "../../_components/charts/donut-chart";
import type { PipelineStage, InvoiceAging } from "@/lib/admin/types";

const ESTIMATE_STATUS_COLORS: Record<string, string> = {
  draft: "#6B6B6B",
  sent: "#8195B5",
  approved: "#9DB582",
  rejected: "#93321A",
  expired: "#C4A868",
};

interface PlatformHealthChartsProps {
  stageDistribution: PipelineStage[];
  invoiceAging: InvoiceAging[];
  estimateStatuses: Record<string, number>;
}

export function PlatformHealthCharts({
  stageDistribution,
  invoiceAging,
  estimateStatuses,
}: PlatformHealthChartsProps) {
  const stageBarData = stageDistribution.map((s) => ({
    label: s.stage,
    value: s.count,
  }));

  const agingBarData = invoiceAging.map((a) => ({
    label: a.bucket,
    value: a.count,
  }));

  const estimateDonutData = Object.entries(estimateStatuses).map(([status, count]) => ({
    name: status,
    value: count,
    color: ESTIMATE_STATUS_COLORS[status] ?? "#6B6B6B",
  }));

  return (
    <div className="space-y-8">
      {/* Stage Distribution + Estimate Status */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Pipeline Stage Distribution
          </p>
          {stageBarData.length > 0 ? (
            <AdminBarChart data={stageBarData} color="#597794" />
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No pipeline data
            </p>
          )}
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Estimate Status Distribution
          </p>
          {estimateDonutData.length > 0 ? (
            <AdminDonutChart data={estimateDonutData} />
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No estimate data
            </p>
          )}
        </div>
      </div>

      {/* Invoice Aging */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
          Invoice Aging
        </p>
        <div className="grid grid-cols-2 gap-6">
          <AdminBarChart data={agingBarData} color="#C4A868" />
          <div className="space-y-0">
            <div className="grid grid-cols-3 py-2 border-b border-white/[0.08]">
              {["BUCKET", "COUNT", "AMOUNT"].map((h) => (
                <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
              ))}
            </div>
            {invoiceAging.map((a) => (
              <div key={a.bucket} className="grid grid-cols-3 py-2.5 border-b border-white/[0.05] last:border-0">
                <span className="font-mohave text-[13px] text-[#A0A0A0]">{a.bucket}</span>
                <span className="font-mohave text-[14px] text-[#E5E5E5]">{a.count}</span>
                <span className="font-mohave text-[14px] text-[#E5E5E5]">${a.totalAmount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

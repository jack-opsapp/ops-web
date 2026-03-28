"use client";

import { useState } from "react";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminDonutChart } from "../../_components/charts/donut-chart";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
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
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);
  const [selectedEstimateStatus, setSelectedEstimateStatus] = useState<string | null>(null);

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

  const agingSort = useSortState("totalAmount");
  const sortedAging = agingSort.sorted(invoiceAging);

  return (
    <div className="space-y-8">
      {/* Stage Distribution + Estimate Status */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Pipeline Stage Distribution
          </p>
          {stageBarData.length > 0 ? (
            <>
              <AdminBarChart
                data={stageBarData}
                color="#597794"
                onBarClick={(p) => {
                  const stage = stageDistribution.find((s) => s.stage === p.label);
                  setSelectedStage(stage ?? null);
                }}
              />
              {selectedStage && (
                <div className="mt-4 p-3 rounded bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mohave text-[13px] uppercase text-[#597794]">
                      {selectedStage.stage}
                    </span>
                    <button
                      onClick={() => setSelectedStage(null)}
                      className="font-kosugi text-[11px] text-[#6B6B6B] hover:text-[#E5E5E5]"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="font-kosugi text-[11px] text-[#6B6B6B]">Deals</p>
                      <p className="font-mohave text-[16px] text-[#E5E5E5]">{selectedStage.count}</p>
                    </div>
                    <div>
                      <p className="font-kosugi text-[11px] text-[#6B6B6B]">Total Value</p>
                      <p className="font-mohave text-[16px] text-[#E5E5E5]">${selectedStage.totalValue.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="font-kosugi text-[11px] text-[#6B6B6B]">Avg Days</p>
                      <p className="font-mohave text-[16px] text-[#E5E5E5]">{selectedStage.avgDays}d</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No pipeline data
            </p>
          )}
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-6">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
              Estimate Status Distribution
            </p>
            {selectedEstimateStatus && (
              <button
                onClick={() => setSelectedEstimateStatus(null)}
                className="font-kosugi text-[11px] text-[#597794] hover:text-[#E5E5E5] transition-colors"
              >
                Clear: {selectedEstimateStatus} &times;
              </button>
            )}
          </div>
          {estimateDonutData.length > 0 ? (
            <AdminDonutChart
              data={estimateDonutData}
              onSegmentClick={(seg) => {
                setSelectedEstimateStatus(
                  selectedEstimateStatus === seg.name ? null : seg.name
                );
              }}
            />
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
          <AdminBarChart
            data={agingBarData}
            color="#C4A868"
            onBarClick={(p) => {
              const bucket = invoiceAging.find((a) => a.bucket === p.label);
              if (bucket) {
                setSelectedStage(null);
              }
            }}
          />
          <table className="w-full">
            <thead>
              <SortableTableHeader
                columns={[
                  { key: "bucket", label: "Bucket" },
                  { key: "count", label: "Count" },
                  { key: "totalAmount", label: "Amount" },
                ]}
                sort={agingSort.sort}
                onSort={agingSort.toggle}
              />
            </thead>
            <tbody>
              {sortedAging.map((a) => (
                <tr key={a.bucket} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 font-mohave text-[13px] text-[#A0A0A0]">{a.bucket}</td>
                  <td className="py-2.5 font-mohave text-[14px] text-[#E5E5E5]">{a.count}</td>
                  <td className="py-2.5 font-mohave text-[14px] text-[#E5E5E5]">${a.totalAmount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

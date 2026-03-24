"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { CampaignPerformance } from "@/lib/analytics/google-ads-types";

const COLUMNS = [
  { key: "name", label: "Campaign" },
  { key: "status", label: "Status" },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "ctr", label: "CTR" },
  { key: "cost", label: "Cost" },
  { key: "conversions", label: "Conv." },
  { key: "cpa", label: "CPA" },
];

const STATUS_STYLES: Record<string, string> = {
  ENABLED: "bg-[#597794]/20 text-[#597794]",
  PAUSED: "bg-white/[0.06] text-[#6B6B6B]",
  REMOVED: "bg-white/[0.04] text-[#444444]",
};

interface CampaignTableProps {
  campaigns: CampaignPerformance[];
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
  const { sort, toggle, sorted } = useSortState("cost");

  if (campaigns.length === 0) {
    return (
      <div className="border-l-2 border-l-white/[0.08] py-3 px-3">
        <p className="font-mohave text-[14px] text-[#6B6B6B]">No campaign data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Campaign Performance
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <SortableTableHeader columns={COLUMNS} sort={sort} onSort={toggle} />
          </thead>
          <tbody>
            {sorted(campaigns).map((c) => (
              <tr
                key={c.name}
                className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100"
              >
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">{c.name}</td>
                <td className="py-3 pr-3">
                  <span className={`inline-block px-2 py-0.5 rounded font-mohave text-[11px] uppercase ${STATUS_STYLES[c.status] ?? STATUS_STYLES.PAUSED}`}>
                    {c.status}
                  </span>
                </td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{c.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{c.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{(c.ctr * 100).toFixed(1)}%</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${c.cost.toFixed(2)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{c.conversions.toFixed(1)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${c.cpa.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { KeywordPerformance } from "@/lib/analytics/google-ads-types";

const COLUMNS = [
  { key: "keyword", label: "Keyword" },
  { key: "matchType", label: "Match" },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "cost", label: "Cost" },
  { key: "conversions", label: "Conv." },
  { key: "qualityScore", label: "QS" },
];

function QualityScore({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-[#6B6B6B]">&mdash;</span>;
  }
  const color =
    score >= 7 ? "text-[#9DB582]" :
    score >= 4 ? "text-[#C4A868]" :
    "text-[#93321A]";
  return <span className={color}>{score}/10</span>;
}

interface KeywordTableProps {
  keywords: KeywordPerformance[];
}

export function KeywordTable({ keywords }: KeywordTableProps) {
  const { sort, toggle, sorted } = useSortState("cost");

  if (keywords.length === 0) {
    return (
      <div className="border-l-2 border-l-white/[0.08] py-3 px-3">
        <p className="font-mohave text-[14px] text-[#6B6B6B]">No keyword data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-mono text-micro uppercase tracking-wider text-[#6B6B6B] mb-4">
        Keyword Performance
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <SortableTableHeader columns={COLUMNS} sort={sort} onSort={toggle} />
          </thead>
          <tbody>
            {sorted(keywords).map((k, i) => (
              <tr
                key={`${k.keyword}-${i}`}
                className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100"
              >
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">{k.keyword}</td>
                <td className="py-3 pr-3">
                  <span className="font-mono text-micro text-[#6B6B6B] uppercase">
                    [{k.matchType}]
                  </span>
                </td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{k.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{k.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${k.cost.toFixed(2)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{k.conversions.toFixed(1)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] tabular-nums">
                  <QualityScore score={k.qualityScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { KeywordPerformance } from "@/lib/analytics/google-ads-types";

const CAD = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
    return <span className="text-text-mute">&mdash;</span>;
  }
  const color =
    score >= 7 ? "text-olive" :
    score >= 4 ? "text-tan" :
    "text-rose";
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
        <p className="font-mohave text-[14px] text-text-mute">No keyword data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-mono text-micro uppercase tracking-wider text-text-mute mb-4">
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
                <td className="py-3 pr-3 font-mohave text-[14px] text-text">{k.keyword}</td>
                <td className="py-3 pr-3">
                  <span className="font-mono text-micro text-text-mute uppercase">
                    [{k.matchType}]
                  </span>
                </td>
                <td className="py-3 pr-3 font-mono text-[14px] text-text-2 tabular-nums">{k.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mono text-[14px] text-text-2 tabular-nums">{k.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mono text-[14px] text-text tabular-nums">{CAD.format(k.cost)}</td>
                <td className="py-3 pr-3 font-mono text-[14px] text-text-2 tabular-nums">{k.conversions.toFixed(1)}</td>
                <td className="py-3 pr-3 font-mono text-[14px] tabular-nums">
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

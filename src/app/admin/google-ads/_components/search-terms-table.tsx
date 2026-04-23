"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { SearchTermData } from "@/lib/analytics/google-ads-types";

const COLUMNS = [
  { key: "searchTerm", label: "Search Term" },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "cost", label: "Cost" },
  { key: "conversions", label: "Conv." },
];

interface SearchTermsTableProps {
  searchTerms: SearchTermData[];
}

export function SearchTermsTable({ searchTerms }: SearchTermsTableProps) {
  const { sort, toggle, sorted } = useSortState("impressions");

  if (searchTerms.length === 0) {
    return (
      <div className="border-l-2 border-l-white/[0.08] py-3 px-3">
        <p className="font-mohave text-[14px] text-[#6B6B6B]">No search term data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-mono text-micro uppercase tracking-wider text-[#6B6B6B] mb-4">
        Search Terms
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <SortableTableHeader columns={COLUMNS} sort={sort} onSort={toggle} />
          </thead>
          <tbody>
            {sorted(searchTerms).map((t, i) => (
              <tr
                key={`${t.searchTerm}-${i}`}
                className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100"
              >
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#EDEDED]">{t.searchTerm}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{t.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{t.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#EDEDED] tabular-nums">${t.cost.toFixed(2)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{t.conversions.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

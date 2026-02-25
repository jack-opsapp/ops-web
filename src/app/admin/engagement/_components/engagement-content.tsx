"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { HorizontalBarChart } from "../../_components/horizontal-bar-chart";
import {
  DateRangeControl,
  useDateRange,
} from "../../_components/date-range-control";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type {
  FeatureAdoption,
  ChartDataPoint,
  DateRangeParams,
} from "@/lib/admin/types";

interface EngagementContentProps {
  activeUsersSparkline: ChartDataPoint[];
  featureAdoption: FeatureAdoption[];
  engagementDist: ChartDataPoint[];
  cohortRetention: {
    cohort: string;
    signups: number;
    month1: number;
    month2: number;
    month3: number;
    month6: number;
    month12: number;
  }[];
}

async function fetchActiveUsers(params: DateRangeParams) {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    granularity: params.granularity,
  });
  const res = await fetch(`/api/admin/engagement/active-users?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch active users");
  const json = await res.json();
  return json.data as ChartDataPoint[];
}

async function fetchFeatureAdoption() {
  const res = await fetch("/api/admin/engagement/feature-adoption");
  if (!res.ok) throw new Error("Failed to fetch feature adoption");
  const json = await res.json();
  return json.data as FeatureAdoption[];
}

async function fetchDistribution() {
  const res = await fetch("/api/admin/engagement/distribution");
  if (!res.ok) throw new Error("Failed to fetch distribution");
  const json = await res.json();
  return json.data as ChartDataPoint[];
}

const FEATURE_COLUMNS = [
  { key: "feature", label: "Feature" },
  { key: "totalCount", label: "Total" },
  { key: "companiesUsing", label: "Companies" },
  { key: "adoptionRate", label: "Adoption" },
];

export function EngagementContent({
  activeUsersSparkline,
  featureAdoption,
  engagementDist,
  cohortRetention,
}: EngagementContentProps) {
  // Active Users — date range state
  const activeUsersRange = useDateRange("90d");

  const activeUsersQuery = useQuery({
    queryKey: ["engagement-active-users", activeUsersRange.params],
    queryFn: () => fetchActiveUsers(activeUsersRange.params),
    initialData: activeUsersSparkline,
    staleTime: 0,
  });

  // Feature Adoption — sortable
  const featureSort = useSortState("adoptionRate");
  const featureAdoptionQuery = useQuery({
    queryKey: ["engagement-feature-adoption"],
    queryFn: fetchFeatureAdoption,
    initialData: featureAdoption,
  });
  const sortedFeatures = featureSort.sorted(featureAdoptionQuery.data ?? []);

  // Engagement Distribution
  const distQuery = useQuery({
    queryKey: ["engagement-distribution"],
    queryFn: fetchDistribution,
    initialData: engagementDist,
  });

  // Cohort hover state
  const cohortSort = useSortState("cohort");
  const sortedCohorts = cohortSort.sorted(cohortRetention);

  return (
    <div className="space-y-8">
      {/* Active Users Trend */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-6">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
            Active Users Trend [Firebase Auth]
          </p>
          <DateRangeControl
            defaultPreset="90d"
            onChange={activeUsersRange.setParams}
            showGranularity
          />
        </div>
        <AdminLineChart
          data={activeUsersQuery.data ?? []}
          color="#597794"
          isLoading={activeUsersQuery.isFetching && !activeUsersQuery.data?.length}
        />
      </div>

      {/* Feature Adoption Table + Bar Chart */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Feature Adoption
          </p>
          <div className="space-y-0">
            <table className="w-full">
              <thead>
                <SortableTableHeader
                  columns={FEATURE_COLUMNS}
                  sort={featureSort.sort}
                  onSort={featureSort.toggle}
                />
              </thead>
              <tbody>
                {sortedFeatures.map((f) => (
                  <tr
                    key={f.feature}
                    className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2.5 font-mohave text-[13px] text-[#E5E5E5] pr-3">
                      {f.feature}
                    </td>
                    <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0] pr-3">
                      {f.totalCount.toLocaleString()}
                    </td>
                    <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0] pr-3">
                      {f.companiesUsing}
                    </td>
                    <td className="py-2.5 font-mohave text-[14px] text-[#E5E5E5] pr-3">
                      {f.adoptionRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Feature Adoption Rates
          </p>
          <HorizontalBarChart
            data={(featureAdoptionQuery.data ?? []).map((f) => ({
              label: f.feature,
              value: f.adoptionRate,
              maxValue: 100,
            }))}
            color="#597794"
            suffix="%"
          />
        </div>
      </div>

      {/* Engagement Distribution + Cohort Retention */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Engagement Distribution
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [companies by total entity count (projects + tasks + clients)]
          </p>
          <AdminBarChart
            data={distQuery.data ?? []}
            color="#8195B5"
            isLoading={distQuery.isFetching && !distQuery.data?.length}
          />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Cohort Retention
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-4">
            [% active at month N, proxy: project creation]
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <SortableTableHeader
                  columns={[
                    { key: "cohort", label: "Cohort" },
                    { key: "signups", label: "Signups" },
                    { key: "month1", label: "M1" },
                    { key: "month2", label: "M2" },
                    { key: "month3", label: "M3" },
                    { key: "month6", label: "M6" },
                    { key: "month12", label: "M12" },
                  ]}
                  sort={cohortSort.sort}
                  onSort={cohortSort.toggle}
                />
              </thead>
              <tbody>
                {sortedCohorts.map((row) => (
                  <tr
                    key={row.cohort}
                    className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2 font-mohave text-[13px] text-[#E5E5E5] pr-3">
                      {row.cohort}
                    </td>
                    <td className="py-2 font-mohave text-[13px] text-[#A0A0A0] pr-3">
                      {row.signups}
                    </td>
                    {[row.month1, row.month2, row.month3, row.month6, row.month12].map(
                      (pct, i) => (
                        <td key={i} className="py-2 pr-3 group relative">
                          <span
                            className="font-mohave text-[13px] px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `rgba(89, 119, 148, ${(pct / 100) * 0.5})`,
                              color: pct > 0 ? "#E5E5E5" : "#6B6B6B",
                            }}
                          >
                            {pct}%
                          </span>
                          {/* Hover tooltip showing absolute count */}
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#1D1D1D] border border-white/[0.08] rounded px-2 py-0.5 font-kosugi text-[11px] text-[#E5E5E5] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                            {Math.round((pct / 100) * row.signups)} users
                          </span>
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

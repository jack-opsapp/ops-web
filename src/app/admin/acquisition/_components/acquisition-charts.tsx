"use client";

import { useState } from "react";
import { FunnelChart } from "../../_components/charts/funnel-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";

interface AcquisitionChartsProps {
  sectionEngagement: { dimension: string; count: number }[];
  abVariants: { dimension: string; count: number }[];
  tutorialFunnel: { step: string; count: number }[];
  signupFunnel: { step: string; count: number }[];
  megaFunnel: { step: string; count: number }[];
}

export function AcquisitionCharts({
  sectionEngagement,
  abVariants,
  tutorialFunnel,
  signupFunnel,
  megaFunnel,
}: AcquisitionChartsProps) {
  const [selectedStep, setSelectedStep] = useState<{
    funnel: string;
    step: string;
    count: number;
  } | null>(null);

  const variantSort = useSortState("count");
  const sortedVariants = variantSort.sorted(abVariants);

  return (
    <div className="space-y-8">
      {/* Section Engagement + A/B Variants */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Section Engagement
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [views per landing page section]
          </p>
          {sectionEngagement.length > 0 ? (
            <AdminBarChart
              data={sectionEngagement.map((d) => ({ label: d.dimension, value: d.count }))}
              color="#597794"
              onBarClick={(p) => setSelectedStep({ funnel: "section", step: p.label, count: p.value })}
            />
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No section_view events yet
            </p>
          )}
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            A/B Variant Comparison
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [landing page views by variant]
          </p>
          {sortedVariants.length > 0 ? (
            <table className="w-full">
              <thead>
                <SortableTableHeader
                  columns={[
                    { key: "dimension", label: "Variant" },
                    { key: "count", label: "Views" },
                  ]}
                  sort={variantSort.sort}
                  onSort={variantSort.toggle}
                />
              </thead>
              <tbody>
                {sortedVariants.map((v) => (
                  <tr key={v.dimension} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 font-mohave text-[14px] text-[#E5E5E5]">{v.dimension}</td>
                    <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0]">{v.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No variant data yet
            </p>
          )}
        </div>
      </div>

      {/* Selected step detail */}
      {selectedStep && (
        <div className="border border-[#597794]/30 rounded-lg p-4 bg-[#597794]/5">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mohave text-[12px] uppercase tracking-widest text-[#597794]">
                Selected Step
              </span>
              <p className="font-mohave text-[16px] text-[#E5E5E5] mt-1">
                {selectedStep.step}: {selectedStep.count.toLocaleString()} events
              </p>
            </div>
            <button
              onClick={() => setSelectedStep(null)}
              className="font-kosugi text-[11px] text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
            >
              Clear &times;
            </button>
          </div>
        </div>
      )}

      {/* Tutorial + Signup Funnels */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Tutorial Funnel
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [started → halfway → complete vs skipped]
          </p>
          <FunnelChart
            steps={tutorialFunnel}
            onStepClick={(step) =>
              setSelectedStep({ funnel: "tutorial", step: step.step, count: step.count })
            }
          />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Signup Funnel
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [step-by-step conversion]
          </p>
          <FunnelChart
            steps={signupFunnel}
            onStepClick={(step) =>
              setSelectedStep({ funnel: "signup", step: step.step, count: step.count })
            }
          />
        </div>
      </div>

      {/* Mega Funnel */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Full Journey Funnel
        </p>
        <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-8">
          [landing page → first project · last 90 days · all platforms]
        </p>
        <FunnelChart
          steps={megaFunnel}
          onStepClick={(step) =>
            setSelectedStep({ funnel: "mega", step: step.step, count: step.count })
          }
        />
      </div>
    </div>
  );
}

"use client";

import { FunnelChart } from "../../_components/charts/funnel-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";

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
  return (
    <div className="space-y-8">
      {/* Section Engagement + A/B Variants */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Section Engagement
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [views per landing page section · last 30 days]
          </p>
          {sectionEngagement.length > 0 ? (
            <AdminBarChart
              data={sectionEngagement.map((d) => ({ label: d.dimension, value: d.count }))}
              color="#597794"
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
            [landing page views by variant · last 30 days]
          </p>
          {abVariants.length > 0 ? (
            <div className="space-y-0">
              <div className="grid grid-cols-2 py-2 border-b border-white/[0.08]">
                <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">VARIANT</span>
                <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">VIEWS</span>
              </div>
              {abVariants.map((v) => (
                <div key={v.dimension} className="grid grid-cols-2 py-2.5 border-b border-white/[0.05] last:border-0">
                  <span className="font-mohave text-[14px] text-[#E5E5E5]">{v.dimension}</span>
                  <span className="font-mohave text-[14px] text-[#A0A0A0]">{v.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No variant data yet
            </p>
          )}
        </div>
      </div>

      {/* Tutorial + Signup Funnels */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Tutorial Funnel
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [started → halfway → complete vs skipped · last 30 days]
          </p>
          <FunnelChart steps={tutorialFunnel} />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Signup Funnel
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [step-by-step conversion · last 30 days]
          </p>
          <FunnelChart steps={signupFunnel} />
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
        <FunnelChart steps={megaFunnel} />
      </div>
    </div>
  );
}

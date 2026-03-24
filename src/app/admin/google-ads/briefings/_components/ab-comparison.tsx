"use client";

import type { ABTestProposal } from "@/lib/admin/briefing-types";

export function ABComparison({ proposals }: { proposals: ABTestProposal[] }) {
  if (proposals.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        A/B Test Proposals
      </h2>
      <div className="space-y-4">
        {proposals.map((p, i) => (
          <div key={i} className="border border-white/[0.08] rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.06]">
              <p className="font-mohave text-[13px] text-[#E5E5E5]">{p.name}</p>
            </div>
            <div className="grid grid-cols-2">
              {/* Current */}
              <div className="p-4 border-r border-white/[0.06]">
                <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-2">Current</p>
                <p className="font-mohave text-[14px] text-[#A0A0A0]">{p.currentAd.headline}</p>
                <p className="font-mohave text-[12px] text-[#6B6B6B] mt-1">{p.currentAd.description}</p>
              </div>
              {/* Proposed */}
              <div className="p-4 border-l border-[#597794]/20">
                <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#597794] mb-2">Proposed</p>
                <p className="font-mohave text-[14px] text-[#E5E5E5]">{p.proposedAd.headline}</p>
                <p className="font-mohave text-[12px] text-[#A0A0A0] mt-1">{p.proposedAd.description}</p>
              </div>
            </div>
            <div className="px-4 py-3 bg-white/[0.01] border-t border-white/[0.06]">
              <p className="font-kosugi text-[11px] text-[#6B6B6B]">
                <span className={`uppercase text-[10px] ${p.confidence === "high" ? "text-[#9DB582]" : "text-[#C4A868]"}`}>
                  [{p.confidence}]
                </span>
                {" "}{p.hypothesis}
              </p>
              <p className="font-kosugi text-[10px] text-[#444444] mt-1">Track: {p.metricToWatch}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { CompetitorSnapshot } from "@/lib/admin/briefing-types";

function CompetitorCard({ competitor }: { competitor: CompetitorSnapshot }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-white/[0.08] rounded bg-white/[0.02]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors duration-100"
      >
        <span className="font-mohave text-[14px] text-[#E5E5E5]">{competitor.name}</span>
        <span className="font-mohave text-[12px] text-[#6B6B6B]">{expanded ? "\u2212" : "+"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06]">
          {competitor.adCopy.length > 0 && (
            <div>
              <p className="font-kosugi text-micro uppercase tracking-wider text-[#6B6B6B] mt-3 mb-1">Their Ads</p>
              {competitor.adCopy.map((ad, i) => (
                <div key={i} className="py-1">
                  <p className="font-mohave text-[13px] text-[#A0A0A0]">{ad.headline}</p>
                  <p className="font-mohave text-[12px] text-[#6B6B6B]">{ad.description}</p>
                </div>
              ))}
            </div>
          )}
          {competitor.offers.length > 0 && (
            <div>
              <p className="font-kosugi text-micro uppercase tracking-wider text-[#6B6B6B] mb-1">Offers</p>
              {competitor.offers.map((offer, i) => (
                <p key={i} className="font-mohave text-[13px] text-[#A0A0A0]">{"\u2022"} {offer}</p>
              ))}
            </div>
          )}
          {competitor.landingPageAngle && (
            <div>
              <p className="font-kosugi text-micro uppercase tracking-wider text-[#6B6B6B] mb-1">Their Angle</p>
              <p className="font-mohave text-[13px] text-[#A0A0A0]">{competitor.landingPageAngle}</p>
            </div>
          )}
          {competitor.weaknesses.length > 0 && (
            <div>
              <p className="font-kosugi text-micro uppercase tracking-wider text-[#597794] mb-1">OPS Opportunity</p>
              {competitor.weaknesses.map((w, i) => (
                <p key={i} className="font-mohave text-[13px] text-[#E5E5E5]">{"\u2192"} {w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CompetitorIntel({ competitors }: { competitors: CompetitorSnapshot[] }) {
  if (competitors.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-micro uppercase tracking-wider text-[#6B6B6B] mb-4">
        Competitor Intel
      </h2>
      <div className="space-y-2">
        {competitors.map((c, i) => (
          <CompetitorCard key={i} competitor={c} />
        ))}
      </div>
    </div>
  );
}

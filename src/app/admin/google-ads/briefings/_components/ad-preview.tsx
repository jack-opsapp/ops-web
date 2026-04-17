"use client";

import type { AdSuggestion, KeywordRec } from "@/lib/admin/briefing-types";

const BASED_ON_LABELS: Record<string, string> = {
  competitor_gap: "Competitor Gap",
  sentiment_insight: "Market Insight",
  performance_data: "Performance Data",
};

export function AdPreview({ suggestions, keywords }: { suggestions: AdSuggestion[]; keywords: KeywordRec[] }) {
  const headlines = suggestions.filter((s) => s.type === "headline");
  const descriptions = suggestions.filter((s) => s.type === "description");
  const addKeywords = keywords.filter((k) => k.action === "add");
  const negativeKeywords = keywords.filter((k) => k.action === "negative");

  return (
    <div className="space-y-6">
      <h2 className="font-mono text-micro uppercase tracking-wider text-[#6B6B6B]">
        Ad Suggestions
      </h2>

      {/* Ad mockup cards */}
      <div className="space-y-3">
        {headlines.map((h, i) => (
          <div key={i} className="border border-white/[0.08] rounded p-4 bg-white/[0.02]">
            <p className="font-mono text-micro text-[#6B6B6B] mb-1">Ad · opsapp.co</p>
            <p className="font-mohave text-[16px] text-[#597794]">{h.text}</p>
            {descriptions[i] && (
              <p className="font-mohave text-[13px] text-[#A0A0A0] mt-1">{descriptions[i].text}</p>
            )}
            <div className="mt-2">
              <span className="font-mono text-micro text-[#444444] bg-white/[0.04] px-2 py-0.5 rounded">
                {BASED_ON_LABELS[h.basedOn] ?? h.basedOn}
              </span>
            </div>
            <p className="font-mono text-[11px] text-[#6B6B6B] mt-2">{h.rationale}</p>
          </div>
        ))}
      </div>

      {/* Keyword recommendations */}
      {(addKeywords.length > 0 || negativeKeywords.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {addKeywords.length > 0 && (
            <div>
              <p className="font-mono text-micro uppercase tracking-wider text-[#9DB582] mb-2">Add These</p>
              {addKeywords.map((k, i) => (
                <div key={i} className="py-1.5 border-b border-white/[0.06]">
                  <p className="font-mohave text-[13px] text-[#E5E5E5]">{k.keyword}</p>
                  <p className="font-mono text-micro text-[#6B6B6B]">[{k.matchType}] {k.rationale}</p>
                </div>
              ))}
            </div>
          )}
          {negativeKeywords.length > 0 && (
            <div>
              <p className="font-mono text-micro uppercase tracking-wider text-[#93321A] mb-2">Block These</p>
              {negativeKeywords.map((k, i) => (
                <div key={i} className="py-1.5 border-b border-white/[0.06]">
                  <p className="font-mohave text-[13px] text-[#E5E5E5]">{k.keyword}</p>
                  <p className="font-mono text-micro text-[#6B6B6B]">{k.rationale}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

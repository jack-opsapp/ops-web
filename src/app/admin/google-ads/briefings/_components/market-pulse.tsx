"use client";

import type { SentimentTheme } from "@/lib/admin/briefing-types";

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-[#9DB582]",
  negative: "text-[#93321A]",
  neutral: "text-[#6B6B6B]",
};

export function MarketPulse({ themes }: { themes: SentimentTheme[] }) {
  if (themes.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Market Pulse
      </h2>
      <div className="space-y-4">
        {themes.map((theme, i) => (
          <div key={i} className="border border-white/[0.08] rounded p-4 bg-white/[0.02]">
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-mohave text-[11px] uppercase ${SENTIMENT_COLORS[theme.sentiment]}`}>
                [{theme.sentiment}]
              </span>
              <span className="font-mohave text-[14px] text-[#E5E5E5]">{theme.theme}</span>
            </div>
            {theme.quotes.length > 0 && (
              <div className="space-y-1 mb-2">
                {theme.quotes.map((quote, qi) => (
                  <p key={qi} className="font-kosugi text-[12px] text-[#A0A0A0] italic border-l border-white/[0.06] pl-3">
                    &ldquo;{quote}&rdquo;
                  </p>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              {theme.sources.map((src, si) => (
                <span key={si} className="font-kosugi text-[10px] text-[#444444] bg-white/[0.04] px-1.5 py-0.5 rounded">
                  {src}
                </span>
              ))}
            </div>
            {theme.opportunity && (
              <p className="font-mohave text-[13px] text-[#597794] mt-2">{"\u2192"} {theme.opportunity}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { GenerationProgress } from "./generation-progress";
import type { AdBriefing } from "@/lib/admin/briefing-types";

export function BriefingHeroClient({ briefing }: { briefing: AdBriefing | null }) {
  const router = useRouter();
  const handleComplete = useCallback(() => router.refresh(), [router]);

  return (
    <div className="border border-white/[0.08] rounded-lg bg-white/[0.02] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-kosugi text-micro uppercase tracking-wider text-[#6B6B6B]">
            Latest Intelligence Briefing
          </h2>
          {briefing && (
            <p className="font-kosugi text-[11px] text-[#444444] mt-1">
              [{briefing.period_start} — {briefing.period_end}]
            </p>
          )}
        </div>
        <GenerationProgress onComplete={handleComplete} />
      </div>

      {briefing ? (
        <>
          <p className="font-mohave text-[14px] text-[#E5E5E5] leading-relaxed mb-4">
            {briefing.summary}
          </p>

          {briefing.action_items.slice(0, 3).map((item, i) => (
            <div key={i} className="flex items-start gap-2 py-1.5">
              <span className="font-mohave text-[13px] text-[#6B6B6B] shrink-0">{i + 1}.</span>
              <span className={`font-mohave text-[11px] uppercase shrink-0 ${
                item.priority === "high" ? "text-[#93321A]" : item.priority === "medium" ? "text-[#C4A868]" : "text-[#6B6B6B]"
              }`}>[{item.priority}]</span>
              <span className="font-mohave text-[13px] text-[#E5E5E5]">{item.action}</span>
            </div>
          ))}

          <Link
            href={`/admin/google-ads/briefings/${briefing.id}`}
            className="inline-block mt-4 font-kosugi text-[11px] text-[#597794] hover:text-[#E5E5E5] transition-colors duration-100"
          >
            View full briefing →
          </Link>
        </>
      ) : (
        <p className="font-mohave text-[14px] text-[#6B6B6B]">
          No briefings yet. Generate your first one to get started.
        </p>
      )}
    </div>
  );
}

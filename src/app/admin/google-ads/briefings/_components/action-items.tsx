"use client";

import type { ActionItem } from "@/lib/admin/briefing-types";

const PRIORITY_STYLES: Record<string, { border: string; text: string }> = {
  high: { border: "border-l-[#93321A]", text: "text-[#93321A]" },
  medium: { border: "border-l-[#C4A868]", text: "text-[#C4A868]" },
  low: { border: "border-l-[#6B6B6B]", text: "text-[#6B6B6B]" },
};

export function ActionItems({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Action Items
      </h2>
      <div className="space-y-2">
        {items.map((item, i) => {
          const style = PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.low;
          return (
            <div key={i} className={`border-l-2 ${style.border} pl-3 py-2`}>
              <div className="flex items-start gap-2">
                <span className="font-mohave text-[14px] text-[#E5E5E5] shrink-0">{i + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-mohave text-[11px] uppercase ${style.text}`}>
                      [{item.priority}]
                    </span>
                    <span className="font-mohave text-[14px] text-[#E5E5E5]">{item.action}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-kosugi text-[11px] text-[#6B6B6B]">{item.expectedImpact}</span>
                    <span className="font-mohave text-[11px] text-[#444444] bg-white/[0.04] px-2 py-0.5 rounded">
                      {item.effort}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

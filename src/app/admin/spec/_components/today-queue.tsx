import Link from "next/link";
import type { TodaySection } from "@/lib/admin/spec-types";
import { formatCents } from "./format";

interface TodayQueueProps {
  sections: TodaySection[];
}

export function TodayQueue({ sections }: TodayQueueProps) {
  const totalCount = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <section
      aria-label="TODAY command queue"
      className="border-b border-white/[0.08] px-8 py-6"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          TODAY
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>
          {totalCount} {totalCount === 1 ? "ITEM" : "ITEMS"} ACROSS {sections.length} SECTIONS
          <span className="text-text-mute">]</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <SectionBlock key={section.key} section={section} />
        ))}
      </div>
    </section>
  );
}

function SectionBlock({ section }: { section: TodaySection }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          {section.label}
        </h3>
        <span className="font-mono text-[11px] tracking-[0.12em] text-text-mute">
          <span className="text-text-mute">[</span>
          {section.items.length}
          <span className="text-text-mute">]</span>
        </span>
      </div>

      {section.items.length === 0 ? (
        <p className="font-mono text-[12px] text-text-mute">— nothing today</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {section.items.slice(0, 8).map((item) => (
            <li key={item.id} className="py-2">
              <Link
                href={item.deepLink}
                className="group flex items-start gap-3 text-[13px] text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
              >
                <span className="mt-[2px] inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute min-w-[40px]">
                  {item.ageLabel}
                </span>
                <span className="flex-1 leading-snug">{item.description}</span>
                {item.amountCents != null && (
                  <span className="font-mono text-[12px] tabular-nums text-tan">
                    {formatCents(item.amountCents)}
                  </span>
                )}
              </Link>
            </li>
          ))}
          {section.items.length > 8 && (
            <li className="pt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-mute">
              <span className="text-text-mute">[</span>+{section.items.length - 8} MORE
              <span className="text-text-mute">]</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

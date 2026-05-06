"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ClosedBandProps {
  /** ISO date — formatted as "Closed Mon DD". */
  closedAt: string | null;
  className?: string;
}

function formatClosed(closedAt: string | null): string {
  if (!closedAt) return "Closed";
  const ts = Date.parse(closedAt);
  if (Number.isNaN(ts)) return "Closed";
  const fmt = new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `Closed ${fmt}`;
}

export function ClosedBand({ closedAt, className }: ClosedBandProps) {
  return (
    <section
      aria-label="Thread closed"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-line bg-inbox-bg px-[18px] py-2.5",
        className,
      )}
    >
      <Check aria-hidden className="h-3.5 w-3.5 text-olive" strokeWidth={1.75} />
      <span className="font-mohave text-[12px] leading-tight text-text-3">
        {formatClosed(closedAt)}
      </span>
    </section>
  );
}

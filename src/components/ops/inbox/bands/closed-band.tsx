"use client";

import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface ClosedBandProps {
  /** ISO date — formatted as "Closed Mon DD". */
  closedAt: string | null;
  className?: string;
}

function formatDate(closedAt: string | null): string | null {
  if (!closedAt) return null;
  const ts = Date.parse(closedAt);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ClosedBand({ closedAt, className }: ClosedBandProps) {
  const { t } = useDictionary("inbox");
  const dateLabel = formatDate(closedAt);
  const label = dateLabel
    ? t("bands.closed.label", "Closed {date}").replace("{date}", dateLabel)
    : t("bands.closed.label", "Closed {date}").replace(" {date}", "");
  return (
    <section
      aria-label={t("bands.closed.aria", "Thread closed")}
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-line bg-inbox-bg px-[18px] py-2.5",
        className,
      )}
    >
      <Check aria-hidden className="h-3.5 w-3.5 text-olive" strokeWidth={1.5} />
      <span className="font-mohave text-[12px] leading-tight text-text-3">
        {label}
      </span>
    </section>
  );
}

"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";

export type ClosedBandVariant = "resolved" | "archived";

interface ClosedBandProps {
  closedAt: string | null;
  variant?: ClosedBandVariant;
  detail?: string;
  className?: string;
}

function formatDate(closedAt: string | null): string | null {
  if (!closedAt) return null;
  const ts = Date.parse(closedAt);
  if (Number.isNaN(ts)) return null;
  return new Date(ts)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export function ClosedBand({
  closedAt,
  variant = "archived",
  detail,
  className,
}: ClosedBandProps) {
  const { t } = useDictionary("inbox");
  const dateLabel = formatDate(closedAt) ?? "";
  const titleKey =
    variant === "resolved" ? "bands.closedResolved" : "bands.closedArchived";
  const titleFallback =
    variant === "resolved"
      ? "// CLOSED :: {date} · RESOLVED BY PHASE C"
      : "// CLOSED :: {date} · ARCHIVED BY YOU";
  const title = t(titleKey, titleFallback).replace("{date}", dateLabel);

  return (
    <section
      aria-label={t("bands.closed.aria", "Thread closed")}
      className={cn(
        "relative flex shrink-0 flex-col gap-[3px] border-b border-line px-2 py-2.5",
        variant === "resolved" ? "bg-olive/[0.04]" : "bg-white/[0.02]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 h-full w-[2px]",
          variant === "resolved" ? "bg-olive" : "bg-line-hi",
        )}
      />
      <SlashLabel
        label={title}
        tone={variant === "resolved" ? "olive" : "text-2"}
      />
      {detail && (
        <span
          className={cn(
            "font-mohave text-[12px] leading-tight",
            variant === "resolved" ? "text-text-2" : "text-text-3",
          )}
        >
          {detail}
        </span>
      )}
    </section>
  );
}

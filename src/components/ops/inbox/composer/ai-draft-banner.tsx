"use client";

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface AiDraftBannerProps {
  draftedAt: string | null;
  renderedAt?: number;
  className?: string;
}

function formatRelative(draftedAt: string | null, now: number): string {
  if (!draftedAt) return "";
  const ts = Date.parse(draftedAt);
  if (Number.isNaN(ts)) return "";
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function AiDraftBanner({
  draftedAt,
  renderedAt = Date.now(),
  className,
}: AiDraftBannerProps) {
  const { t } = useDictionary("inbox");
  const ts = formatRelative(draftedAt, renderedAt);
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-1.5 px-1",
        className,
      )}
    >
      <Sparkles aria-hidden className="h-3 w-3 text-agent-hi" strokeWidth={1.75} />
      <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-agent-hi">
        {t("aiDraftBanner.label", "CLAUDE DRAFTED THIS · review")}
      </span>
      {ts && (
        <span
          className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {ts}
        </span>
      )}
    </div>
  );
}

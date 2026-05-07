"use client";

import { Mail, Sparkles, User } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export type DraftSource = "yours" | "claude" | "gmail" | "outlook";

export interface DraftEntry {
  id: DraftSource;
  label: string;
}

interface DraftSwitcherProps {
  sources: DraftEntry[];
  active: DraftSource | null;
  onSelect: (source: DraftSource) => void;
  className?: string;
}

const ICON: Record<DraftSource, typeof User> = {
  yours: User,
  claude: Sparkles,
  gmail: Mail,
  outlook: Mail,
};

export function DraftSwitcher({
  sources,
  active,
  onSelect,
  className,
}: DraftSwitcherProps) {
  const { t } = useDictionary("inbox");
  if (sources.length === 0) return null;

  return (
    <div
      className={cn(
        "mb-2 flex flex-wrap items-center gap-2 rounded-md border-b border-line bg-white/[0.02] px-2.5 py-2",
        className,
      )}
    >
      <span className="font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
        {t("drafts.label", "// DRAFTS")}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map((src) => {
          const Icon = ICON[src.id];
          const isActive = active === src.id;
          const isClaude = src.id === "claude";
          return (
            <button
              key={src.id}
              type="button"
              onClick={() => onSelect(src.id)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex h-[22px] items-center gap-1.5 rounded-chip border px-2 font-mohave text-[11.5px] leading-none transition-colors",
                isActive
                  ? isClaude
                    ? "border-agent-border-hi bg-agent-bg-hi text-agent-hi"
                    : "border-border-medium bg-inbox-panel text-text"
                  : "border-transparent text-text-3 hover:bg-inbox-elev hover:text-text-2",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "h-3 w-3",
                  isClaude && isActive ? "text-agent-hi" : "",
                )}
                strokeWidth={1.75}
              />
              {src.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

/**
 * DraftSwitcher — faithful to `reference/v4-detail.jsx :: V4DraftSwitcher`.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Drafts  [ ✨ Claude · v1 ][ ✨ Claude · v2 ][ 👤 You · untitled ]  2 / 3 [‹] [›] │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * The chip stack lives inside a `bgDeep / line / 5px` segmented-control
 * wrapper. Active chip: panel bg + line-hi border. Claude variant uses the
 * agent palette. Each chip can carry an optional variant label ("v1",
 * "untitled") rendered in muted mono on the right of the chip body.
 */

import { ChevronLeft, ChevronRight, Mail, Sparkles, User } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export type DraftSource = "yours" | "claude" | "gmail" | "outlook";

export interface DraftEntry {
  id: string;
  source: DraftSource;
  /** Variant label, e.g. "v1", "untitled", "Apr 19". */
  label?: string;
}

interface DraftSwitcherProps {
  drafts: DraftEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

const SOURCE_ICON: Record<DraftSource, typeof User> = {
  yours: User,
  claude: Sparkles,
  gmail: Mail,
  outlook: Mail,
};

const SOURCE_LABEL_KEY: Record<DraftSource, string> = {
  yours: "drafts.source.yours",
  claude: "drafts.source.claude",
  gmail: "drafts.source.gmail",
  outlook: "drafts.source.outlook",
};

const SOURCE_LABEL_FALLBACK: Record<DraftSource, string> = {
  yours: "Yours",
  claude: "Claude",
  gmail: "Gmail",
  outlook: "Outlook",
};

export function DraftSwitcher({
  drafts,
  activeId,
  onSelect,
  onPrev,
  onNext,
  className,
}: DraftSwitcherProps) {
  const { t } = useDictionary("inbox");
  if (drafts.length === 0) return null;

  const activeIndex = Math.max(
    0,
    drafts.findIndex((d) => d.id === activeId),
  );
  const total = drafts.length;
  const navBtn =
    "inline-flex h-[22px] w-[22px] items-center justify-center rounded-[3px] border border-line bg-transparent text-text-3 hover:border-line-hi hover:text-text-2 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-1.5 border-b border-line bg-white/[0.02] px-2.5 py-2",
        className,
      )}
    >
      <span className="mr-1 font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
        {t("drafts.label", "Drafts")}
      </span>
      <div className="flex items-center gap-0.5 rounded-md border border-line bg-inbox-bg-deep p-0.5">
        {drafts.map((draft) => {
          const Icon = SOURCE_ICON[draft.source];
          const isActive = draft.id === activeId;
          const isClaude = draft.source === "claude";
          return (
            <button
              key={draft.id}
              type="button"
              onClick={() => onSelect(draft.id)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex h-[22px] items-center gap-1.5 rounded-[3px] px-2 font-mohave text-[11.5px] tracking-[-0.003em] transition-colors",
                isActive
                  ? "border border-line-hi bg-inbox-panel text-text"
                  : "border border-transparent text-text-3 hover:bg-inbox-elev hover:text-text-2",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "h-2.5 w-2.5",
                  isClaude ? "text-agent" : "text-text-3",
                )}
                strokeWidth={1.75}
              />
              <span>{t(SOURCE_LABEL_KEY[draft.source], SOURCE_LABEL_FALLBACK[draft.source])}</span>
              {draft.label && (
                <span
                  className="font-mono text-[9.5px] text-text-mute"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  {draft.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <span
        className="font-mono text-[9.5px] tracking-[0.18em] text-text-mute"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {activeIndex + 1} / {total}
      </span>
      {(onPrev || onNext) && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev || activeIndex === 0}
            aria-label={t("drafts.prev", "Previous draft")}
            className={navBtn}
          >
            <ChevronLeft aria-hidden className="h-2.5 w-2.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext || activeIndex === total - 1}
            aria-label={t("drafts.next", "Next draft")}
            className={navBtn}
          >
            <ChevronRight aria-hidden className="h-2.5 w-2.5" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

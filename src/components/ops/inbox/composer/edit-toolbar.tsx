"use client";

/**
 * EditToolbar — faithful to `reference/v4-detail.jsx :: V4EditToolbar`.
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ ✎ edited from Claude's draft · +14 −9   See changes · Revert · ✦ Regenerate │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Dashed line border, white/2 bg. The source name in the label is
 * lavender for Claude, neutral text-2 for human authors. Right side:
 * three ghost buttons separated by muted "·" dots; Regenerate carries
 * the agent palette + a sparkles glyph.
 */

import { Pencil, Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { DraftSource } from "./draft-switcher";

interface EditToolbarProps {
  added: number;
  removed: number;
  source: DraftSource;
  onSeeChanges: () => void;
  onRevert: () => void;
  onRegenerate: () => void;
  className?: string;
}

const SOURCE_LABEL: Record<DraftSource, string> = {
  yours: "yours",
  claude: "Claude",
  gmail: "Gmail",
  outlook: "Outlook",
};

const ghostBtn =
  "font-mohave text-[11px] text-text-2 hover:text-text px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent rounded-[2px]";

export function EditToolbar({
  added,
  removed,
  source,
  onSeeChanges,
  onRevert,
  onRegenerate,
  className,
}: EditToolbarProps) {
  const { t } = useDictionary("inbox");
  const isClaude = source === "claude";
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center gap-2 rounded-[4px] border border-dashed border-line bg-white/[0.02] px-2.5 py-1.5",
        className,
      )}
    >
      <Pencil aria-hidden className="h-3 w-3 text-text-3" strokeWidth={1.5} />
      <span
        className="font-mono text-[10.5px] tracking-[0.18em] text-text-3"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {t("editToolbar.label", "edited from")}{" "}
        <span className={isClaude ? "text-agent-hi" : "text-text-2"}>
          {SOURCE_LABEL[source]}
        </span>
        {t("editToolbar.labelTail", "'s draft")}
      </span>
      <span aria-hidden className="font-mono text-[10px] text-text-mute">
        ·
      </span>
      <span
        className="font-mono text-[10px] tabular-nums tracking-[0.18em] text-olive"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        +{added}
      </span>
      <span
        className="font-mono text-[10px] tabular-nums tracking-[0.18em] text-rose"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        −{removed}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={onSeeChanges} className={ghostBtn}>
          {t("editToolbar.seeChanges", "See changes")}
        </button>
        <span aria-hidden className="font-mono text-[10px] text-text-mute">
          ·
        </span>
        <button type="button" onClick={onRevert} className={ghostBtn}>
          {t("editToolbar.revert", "Revert")}
        </button>
        <span aria-hidden className="font-mono text-[10px] text-text-mute">
          ·
        </span>
        <button
          type="button"
          onClick={onRegenerate}
          className={cn(
            ghostBtn,
            "inline-flex items-center gap-1 text-agent-hi hover:text-agent-text",
          )}
        >
          <Sparkles aria-hidden className="h-2.5 w-2.5" strokeWidth={1.5} />
          {t("editToolbar.regenerate", "Regenerate")}
        </button>
      </div>
    </div>
  );
}

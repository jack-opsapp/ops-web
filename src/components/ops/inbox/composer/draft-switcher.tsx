"use client";

/**
 * DraftSwitcher — tactical-tabs voice (spec § 5.5, Phase F).
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ 1 · GMAIL    2 · GMAIL    ✦ 3 · CLAUDE    [+]                    │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Tabs sit directly inside the outer hairline shell with a horizontal
 * gap — no inner segmented-control wrapper. Each tab is JetBrains Mono
 * uppercase 11, tracking-0.14em. Active tab gets text-1 + a 1.5px
 * bottom border (accent for human sources, agent for Claude). The
 * Claude tab carries a leading Lucide `Sparkles` glyph in `text-agent`.
 *
 * Hidden when 0 OR 1 drafts (spec — only renders for 2+).
 */

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export type DraftSource = "yours" | "claude" | "gmail" | "outlook" | "new";

export interface DraftEntry {
  id: string;
  source: DraftSource;
  /** Optional metadata — not rendered in the tactical-tabs layout, kept for
   * downstream consumers (e.g. edit-toolbar) that may want it. */
  label?: string;
}

interface DraftSwitcherProps {
  drafts: DraftEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Optional. When provided, an inactive `[+]` tab is rendered after the
   * draft tabs. */
  onAdd?: () => void;
  className?: string;
}

const TNUM_STYLE = { fontFeatureSettings: '"tnum" 1, "zero" 1' } as const;

const SOURCE_LABEL_KEY: Record<DraftSource, string> = {
  yours: "draftSwitcher.yoursLabel",
  claude: "draftSwitcher.claudeLabel",
  gmail: "draftSwitcher.gmailLabel",
  outlook: "draftSwitcher.outlookLabel",
  new: "draftSwitcher.newLabel",
};

const SOURCE_LABEL_FALLBACK: Record<DraftSource, string> = {
  yours: "{n} · YOURS",
  claude: "✦ {n} · CLAUDE",
  gmail: "{n} · GMAIL",
  outlook: "{n} · OUTLOOK",
  new: "{n} · NEW",
};

/** For the Claude source, the i18n string carries a leading "✦ " unicode
 * glyph as a fallback. We render the Lucide icon instead, so we strip the
 * unicode prefix before display. */
function stripClaudeGlyph(label: string): string {
  // Strip leading "✦" + any whitespace.
  return label.replace(/^✦\s*/, "").trim();
}

export function DraftSwitcher({
  drafts,
  activeId,
  onSelect,
  onAdd,
  className,
}: DraftSwitcherProps) {
  const { t } = useDictionary("inbox");

  // Spec: hidden when 0 or 1 drafts.
  if (drafts.length < 2) return null;

  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-4 border-b border-line bg-inbox-elev px-2.5 py-2",
        className,
      )}
    >
      {drafts.map((draft, index) => {
        const isActive = draft.id === activeId;
        const isClaude = draft.source === "claude";
        const ordinal = index + 1;
        const rawLabel = t(
          SOURCE_LABEL_KEY[draft.source],
          SOURCE_LABEL_FALLBACK[draft.source],
        ).replace("{n}", String(ordinal));
        const displayLabel = isClaude ? stripClaudeGlyph(rawLabel) : rawLabel;
        const activeBorder = isClaude ? "border-agent" : "border-ops-accent";

        return (
          <button
            key={draft.id}
            type="button"
            onClick={() => onSelect(draft.id)}
            aria-pressed={isActive}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-[1.5px] border-transparent pb-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
              isActive
                ? cn("text-text", activeBorder)
                : "text-text-3 hover:text-text-2",
            )}
            style={TNUM_STYLE}
          >
            {isClaude && (
              <Sparkles
                aria-hidden
                className="h-3.5 w-3.5 text-agent"
                strokeWidth={1.5}
              />
            )}
            <span>{displayLabel}</span>
          </button>
        );
      })}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={t("draftSwitcher.addNewAria", "Add new draft")}
          className="inline-flex items-center border-b-[1.5px] border-transparent pb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3 transition-colors hover:text-text-2"
          style={TNUM_STYLE}
        >
          {t("draftSwitcher.addNew", "[+]")}
        </button>
      )}
    </div>
  );
}

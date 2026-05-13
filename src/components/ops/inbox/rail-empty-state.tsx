"use client";

/**
 * RailEmptyState — column-body empty state for the active rail filter.
 *
 * The audit (docs/superpowers/research/2026-05-12-inbox-category-audit.md § 6)
 * collapsed three conflicting "empty" framings (`empty.title: "Inbox zero"`,
 * `empty.status.title`, `row.queueEmpty`) into one per-rail design. Each rail
 * owns its own tactical header + body so the operator's emotional payoff
 * tracks the rail's meaning:
 *
 *   YOUR_MOVE → // CAUGHT UP   — the celebratory inbox-zero moment
 *   WAITING   → // QUIET       — no replies owed; stillness, not celebration
 *   ARCHIVED  → // EMPTY       — neutral; the most common production state
 *   ALL       → // NO THREADS  — degenerate fallback for brand-new operators
 *
 * SNOOZED is internal-only — the chip popover renders its own empty, the rail
 * nav never offers it as a tab. If a stray SNOOZED filter ever lands here it
 * degrades to ALL so we never render `undefined`.
 *
 * Search-miss variant — when the operator has an active search query and the
 * threads endpoint returns zero matches, render `// NO MATCHES` instead of
 * the rail's caught-up copy. The rail-quiet voice ("nothing waiting on you")
 * would be a lie under a search filter: the rail isn't quiet, the query
 * didn't hit. The body echoes the query string for tactile confirmation.
 */

import { useDictionary } from "@/i18n/client";
import type { RailFilter } from "@/lib/inbox/rail-predicates";
import { SlashLabel } from "./voice/slash-label";

type VisibleRail = Exclude<RailFilter, "SNOOZED">;

const HEADER_KEY: Record<VisibleRail, string> = {
  ALL: "empty.all.header",
  YOUR_MOVE: "empty.yourMove.header",
  WAITING: "empty.waiting.header",
  ARCHIVED: "empty.archived.header",
};

const BODY_KEY: Record<VisibleRail, string> = {
  ALL: "empty.all.body",
  YOUR_MOVE: "empty.yourMove.body",
  WAITING: "empty.waiting.body",
  ARCHIVED: "empty.archived.body",
};

const HEADER_FALLBACK: Record<VisibleRail, string> = {
  ALL: "// NO THREADS",
  YOUR_MOVE: "// CAUGHT UP",
  WAITING: "// QUIET",
  ARCHIVED: "// EMPTY",
};

const BODY_FALLBACK: Record<VisibleRail, string> = {
  ALL: "[—] inbox is empty",
  YOUR_MOVE: "[—] nothing waiting on you",
  WAITING: "[—] no replies owed",
  ARCHIVED: "[—] nothing archived yet",
};

function visibleRail(rail: RailFilter): VisibleRail {
  return rail === "SNOOZED" ? "ALL" : rail;
}

interface RailEmptyStateProps {
  rail: RailFilter;
  /**
   * True when the threads list is empty because the operator's search query
   * returned zero matches (as opposed to the rail genuinely being caught up).
   * Drives the `// NO MATCHES` variant — see file header.
   */
  searchActive?: boolean;
  /**
   * Active search query. Echoed in the search-miss body so the operator sees
   * exactly what the system parsed. Ignored when `searchActive` is false.
   */
  searchQuery?: string;
  className?: string;
}

export function RailEmptyState({
  rail,
  searchActive,
  searchQuery,
  className,
}: RailEmptyStateProps) {
  const { t } = useDictionary("inbox");
  const key = visibleRail(rail);
  const wrapperClassName =
    "flex h-full flex-col items-start justify-center gap-2 px-3.5 py-12" +
    (className ? " " + className : "");

  if (searchActive) {
    const body = t(
      "empty.searchMiss.body",
      '[—] nothing matches "{query}"',
    ).replace("{query}", searchQuery ?? "");
    return (
      <div
        data-testid="rail-empty-state"
        data-rail={key}
        data-search-active="true"
        className={wrapperClassName}
      >
        <SlashLabel label={t("empty.searchMiss.header", "// NO MATCHES")} />
        <p
          className="font-mono text-[11px] leading-relaxed text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {body}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="rail-empty-state"
      data-rail={key}
      className={wrapperClassName}
    >
      <SlashLabel label={t(HEADER_KEY[key], HEADER_FALLBACK[key])} />
      <p
        className="font-mono text-[11px] leading-relaxed text-text-3"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {t(BODY_KEY[key], BODY_FALLBACK[key])}
      </p>
    </div>
  );
}

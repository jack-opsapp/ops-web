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
  className?: string;
}

export function RailEmptyState({ rail, className }: RailEmptyStateProps) {
  const { t } = useDictionary("inbox");
  const key = visibleRail(rail);
  return (
    <div
      data-testid="rail-empty-state"
      data-rail={key}
      className={
        "flex h-full flex-col items-start justify-center gap-2 px-3.5 py-12" +
        (className ? " " + className : "")
      }
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

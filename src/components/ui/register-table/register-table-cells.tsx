/**
 * RegisterTable cell atoms — the canonical Books/register row anatomy, factored
 * out so every consumer renders identical typography instead of re-deriving it.
 *
 * Anatomy (DESIGN.md §4 + the projects/pipeline table-v2 lineage):
 *   number / id  → JetBrains Mono 13 (`data-sm`), primary text, tabular
 *   primary name → Mohave 14 (`body-sm`), primary text, truncates
 *   relation/meta→ Mohave 14 (`body-sm`), muted text, truncates
 *   dates/values → JetBrains Mono 13 (`data-sm`), tabular, tone carries meaning
 *
 * Status renders through the shared `Tag` (earth tones) — not an atom here.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Document number / identifier. */
export function TableNumber({ children }: { children: ReactNode }) {
  return <span className="font-mono text-data-sm text-text tabular-nums">{children}</span>;
}

/** Primary entity name — the row's subject. */
export function TablePrimary({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("block max-w-[200px] truncate font-mohave text-body-sm text-text", className)}>
      {children}
    </span>
  );
}

/** Secondary relation / metadata text (project, source, …). */
export function TableMeta({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("block max-w-[180px] truncate font-mohave text-body-sm text-text-3", className)}>
      {children}
    </span>
  );
}

/** Monospace metadata — dates, currency, counts. Tone carries the semantics. */
export function TableMono({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  /** default = primary figure · muted = quiet/empty · olive = positive · rose = overdue/negative */
  tone?: "default" | "muted" | "olive" | "rose";
  className?: string;
}) {
  const toneClass = {
    default: "text-text",
    muted: "text-text-3",
    olive: "text-olive",
    rose: "text-rose",
  }[tone];
  return (
    <span className={cn("whitespace-nowrap font-mono text-data-sm tabular-nums", toneClass, className)}>
      {children}
    </span>
  );
}

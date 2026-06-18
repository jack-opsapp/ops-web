"use client";

/**
 * Instrument strip — the shared glass glance-tile deck (WEB OVERHAUL P4-1).
 *
 * Extracted from the canonical Books ledger-strip so Books and Catalog stop
 * re-deriving the same pattern. Approved pixels:
 * docs/design/2026-06-11-books-mockups/direction-a-instrument-strip.html.
 *
 * Anatomy: an <InstrumentStrip> section with a `// LABEL` header (+ optional
 * right-aligned control) over a <GlanceGrid> of <GlanceTile>s. Each tile is a
 * `// LABEL` header (+ optional right slot) above a <TileHero> figure, a
 * per-surface mini-viz (slotted children), and a <TileSub> line — with an
 * optional <ScopeBadge> or onClick drill. The count-up lives in `useCountUp`.
 *
 * The mini-viz stays per-surface (margin meters, sparklines, aging ramps,
 * health bars) — only the shell, type, grid, badge and count-up are shared.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// ─── Strip + grid ──────────────────────────────────────────────────────────────

export function InstrumentStrip({
  label,
  right,
  children,
}: {
  /** Section title text, rendered after the `// ` prefix and used as aria-label. */
  label: string;
  /** Optional right-aligned control in the section header (e.g. a period pill). */
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {label}
        </span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Tile grid — always the canonical `gap-2`; the responsive column rule is
 *  per-surface (Books "grid-cols-2 xl:grid-cols-4", Catalog "grid-cols-1 …"). */
export function GlanceGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("grid gap-2", className)}>{children}</div>;
}

// ─── Tile shell ──────────────────────────────────────────────────────────────

export function GlanceTile({
  label,
  right,
  onClick,
  children,
}: {
  label: string;
  /** Optional right-aligned slot in the tile header (CTA hint, scope badge…). */
  right?: ReactNode;
  /** When set, the tile becomes a focusable drill button. */
  onClick?: () => void;
  children: ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        // SM widget zone: 14px top / 18px sides / 12px bottom (DESIGN.md §7).
        "glass-surface flex min-h-[132px] flex-col px-[18px] pb-[12px] pt-[14px] text-left",
        onClick &&
          "cursor-pointer transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {label}
        </span>
        {right}
      </div>
      {children}
    </Tag>
  );
}

// ─── Type atoms ────────────────────────────────────────────────────────────────

/** Hero figure — `text-data-lg` (20px mono, tabular). `tone` colors it for
 *  semantic surfaces (Catalog); the default is primary text (Books). */
export function TileHero({
  tone,
  children,
}: {
  tone?: "rose" | "olive";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "font-mono text-data-lg leading-tight tabular-nums",
        tone === "rose" ? "text-rose" : tone === "olive" ? "text-olive" : "text-text",
      )}
    >
      {children}
    </span>
  );
}

export function TileSub({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto font-mono text-micro tracking-[0.06em] text-text-3 tabular-nums">
      {children}
    </div>
  );
}

export function ScopeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[4px] border border-border px-[5px] py-px font-mono text-micro uppercase tracking-[0.14em] text-text-3">
      {children}
    </span>
  );
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/** Loading placeholder occupying the exact GlanceTile box. */
export function GlanceTileSkeleton() {
  return (
    <div className="glass-surface min-h-[132px] animate-pulse px-[18px] pb-[12px] pt-[14px] motion-reduce:animate-none">
      <div className="mb-2 h-[11px] w-[72px] rounded bg-fill-neutral-dim" />
      <div className="mb-2 h-[24px] w-[120px] rounded bg-fill-neutral-dim" />
      <div className="mb-2 h-[16px] w-full rounded bg-fill-neutral-dim/60" />
      <div className="h-[11px] w-[140px] rounded bg-fill-neutral-dim" />
    </div>
  );
}

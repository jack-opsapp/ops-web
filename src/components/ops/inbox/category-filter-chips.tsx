"use client";

/**
 * CategoryFilterChips — horizontal scrollable strip of the 13 categories
 * plus an "ALL" chip. Each chip shows the category label, a small dot
 * in the category color, and an unread count (suppressed when zero).
 *
 * Keyboard: left/right arrows cycle selection when focused; Home / End jump
 * to first / last. Active chip fills with rgba(255,255,255,0.08) + 18%
 * border (design-system active-toggle pattern). Left-edge marker shows
 * the category color as a thin 2px stripe.
 *
 * Horizontal scroll keeps keyboard and mouse users synced via
 * `scrollIntoView({ inline: "center" })` when selection changes.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { categoryDotColor, categoryLabel } from "./category-chip";

export type CategoryFilterValue = EmailThreadCategory | null;

export interface CategoryCountsMap {
  [key: string]: number | undefined;
}

interface CategoryFilterChipsProps {
  active: CategoryFilterValue;
  onChange: (next: CategoryFilterValue) => void;
  /** Per-category unread count. Key = category id. */
  counts?: CategoryCountsMap;
  /** Display order — defaults to EMAIL_THREAD_CATEGORIES. */
  order?: readonly EmailThreadCategory[];
  /** If true, reacts to ArrowLeft/ArrowRight on window. Default false. */
  hotkeys?: boolean;
}

function formatCount(n: number | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function CategoryFilterChips({
  active,
  onChange,
  counts,
  order = EMAIL_THREAD_CATEGORIES,
  hotkeys = false,
}: CategoryFilterChipsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Ordered chip values — ALL first, then categories.
  const chipOrder = useMemo<CategoryFilterValue[]>(() => [null, ...order], [order]);

  const activeIndex = useMemo(() => {
    const idx = chipOrder.findIndex((c) => c === active);
    return idx < 0 ? 0 : idx;
  }, [chipOrder, active]);

  // Scroll the active chip into view whenever selection changes.
  useEffect(() => {
    const btn = activeRef.current;
    if (!btn) return;
    btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIndex]);

  const step = useCallback(
    (direction: -1 | 1) => {
      const next = Math.min(
        chipOrder.length - 1,
        Math.max(0, activeIndex + direction)
      );
      if (next === activeIndex) return;
      onChange(chipOrder[next]);
    },
    [chipOrder, activeIndex, onChange]
  );

  useEffect(() => {
    if (!hotkeys) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hotkeys, step]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "Home") {
        e.preventDefault();
        onChange(chipOrder[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        onChange(chipOrder[chipOrder.length - 1]);
      }
    },
    [step, chipOrder, onChange]
  );

  const totalUnread = useMemo(() => {
    if (!counts) return 0;
    let sum = 0;
    for (const c of order) sum += counts[c] ?? 0;
    return sum;
  }, [counts, order]);

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Filter by category"
      aria-orientation="horizontal"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-center gap-1 overflow-x-auto scrollbar-hide",
        "px-2.5 py-2 border-b border-border-subtle",
        "focus:outline-none"
      )}
    >
      {chipOrder.map((value) => {
        const isAll = value === null;
        const isActive = value === active;
        const color = isAll ? "#6a6a6a" : categoryDotColor(value as EmailThreadCategory);
        const label = isAll ? "All" : categoryLabel(value as EmailThreadCategory);
        const count = isAll ? totalUnread : counts?.[value as EmailThreadCategory];
        const countDisplay = formatCount(count);

        return (
          <button
            key={value ?? "all"}
            ref={isActive ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={isActive}
            onClick={() => onChange(value)}
            className={cn(
              "relative shrink-0 inline-flex items-center gap-1.5 h-[26px] px-2 rounded-[5px]",
              "border transition-colors duration-150",
              isActive
                ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                : "border-border-subtle bg-[rgba(255,255,255,0.02)] text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.05)]"
            )}
          >
            <span
              aria-hidden
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.16em] leading-none whitespace-nowrap">
              {label}
            </span>
            {countDisplay && (
              <span
                className={cn(
                  "font-mono text-[10px] leading-none tabular-nums px-1 py-[1px] rounded-[3px]",
                  isActive
                    ? "text-text-2 bg-[rgba(255,255,255,0.08)]"
                    : "text-text-mute bg-[rgba(255,255,255,0.04)]"
                )}
              >
                {countDisplay}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

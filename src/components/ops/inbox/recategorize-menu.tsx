"use client";

/**
 * RecategorizeMenu — popover with all 13 primary categories + optional
 * "Tell Phase C why" note. Fires the `recategorize` mutation, shows an
 * undo toast, and (on undo) reverses the change via another recategorize
 * call back to the original category.
 *
 * Rendered as a Radix Popover anchored to the CategoryChip. Keyboard: Tab
 * cycles rows; Enter commits; Escape closes.
 */

import { useCallback, useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { useThreadActions } from "@/lib/hooks/use-inbox-threads";
import { CategoryChip, categoryLabel } from "./category-chip";
import { enqueueUndoToast } from "./undo-toast";

interface RecategorizeMenuProps {
  threadId: string;
  currentCategory: EmailThreadCategory;
  /** Trigger element — typically a CategoryChip with interactive=true. */
  trigger: React.ReactNode;
  /** Controlled open (optional — otherwise uncontrolled). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
}

// Hotkey letters mirror the first letter of the category, with collisions
// resolved deterministically. Rendered as a subtle [K] hint on the right.
const CATEGORY_HOTKEYS: Record<EmailThreadCategory, string> = {
  LEAD: "L",
  CLIENT: "C",
  VENDOR: "V",
  SUBTRADE: "S",
  PLATFORM_BID: "B",
  LEGAL: "G",
  JOB_SEEKER: "J",
  COLLECTIONS: "X",
  MARKETING: "M",
  RECEIPT: "R",
  PERSONAL: "P",
  INTERNAL: "I",
  OTHER: "O",
};

export function RecategorizeMenu({
  threadId,
  currentCategory,
  trigger,
  open,
  onOpenChange,
  align = "start",
}: RecategorizeMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );

  const [note, setNote] = useState("");
  const { recategorize } = useThreadActions();

  const categories = useMemo(
    () => EMAIL_THREAD_CATEGORIES.filter((c) => c !== currentCategory),
    [currentCategory]
  );

  const commit = useCallback(
    (next: EmailThreadCategory) => {
      const noteToSend = note.trim() || undefined;
      setOpen(false);
      setNote("");

      recategorize.mutate({
        threadId,
        toCategory: next,
        note: noteToSend,
      });

      enqueueUndoToast({
        message: `Marked as ${categoryLabel(next)}`,
        detail: "Phase C will learn from this correction.",
        onUndo: () => {
          recategorize.mutate({
            threadId,
            toCategory: currentCategory,
          });
        },
      });
    },
    [note, recategorize, threadId, currentCategory, setOpen]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      const key = e.key.toUpperCase();
      const match = categories.find((c) => CATEGORY_HOTKEYS[c] === key);
      if (match) {
        e.preventDefault();
        commit(match);
      }
    },
    [categories, commit, setOpen]
  );

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-[280px] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-3 pt-2.5 pb-1.5 border-b border-border-subtle">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
            {"// Reclassify"}
          </p>
          <p className="font-cakemono font-light uppercase text-[13px] tracking-[0.14em] text-text mt-0.5">
            Move thread to
          </p>
        </div>

        {/* Category list */}
        <div className="py-1 max-h-[360px] overflow-y-auto scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => commit(cat)}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-1.5 text-left",
                "hover:bg-[rgba(255,255,255,0.05)] transition-colors duration-150",
                "focus:outline-none focus:bg-[rgba(255,255,255,0.06)]"
              )}
            >
              <CategoryChip category={cat} size="sm" />
              <span className="flex-1" />
              <span className="font-mono text-[10px] text-text-mute tabular-nums">
                {CATEGORY_HOTKEYS[cat]}
              </span>
            </button>
          ))}
        </div>

        {/* "Tell Phase C why" note */}
        <div className="px-3 py-2 border-t border-border-subtle">
          <label
            htmlFor={`recat-note-${threadId}`}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute mb-1"
          >
            <Sparkles className="w-[10px] h-[10px]" strokeWidth={1.75} />
            Tell Phase C why (optional)
          </label>
          <textarea
            id={`recat-note-${threadId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="This domain is always a vendor…"
            className={cn(
              "w-full resize-none rounded-[5px] px-2 py-1.5",
              "bg-surface-input border border-border-subtle",
              "font-mohave text-[13px] text-text placeholder:text-text-3",
              "focus:outline-none focus:border-[rgba(255,255,255,0.20)]"
            )}
          />
          <div className="flex items-center gap-1 mt-1">
            <Check className="w-[10px] h-[10px] text-text-mute" strokeWidth={2} />
            <p className="font-mono text-[10px] text-text-mute">
              Applied to similar threads automatically.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

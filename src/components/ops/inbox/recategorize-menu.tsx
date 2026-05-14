"use client";

/**
 * RecategorizeMenu — popover with all 12 primary categories + optional
 * "Tell Phase C why" note. Fires the `recategorize` mutation, shows an
 * undo toast, and (on undo) reverses the change via another recategorize
 * call back to the original category.
 *
 * Rendered as a Radix Popover anchored to the CategoryChip. Keyboard: Tab
 * cycles rows; Enter commits; Escape closes.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { useThreadActions } from "@/lib/hooks/use-inbox-threads";
import { categoryLabel } from "./category-chip";
import { SlashLabel } from "./voice/slash-label";
import { KeyHint } from "@/components/ui/key-hint";
import { enqueueUndoToast } from "./undo-toast";
import { toast } from "sonner";

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
  CUSTOMER: "C",
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

  const { t } = useDictionary("inbox");
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

      recategorize.mutate(
        { threadId, toCategory: next, note: noteToSend },
        {
          onSuccess: () => {
            enqueueUndoToast({
              message: t(
                "toast.recategorizedTactic",
                "SYS :: MOVED TO {category}"
              ).replace("{category}", categoryLabel(next)),
              detail: t(
                "toast.recategorizedDetail",
                "[—] phase c will learn from this correction."
              ),
              onUndo: () => {
                recategorize.mutate({ threadId, toCategory: currentCategory });
              },
            });
          },
          onError: () => {
            toast.error(t("recategorize.error", "Failed to reclassify thread"));
          },
        }
      );
    },
    [note, recategorize, threadId, currentCategory, setOpen, t]
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
        className="w-[316px] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="border-b border-line px-1.5 py-1">
          <SlashLabel
            label={t("modal.recat.title", "// RECATEGORIZE")}
            size="md"
          />
          <p className="mt-0.5 font-mono text-micro leading-snug text-text-3">
            {t("modal.recat.body", "[—] move this thread to a different group")}
          </p>
        </div>

        {/* Category list */}
        <div className="scrollbar-hide max-h-[320px] overflow-y-auto py-0.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => commit(cat)}
              className={cn(
                "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-1.5 py-0.5 text-left",
                "transition-colors duration-150",
                "hover:bg-surface-hover focus-visible:bg-surface-active focus-visible:outline-none"
              )}
            >
              <span className="min-w-0 truncate font-mono text-micro uppercase tracking-wider text-text-2">
                {categoryLabel(cat)}
              </span>
              <KeyHint
                variant="inline"
                keys={CATEGORY_HOTKEYS[cat]}
                className="text-text-mute"
              />
            </button>
          ))}
        </div>

        <div className="border-t border-line px-1.5 py-1">
          <label
            htmlFor={`recat-note-${threadId}`}
            className="mb-0.5 flex items-center"
          >
            <SlashLabel
              label={t(
                "modal.recat.noteTitle",
                "// CLASSIFIER NOTE — OPTIONAL"
              )}
              tone="text-3"
            />
          </label>
          <textarea
            id={`recat-note-${threadId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t(
              "recategorize.notePlaceholder",
              "This domain is always a vendor…"
            )}
            className={cn(
              "w-full resize-none rounded border border-line bg-surface-input px-1 py-0.5",
              "font-mohave text-caption-sm text-text placeholder:text-text-3",
              "focus:border-line-hi focus:outline-none"
            )}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

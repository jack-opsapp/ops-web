"use client";

/**
 * ThreadPicker — inline trigger + popover that lists OTHER threads with the
 * same client. Lives in the detail-header meta strip, after the message count.
 *
 * Spec § 5.1 (plan Phase E1):
 *   - Trigger: chevron-prefixed JetBrains Mono uppercase 11 with hairline
 *     border. Disabled (mute, no border, no chevron) when no other threads.
 *   - Popover: glass-dense, 12px radius (inherited from .glass-dense), anchored
 *     to the trigger's right edge, ~340px wide. Header SlashLabel + thread
 *     rows. Click row opens the thread and closes the popover.
 *
 * Data feed: parent (E2 wiring in inbox-route.tsx) pre-computes the
 * ThreadPickerThread[] via useClientThreads + computeStateTag.
 */

import { useState, type MouseEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StateTag } from "./state-tag";
import { SlashLabel } from "./voice/slash-label";
import type { StateTagResult } from "@/lib/inbox/format-wait";
import {
  inboxThreadHref,
  shouldHandleInPlaceThreadNavigation,
} from "./inbox-navigation";

export interface ThreadPickerThread {
  id: string;
  subject: string;
  unread: boolean;
  state: StateTagResult;
}

export interface ThreadPickerProps {
  /** All other threads for this client (current thread already excluded by hook). */
  threads: ThreadPickerThread[];
  /** Current thread id — defensive guard against the hook including it. */
  currentThreadId: string | null;
  /** Client display name for the popover header label. */
  clientName: string;
  onSelectThread?: (threadId: string) => void;
  /** Optional className for the trigger wrapper. */
  className?: string;
}

export function ThreadPicker({
  threads,
  currentThreadId,
  clientName,
  onSelectThread,
  className,
}: ThreadPickerProps) {
  const { t } = useDictionary("inbox");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const count = threads.length;

  function handleRowClick(e: MouseEvent<HTMLAnchorElement>, threadId: string) {
    if (!shouldHandleInPlaceThreadNavigation(e)) return;
    e.preventDefault();
    if (onSelectThread) {
      onSelectThread(threadId);
    } else {
      router.push(inboxThreadHref(threadId));
    }
    setOpen(false);
  }

  // Disabled mute label — no other threads
  if (count === 0) {
    return (
      <span
        className={cn(
          "font-mono uppercase tracking-[0.10em] text-[11px] text-text-mute",
          className,
        )}
      >
        {t("picker.triggerNone", "0 OTHER THREADS")}
      </span>
    );
  }

  // The chevron is rendered separately via Lucide so it can flip on expand;
  // the dictionary string carries only the count + label.
  const triggerLabel = t(
    count === 1 ? "picker.triggerOne" : "picker.trigger",
    count === 1 ? "1 OTHER THREAD" : "{count} OTHER THREADS",
  ).replace("{count}", String(count));

  const ariaLabel = t(
    count === 1 ? "picker.ariaLabelOne" : "picker.ariaLabel",
    count === 1
      ? "Show 1 other thread with {client}"
      : "Show {count} other threads with {client}",
  )
    .replace("{count}", String(count))
    .replace("{client}", clientName);

  const headerLabel = t("picker.header", "// THREADS WITH {client} · {count}")
    .replace("{client}", clientName)
    .replace("{count}", String(count));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 py-[2px]",
            "font-mono uppercase tracking-[0.10em] text-[11px] text-text-2",
            "border-line",
            "transition-colors",
            "hover:border-line-hi hover:text-text",
            "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
            className,
          )}
        >
          {open ? (
            <ChevronUp aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <ChevronDown aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          <span>{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[340px] p-2"
      >
        {/* Header */}
        <div className="border-b border-line/50 px-2 py-2">
          <SlashLabel label={headerLabel} tone="text-mute" size="sm" />
        </div>

        {/* Thread rows — empty case is handled by the early return above
            (renders the disabled mute label instead of opening a popover). */}
        <div className="pt-1">
          {threads.map((thread) => {
            const isCurrent = thread.id === currentThreadId;
            const subjectClass = thread.unread ? "text-text" : "text-text-2";

            if (isCurrent) {
              return (
                <div
                  key={thread.id}
                  data-thread-row
                  aria-disabled="true"
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-chip px-2 py-2",
                    "bg-ops-accent/[0.08]",
                  )}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mohave text-[13px]",
                      subjectClass,
                    )}
                  >
                    {thread.subject}
                  </span>
                  <StateTag
                    tone={thread.state.tone}
                    variant="bare"
                    prefix={thread.state.prefix}
                    value={thread.state.value}
                  />
                </div>
              );
            }

            return (
              <a
                key={thread.id}
                href={inboxThreadHref(thread.id)}
                data-thread-row
                onClick={(e) => handleRowClick(e, thread.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-chip px-2 py-1.5 text-left",
                  "transition-colors",
                  "hover:bg-surface-input",
                  "focus-visible:bg-surface-input focus-visible:outline-none",
                )}
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mohave text-[13px]",
                    subjectClass,
                  )}
                >
                  {thread.subject}
                </span>
                <StateTag
                  tone={thread.state.tone}
                  variant="bare"
                  prefix={thread.state.prefix}
                  value={thread.state.value}
                />
              </a>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

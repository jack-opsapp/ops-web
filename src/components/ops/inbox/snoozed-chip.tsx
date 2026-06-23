"use client";

/**
 * SnoozedChip — header chip + popover for currently-snoozed threads.
 *
 * SCHEDULED was deleted as a rail (audit problem 3.1: 0 rows in production
 * for months — the operator never snoozed). Snooze remains as a per-thread
 * action via SnoozePicker. This chip is the recovery surface: when there
 * IS a snoozed thread, the chip surfaces it without the operator having
 * to remember to switch rails or scroll the ALL firehose.
 *
 * Renders nothing while count is zero — keeps the header quiet by default
 * (which matches the audit's observed usage). Clicking the chip opens a
 * Transparent hairline popover listing snoozed threads with unsnooze + open
 * affordances. Re-uses `useInboxThreads({ filter: "SNOOZED" })` so the
 * predicate, sort, and pagination all flow through rail-predicates.ts.
 */

import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useInboxThreads,
  useThreadActions,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxScope } from "@/lib/types/email-thread";
import { SlashLabel } from "./voice/slash-label";
import { HeaderChip } from "./header-chip";

interface SnoozedChipProps {
  scope: InboxScope;
  /** Open the source thread in the inbox. */
  onOpenThread: (threadId: string) => void;
}

function formatSnoozeUntil(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const minutes = Math.max(0, Math.round((t - now) / 60_000));
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.round(hours / 24);
  return `${days}D`;
}

export function SnoozedChip({ scope, onOpenThread }: SnoozedChipProps) {
  const { t } = useDictionary("inbox");
  const [open, setOpen] = useState(false);
  const snoozedQuery = useInboxThreads({ scope, filter: "SNOOZED" });
  const { unsnooze } = useThreadActions();
  const threads = snoozedQuery.data?.pages.flatMap((p) => p.threads) ?? [];
  const count = threads.length;

  if (count === 0) return null;

  const now = Date.now();
  const label = t("header.snoozedChipLabel", "SNOOZED");
  const aria = t("header.snoozedChipAria", "{count} snoozed threads").replace(
    "{count}",
    String(count),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HeaderChip
          count={count}
          label={label}
          ariaLabel={aria}
          open={open}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] rounded-modal border border-line bg-transparent p-0"
      >
        <div className="px-3 pt-2.5 pb-2 border-b border-line">
          <SlashLabel label={t("snoozedPanel.title", "// SNOOZED")} size="md" />
          <p className="font-mono text-[11px] text-text-3 mt-1 leading-relaxed">
            {t(
              "snoozedPanel.body",
              "[—] threads paused until their snooze fires",
            )}
          </p>
        </div>

        <div className="py-1 max-h-[360px] overflow-y-auto scrollbar-hide">
          {threads.map((thread) => {
            const subject =
              thread.subject.trim() || t("detail.untitled", "(no subject)");
            const counterparty =
              thread.clientName ??
              thread.latestSenderName ??
              thread.latestSenderEmail ??
              t("commandPalette.unknownSender", "Unknown");
            return (
              <div
                key={thread.id}
                className="flex items-start gap-2 px-3 py-2 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpenThread(thread.id);
                    setOpen(false);
                  }}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="font-mohave text-body-sm text-text truncate">
                    {subject}
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute truncate">
                    {counterparty}
                    {" · "}
                    {t("snoozedPanel.untilSuffix", "UNTIL {when}").replace(
                      "{when}",
                      formatSnoozeUntil(thread.snoozedUntil, now),
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => unsnooze.mutate(thread.id)}
                  className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute hover:text-text"
                >
                  {t("snoozedPanel.unsnooze", "UNSNOOZE")}
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

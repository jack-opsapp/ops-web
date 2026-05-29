"use client";

/**
 * DraftsChip — header chip + popover that surfaces every unsent draft
 * (provider Gmail/Outlook drafts + Phase C AI drafts) in one list. The
 * counter on the chip is `useInboxDrafts(scope).data.length`.
 *
 * Demoted from the now-removed DRAFTS rail (audit
 * docs/superpowers/research/2026-05-12-inbox-category-audit.md, problem
 * 3.5: drafts lived in the rail row but were fetched from a different
 * endpoint than every other rail). Drafts are now a row-level affordance
 * — each thread row with a draft renders its own `// DRAFT` pill (see
 * thread-row.tsx `row.draftPrefix`); the chip is the operator's escape
 * hatch when they want to see EVERY pending draft without opening each
 * thread.
 *
 * Clicking a row opens the source thread; clicking the discard button
 * fires `useDiscardDraft` and refreshes the chip count via the existing
 * drafts query invalidation.
 */

import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useInboxDrafts,
  useDiscardDraft,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxScope } from "@/lib/types/email-thread";
import { SlashLabel } from "./voice/slash-label";
import { HeaderChip } from "./header-chip";

interface DraftsChipProps {
  scope: InboxScope;
  /** Fires when the operator clicks a draft row — navigates to the thread. */
  onOpenThread: (threadId: string) => void;
}

function formatRelative(updatedAt: string, now: number): string {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return "—";
  const minutes = Math.max(0, Math.round((now - t) / 60_000));
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.round(hours / 24);
  return `${days}D AGO`;
}

export function DraftsChip({ scope, onOpenThread }: DraftsChipProps) {
  const { t } = useDictionary("inbox");
  const [open, setOpen] = useState(false);
  const draftsQuery = useInboxDrafts(scope);
  const discardDraft = useDiscardDraft();
  const drafts = draftsQuery.data ?? [];
  const count = drafts.length;

  if (count === 0) return null;

  const now = Date.now();
  const label = t("header.draftsChipLabel", "DRAFTS");
  const aria = t("header.draftsChipAria", "{count} unsent drafts").replace(
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
        className="w-[320px] rounded-[12px] border border-line bg-transparent p-0"
      >
        <div className="px-3 pt-2.5 pb-2 border-b border-line">
          <SlashLabel label={t("draftsPanel.title", "// DRAFTS")} size="md" />
          <p className="font-mono text-[11px] text-text-3 mt-1 leading-relaxed">
            {t(
              "draftsPanel.body",
              "[—] unsent drafts across every thread",
            )}
          </p>
        </div>

        <div className="py-1 max-h-[360px] overflow-y-auto scrollbar-hide">
          {drafts.map((draft) => {
            const subject = draft.subject.trim() || t("detail.untitled", "(no subject)");
            const peopleLabel = draft.to.join(", ") || draft.fromEmail;
            const targetThreadId = draft.inboxThreadId ?? draft.threadId;
            return (
              <div
                key={`${draft.source}-${draft.id}`}
                className="flex items-start gap-2 px-3 py-2 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (targetThreadId) {
                      onOpenThread(targetThreadId);
                      setOpen(false);
                    }
                  }}
                  disabled={!targetThreadId}
                  className="flex-1 min-w-0 text-left disabled:cursor-default"
                >
                  <div className="font-mohave text-body-sm text-text truncate">
                    {subject}
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute truncate">
                    {peopleLabel}
                    {" · "}
                    {formatRelative(draft.updatedAt, now)}
                    {" · "}
                    {draftSourceLabel(draft.source, t)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    discardDraft.mutate({
                      source: draft.source,
                      id: draft.id,
                      connectionId: draft.connectionId,
                    })
                  }
                  className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute hover:text-rose"
                >
                  {t("draftsPanel.discard", "DISCARD")}
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function draftSourceLabel(
  source: "provider" | "ai" | "lifecycle",
  t: (key: string, fallback: string) => string,
): string {
  if (source === "ai") return t("draftsPanel.phaseC", "PHASE C");
  if (source === "lifecycle") return t("draftsPanel.lifecycle", "LIFECYCLE");
  return t("draftsPanel.provider", "YOURS");
}

"use client";

/**
 * ThreadSiblingStrip (Inbox v2) — "other threads with this client" peek.
 *
 * Rendered under the thread header of ThreadDetailView when the active
 * thread is linked to a client AND that client has at least one other
 * non-archived thread. Collapsed by default — the strip is a peek, not
 * a full history surface — expands on click to show up to 5 rows.
 *
 * Selection contract: clicking a sibling synthesizes a minimal
 * `InboxThreadRow` from the sibling payload and fires `onSelect`. The
 * detail view refetches full data via `useInboxThread`, so the selection
 * path doesn't need to paginate or re-hit the list endpoint. Fields we
 * can't know from the sibling payload (labels, confidence, etc.) default
 * to sensible empties — they'll flash once, then refresh when detail
 * resolves.
 *
 * Why this component and not a panel entry: the "parallel conversations"
 * problem is a navigation primitive, not a memory fact — it belongs where
 * the user is actively reading, not two clicks away in the right panel.
 * See `docs/superpowers/research/2026-04-21-thread-grouping-decision.md`
 * for the "keep flat, add sibling strip" rationale.
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import type {
  InboxSiblingThread,
  InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";
import { CategoryChip } from "./category-chip";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk}w`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Construct a placeholder {@link InboxThreadRow} from a sibling payload.
 * The detail view owns the authoritative fetch; this just gives the
 * selection plumbing enough to paint a header without a null frame.
 */
function siblingToRow(sibling: InboxSiblingThread): InboxThreadRow {
  return {
    id: sibling.id,
    connectionId: sibling.connectionId,
    providerThreadId: sibling.providerThreadId,
    primaryCategory: sibling.primaryCategory,
    categoryConfidence: 0,
    categoryManuallySet: false,
    labels: [],
    archivedAt: sibling.archivedAt,
    snoozedUntil: sibling.snoozedUntil,
    priorityScore: 0,
    aiSummary: null,
    subject: sibling.subject,
    participants: [],
    firstMessageAt: sibling.lastMessageAt,
    lastMessageAt: sibling.lastMessageAt,
    messageCount: sibling.messageCount,
    unreadCount: sibling.unreadCount,
    latestDirection: null,
    latestSenderEmail: sibling.latestSenderEmail,
    latestSenderName: sibling.latestSenderName,
    latestSnippet: sibling.latestSnippet,
    opportunityId: null,
    // clientId is deliberately null on the placeholder — the detail fetch
    // re-resolves it, and the strip itself won't render again (same client
    // as the current thread) until the full payload lands.
    clientId: null,
    clientName: null,
  };
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ThreadSiblingStripProps {
  /** Canonical client name. Falls back to a generic label when null. */
  clientName: string | null;
  /** Client UUID, for the "View client" deep link. */
  clientId: string | null;
  /** Server-provided sibling set — cap 5, most-recent-first. */
  siblings: InboxSiblingThread[];
  /** Fires when the user clicks a sibling row. */
  onSelect: (row: InboxThreadRow) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ThreadSiblingStrip({
  clientName,
  clientId,
  siblings,
  onSelect,
}: ThreadSiblingStripProps) {
  const { t } = useDictionary("inbox");
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  const handleSelect = useCallback(
    (sibling: InboxSiblingThread) => {
      onSelect(siblingToRow(sibling));
    },
    [onSelect]
  );

  // Nothing to show if the thread isn't client-linked or every sibling
  // has been archived — the strip is opt-in chrome.
  if (!clientId || siblings.length === 0) return null;

  const count = siblings.length;
  const displayName = clientName || (t("siblings.clientFallback") ?? "this client");
  const headerLabel =
    count === 1
      ? (t("siblings.headerOne") ?? "1 other thread with {client}").replace(
          "{client}",
          displayName
        )
      : (t("siblings.headerMany") ?? "{count} other threads with {client}")
          .replace("{count}", String(count))
          .replace("{client}", displayName);

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border-subtle",
        "bg-[rgba(255,255,255,0.015)]"
      )}
    >
      {/* Header row — always visible, clickable to toggle expand */}
      <div className="flex items-center gap-2 px-3 h-[30px]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="sibling-strip-list"
          className={cn(
            "group inline-flex items-center gap-1.5 min-w-0 flex-1",
            "text-left focus:outline-none",
            "focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-1 focus-visible:ring-offset-black",
            "rounded-[3px]"
          )}
          title={expanded ? "Collapse sibling threads" : "Show sibling threads"}
        >
          <Users
            className="w-[11px] h-[11px] text-text-mute shrink-0"
            strokeWidth={1.75}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute truncate">
            {`// ${headerLabel}`}
          </span>
          <ChevronDown
            className={cn(
              "w-[11px] h-[11px] text-text-mute shrink-0",
              "transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "group-hover:text-text-2",
              expanded && "rotate-180"
            )}
            strokeWidth={1.75}
          />
        </button>

        {clientId && (
          <Link
            href={`/clients/${clientId}`}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-1.5 h-[20px] rounded-[3px]",
              "font-mono text-[10px] uppercase tracking-[0.14em]",
              "text-text-mute hover:text-text-2 transition-colors",
              "border border-transparent hover:border-border-subtle"
            )}
            title={t("siblings.viewClientTitle") ?? "Open client profile"}
          >
            <span>{t("siblings.viewClient") ?? "View client"}</span>
            <ExternalLink className="w-[9px] h-[9px]" strokeWidth={2} />
          </Link>
        )}
      </div>

      {/* Expanded list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id="sibling-strip-list"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={
              reduceMotion
                ? { opacity: 1 }
                : { height: "auto", opacity: 1 }
            }
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { height: 0, opacity: 0 }
            }
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="overflow-hidden"
          >
            <ul
              role="list"
              className="border-t border-border-subtle divide-y divide-border-subtle"
            >
              {siblings.map((s) => {
                const unread = s.unreadCount > 0;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(s)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5",
                        "text-left cursor-pointer",
                        "transition-colors duration-150",
                        "hover:bg-[rgba(255,255,255,0.04)]",
                        "focus:outline-none focus-visible:bg-[rgba(255,255,255,0.04)]"
                      )}
                    >
                      <CategoryChip category={s.primaryCategory} size="sm" />
                      <span
                        className={cn(
                          "font-mohave text-[12.5px] truncate flex-1 min-w-0",
                          unread ? "text-text font-semibold" : "text-text-2"
                        )}
                      >
                        {s.subject || "(no subject)"}
                      </span>
                      {s.messageCount > 1 && (
                        <span className="font-mono text-[10px] text-text-mute tabular-nums shrink-0">
                          {s.messageCount}
                        </span>
                      )}
                      {unread && (
                        <span
                          aria-hidden
                          className="w-[6px] h-[6px] rounded-full bg-ops-accent shrink-0"
                          title={`${s.unreadCount} unread`}
                        />
                      )}
                      <span className="font-mono text-[10px] text-text-mute tabular-nums shrink-0 w-[28px] text-right">
                        {formatRelative(s.lastMessageAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

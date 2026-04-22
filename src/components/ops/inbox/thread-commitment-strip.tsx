"use client";

/**
 * ThreadCommitmentStrip (Inbox v2) — unresolved commitments for the open
 * thread. Renders one compact row per commitment with a Resolve button.
 *
 * Mounted between the sibling strip and the Phase C status strip so the
 * visual priority reads: identity (header) → parallel context (siblings)
 * → **what you owe** (commitments) → agent state (Phase C) → content.
 *
 * Overdue rows use the brick-red border-accent token (`rgba(147,50,26,*)`)
 * to signal urgency without introducing a new accent color. Upcoming rows
 * use the tan attention token (`#C4A868`). Accent blue is reserved for
 * primary CTAs per the design system.
 *
 * Each row shows:
 *   - `COMMITMENT` label (mono, uppercase)
 *   - due-date chip in local-time natural phrasing ("Due Apr 25" / "Due today" / "Overdue 3d")
 *   - fact content (Mohave body, truncated)
 *   - [ RESOLVE ] button → PATCH /api/inbox/commitments/:id
 *
 * The Resolve mutation invalidates both the thread detail and the list
 * queries so the pill disappears and the COMMITMENTS rail re-sorts
 * without a manual refresh.
 */

import { useCallback, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import {
  useResolveCommitment,
  type InboxThreadCommitment,
} from "@/lib/hooks/use-inbox-threads";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ThreadCommitmentStripProps {
  /** The thread these commitments belong to — needed for cache invalidation. */
  threadId: string;
  /** Server-provided commitment list, earliest-due-first. */
  commitments: InboxThreadCommitment[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

type DueState = "overdue" | "dueToday" | "dueSoon" | "upcoming" | "noDate";

interface DueInfo {
  state: DueState;
  /** Human phrase shown on the chip. */
  label: string;
  /** Optional secondary detail for the tooltip (full date). */
  tooltip: string | null;
}

function describeDue(iso: string | null, now: Date): DueInfo {
  if (!iso) {
    return { state: "noDate", label: "No due date", tooltip: null };
  }
  const due = new Date(iso);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / DAY_MS);
  const absDays = Math.abs(diffDays);
  const full = due.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Same calendar day as `now`?
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();

  if (diffMs < 0) {
    // Past due.
    const label =
      absDays === 0
        ? "Overdue"
        : absDays === 1
        ? "Overdue 1d"
        : `Overdue ${absDays}d`;
    return { state: "overdue", label, tooltip: full };
  }
  if (sameDay) {
    return { state: "dueToday", label: "Due today", tooltip: full };
  }
  if (diffDays <= 2) {
    return {
      state: "dueSoon",
      label: diffDays === 1 ? "Due tomorrow" : `Due in ${diffDays}d`,
      tooltip: full,
    };
  }
  // Further out — show the date directly.
  const short = due.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return { state: "upcoming", label: `Due ${short}`, tooltip: full };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ThreadCommitmentStrip({
  threadId,
  commitments,
}: ThreadCommitmentStripProps) {
  const { t } = useDictionary("inbox");
  const reduceMotion = useReducedMotion();
  const resolve = useResolveCommitment();

  // Stable `now` for a single render pass so all pills describe due dates
  // against the same reference point.
  const now = useMemo(() => new Date(), []);

  const handleResolve = useCallback(
    (commitmentId: string) => {
      resolve.mutate({
        id: commitmentId,
        resolvedAt: new Date().toISOString(),
        threadId,
      });
    },
    [resolve, threadId]
  );

  if (commitments.length === 0) return null;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className={cn(
        "shrink-0 border-b border-border-subtle",
        // Slightly warmer tint than neutral chrome to draw the eye — but
        // not accent blue, which is reserved for primary CTAs in the
        // design system v2.
        "bg-[rgba(196,168,104,0.025)]"
      )}
    >
      <ul role="list" className="divide-y divide-border-subtle">
        {commitments.map((c) => {
          const due = describeDue(c.dueDate, now);
          const isOverdue = due.state === "overdue" || due.state === "dueToday";

          return (
            <li key={c.id}>
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5",
                  "transition-colors duration-150"
                )}
              >
                <CalendarClock
                  className={cn(
                    "w-[12px] h-[12px] shrink-0",
                    isOverdue ? "text-rose" : "text-[#C4A868]"
                  )}
                  strokeWidth={1.75}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute shrink-0">
                  {t("commitment.label") ?? "// COMMITMENT"}
                </span>

                {/* Due chip */}
                <span
                  title={due.tooltip ?? undefined}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] border",
                    "font-mono text-[10px] uppercase tracking-[0.14em] leading-none",
                    isOverdue
                      ? "border-[rgba(181,130,137,0.32)] text-rose bg-[rgba(181,130,137,0.08)]"
                      : due.state === "dueSoon"
                      ? "border-[rgba(196,168,104,0.32)] text-[#C4A868] bg-[rgba(196,168,104,0.08)]"
                      : "border-border-subtle text-text-3 bg-[rgba(255,255,255,0.02)]"
                  )}
                >
                  {isOverdue && (
                    <AlertTriangle className="w-[9px] h-[9px]" strokeWidth={2} />
                  )}
                  <span>{due.label}</span>
                </span>

                {/* Content */}
                <span
                  className="font-mohave text-[12.5px] text-text-2 truncate flex-1 min-w-0"
                  title={c.content}
                >
                  {c.content || (t("commitment.empty") ?? "—")}
                </span>

                {/* Resolve */}
                <button
                  type="button"
                  onClick={() => handleResolve(c.id)}
                  disabled={resolve.isPending}
                  title={t("commitment.resolveTitle") ?? "Mark commitment resolved"}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 px-2 h-[22px] rounded-[4px] border",
                    "font-mono text-[10px] uppercase tracking-[0.14em]",
                    "transition-colors duration-150",
                    "border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-2",
                    "hover:bg-[rgba(157,181,130,0.08)] hover:border-[rgba(157,181,130,0.28)] hover:text-[#9DB582]",
                    resolve.isPending && "opacity-50 cursor-wait"
                  )}
                >
                  <Check className="w-[10px] h-[10px]" strokeWidth={2} />
                  <span>{t("commitment.resolve") ?? "Resolve"}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

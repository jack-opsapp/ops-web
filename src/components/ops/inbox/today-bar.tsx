"use client";

/**
 * TodayBar — urgent obligation rows for the top of the thread list.
 *
 * Renders nothing when there are no commitments. When present, it stays inside
 * the B3 scroll surface as fixed-height list rows so urgent commitments do not
 * become a separate card-like block or uneven wrapping chip field.
 */

import Link from "next/link";
import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StateTag, type StateTagTone } from "./state-tag";

const MAX_VISIBLE_OBLIGATIONS = 3;

export interface TodayCommitment {
  /** `agent_memories.id` — the row to PATCH when ✓ is clicked. */
  id: string;
  threadId: string;
  /** Accessible description ("Karen Etheridge — Re: Vinyl siding quote"). */
  text: string;
  /** Display name in the row (just "Karen Etheridge"). */
  clientName: string;
  /** Pre-computed via computeStateTag — drives the inline tag rendering. */
  state: { tone: StateTagTone; prefix: string; value?: string };
  /** Days since the last inbound message; state tag carries the visible urgency. */
  waitingDays: number;
}

interface TodayBarProps {
  commitments: TodayCommitment[];
  /**
   * Inline resolve handler. When provided, each row renders a ✓ button
   * that calls this with the commitment id (NOT the thread id). When
   * omitted, the rows are navigate-only.
   */
  onResolve?: (commitmentId: string) => void;
  /** Set of commitment ids currently being resolved. Disables their ✓ button. */
  pendingResolveIds?: ReadonlySet<string>;
  className?: string;
}

export function TodayBar({
  commitments,
  onResolve,
  pendingResolveIds,
  className,
}: TodayBarProps) {
  const { t } = useDictionary("inbox");
  if (commitments.length === 0) return null;

  const items = commitments.slice(0, MAX_VISIBLE_OBLIGATIONS);
  const overflowCount = Math.max(0, commitments.length - items.length);

  return (
    <div
      data-testid="today-bar"
      data-inbox-debug-id="B2"
      data-inbox-debug-label="URGENT OBLIGATIONS"
      className={cn(
        "shrink-0",
        className,
      )}
    >
      <ul className="min-w-0">
        {items.map((c) => {
          const resolving = pendingResolveIds?.has(c.id) ?? false;
          const rowToneClass =
            c.state.tone === "rose"
              ? "bg-rose/[0.025] hover:bg-rose/[0.05]"
              : c.state.tone === "tan"
                ? "bg-tan/[0.035] hover:bg-tan/[0.06]"
                : "bg-inbox-elev/35 hover:bg-inbox-elev/60";
          const stripeClass =
            c.state.tone === "rose"
              ? "bg-rose"
              : c.state.tone === "tan"
                ? "bg-tan"
                : "bg-line-hi";
          return (
            <li
              key={c.id}
              aria-label={c.text}
              className={cn(
                "relative flex h-7 min-w-0 items-center border-b border-line transition-colors",
                rowToneClass,
                resolving && "opacity-60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-1 left-0 top-1 w-[2px] rounded-r-[2px]",
                  stripeClass,
                )}
              />
              <Link
                href={`/inbox/${c.threadId}`}
                aria-label={c.text}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 py-1 pl-3 pr-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate font-mohave text-[12px] font-medium text-text">
                  {c.clientName}
                </span>
                <StateTag
                  tone={c.state.tone}
                  variant="bare"
                  prefix={c.state.prefix}
                  value={c.state.value}
                />
              </Link>
              {onResolve && (
                <button
                  type="button"
                  onClick={() => onResolve(c.id)}
                  disabled={resolving}
                  data-testid="today-bar-resolve"
                  aria-label={t(
                    "todayBar.resolve",
                    "Mark commitment resolved",
                  )}
                  title={t("todayBar.resolve", "Mark commitment resolved")}
                  className={cn(
                    "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-text-3 transition-colors",
                    "hover:bg-olive/[0.18] hover:text-olive disabled:cursor-not-allowed",
                  )}
                >
                  <Check aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {overflowCount > 0 ? (
        <div
          data-testid="today-bar-overflow"
          className="flex h-6 items-center border-b border-line px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {t(
            "todayBar.moreObligations",
            "+{count} MORE IN YOUR MOVE",
          ).replace("{count}", String(overflowCount))}
        </div>
      ) : null}
    </div>
  );
}

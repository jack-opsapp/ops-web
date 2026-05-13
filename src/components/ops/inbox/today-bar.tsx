"use client";

/**
 * TodayBar — phase-B rebuild, see spec § 4 (punch-list table) and § 4.1
 * (state-tag derivation).
 *
 * Two states:
 *   • commitments.length > 0 → header `// YOUR MOVE :: {n} OVERDUE · {m} TODAY`
 *     (or `// YOUR MOVE :: {m} TODAY` when nothing's overdue) over a vertical
 *     list of up to 3 commitment rows. Each row is `clientName · <StateTag bare>
 *     · ✓ resolve · → open` — no subject text, no inline due-text. The state
 *     tag carries the full state (`+38D · WAITING`, `YOURS · 18H`, etc.).
 *   • commitments.length === 0 → `// CAUGHT UP` header + a tactical body line
 *     (`[—] no open commitments · {sentToday} sent today` by default, or
 *     whatever the caller passes via `caughtUpDetail`).
 *
 * Container gradient is brick-tinted when ≥ 1 row has `waitingDays > 7`
 * (alarm posture), accent-tinted otherwise (today-only posture), and
 * olive-tinted for the empty state.
 *
 * Per-row tone follows `state.tone`:
 *   rose    → rose-tinted border + bg
 *   tan     → tan-tinted border + bg
 *   neutral → hairline border + inbox-elev bg
 *   (other tones the StateTag supports — accent / olive / lavender — fall
 *    through to the neutral chrome since they're not commitment-row states.)
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StateTag, type StateTagTone } from "./state-tag";
import { SlashLabel } from "./voice/slash-label";

const BG_OVERDUE = "bg-brick/[0.10]";
const BG_TODAY = "bg-tan/[0.06]";
const BG_EMPTY = "bg-olive/[0.04]";

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
  /** Days since the last inbound message (used to determine if the bar tints brick). */
  waitingDays: number;
}

interface TodayBarProps {
  commitments: TodayCommitment[];
  /** Optional caught-up summary line override (defaults to the t-key). */
  caughtUpDetail?: string;
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
  caughtUpDetail,
  onResolve,
  pendingResolveIds,
  className,
}: TodayBarProps) {
  const { t } = useDictionary("inbox");
  const empty = commitments.length === 0;

  if (empty) {
    return (
      <div
        data-testid="today-bar"
        className={cn(
          "shrink-0 border-b border-line px-3.5 pb-3.5 pt-4",
          BG_EMPTY,
          className,
        )}
      >
        <SlashLabel label={t("todayBar.caughtUpHeader", "// CAUGHT UP")} />
        <div
          className="mt-1.5 font-mono text-[11px] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {caughtUpDetail ??
            t("todayBar.caughtUpBody", "[—] no open commitments")}
        </div>
      </div>
    );
  }

  const items = commitments.slice(0, 3);
  const overdueCount = items.filter((c) => c.waitingDays > 7).length;
  const todayCount = items.length - overdueCount;
  const anyOverdue = overdueCount > 0;

  const headerLabel =
    overdueCount > 0
      ? t(
          "todayBar.yourMoveOverdue",
          "// YOUR MOVE :: {overdue} OVERDUE · {today} TODAY",
        )
          .replace("{overdue}", String(overdueCount))
          .replace("{today}", String(todayCount))
      : t("todayBar.yourMoveTodayOnly", "// YOUR MOVE :: {today} TODAY").replace(
          "{today}",
          String(todayCount),
        );

  return (
    <div
      data-testid="today-bar"
      className={cn(
        "shrink-0 border-b border-line px-3.5 pb-3.5 pt-3",
        anyOverdue ? BG_OVERDUE : BG_TODAY,
        className,
      )}
    >
      <div className="mb-2">
        <SlashLabel label={headerLabel} />
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((c) => {
          const resolving = pendingResolveIds?.has(c.id) ?? false;
          const toneClass =
            c.state.tone === "rose"
              ? "border-rose/30 bg-rose/[0.08] hover:bg-rose/[0.12]"
              : c.state.tone === "tan"
                ? "border-tan/30 bg-tan/[0.08]"
                : "border-line-hi bg-inbox-elev hover:bg-inbox-elev/80";
          return (
            <li
              key={c.id}
              aria-label={c.text}
              className={cn(
                "flex w-full items-center gap-2 rounded-[2.5px] border pr-1.5 transition-colors",
                toneClass,
                resolving && "opacity-60",
              )}
            >
              <Link
                href={`/inbox/${c.threadId}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[2.5px] py-2 pl-2.5 text-left"
              >
                <span className="min-w-0 flex-1 truncate font-mohave text-[12px] text-text">
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
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px] text-text-3 transition-colors",
                    "hover:bg-olive/[0.18] hover:text-olive disabled:cursor-not-allowed",
                  )}
                >
                  <Check aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
              <Link
                href={`/inbox/${c.threadId}`}
                aria-label={t("todayBar.openThread", "Open thread")}
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px] text-text-3 hover:text-text-2"
              >
                <ArrowRight
                  aria-hidden
                  className="h-3 w-3"
                  strokeWidth={1.5}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

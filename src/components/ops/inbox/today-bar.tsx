"use client";

/**
 * TodayBar — faithful port of `reference/v4-states.jsx :: V4TodayStrip`,
 * extended with an inline ✓ resolve affordance per row.
 *
 * Two states:
 *   • commitments.length > 0 → header ("Your move · today · {n} items") +
 *     a vertical list of up to 3 commitment rows. Each row: rose border +
 *     rose dot + rose due-text when urgent, otherwise hairline border +
 *     accent dot + text-3 due-text. Right edge: a small ✓ button (when
 *     `onResolve` is provided) followed by the navigate arrow.
 *   • commitments.length === 0 → single olive "All caught up" tile.
 *
 * Container uses an accent-tinted gradient (or olive when empty) so the
 * strip reads as the spatially-loudest part of the column.
 *
 * Note on tracking: canonical mono meta uses `letterSpacing: 0.2` which is
 * **0.2 PIXELS** in inline-style (≈ 0.02em at 10px), not 0.2em. The bar
 * therefore renders mono lines flush, NOT wide-tracked.
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface TodayCommitment {
  /** `agent_memories.id` — the row to PATCH when ✓ is clicked. */
  id: string;
  text: string;
  due: string;
  threadId: string;
  urgent: boolean;
}

interface TodayBarProps {
  commitments: TodayCommitment[];
  /** Optional caught-up summary line ("Nothing waiting on you · 2 sent today"). */
  caughtUpDetail?: string;
  /**
   * Inline resolve handler. When provided, each row renders a ✓ button
   * that calls this with the commitment id (NOT the thread id). When
   * omitted, the rows are navigate-only — preserves the legacy behavior
   * for callers that don't yet wire commitment resolution.
   */
  onResolve?: (commitmentId: string) => void;
  /** Set of commitment ids currently being resolved. Disables their ✓
   *  button to prevent double-fire. */
  pendingResolveIds?: ReadonlySet<string>;
  className?: string;
}

const BG_HAS_COMMITS =
  "bg-[linear-gradient(180deg,rgba(111,148,176,0.06)_0%,transparent_100%)]";
const BG_EMPTY =
  "bg-[linear-gradient(180deg,rgba(157,181,130,0.06)_0%,transparent_100%)]";

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
        className={cn(
          "shrink-0 border-b border-line px-3.5 pb-3.5 pt-4",
          BG_EMPTY,
          className,
        )}
      >
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="font-cakemono text-[10.5px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
            {t("todayBar.today", "TODAY")}
          </span>
        </div>
        <div className="flex items-center gap-2.5 rounded-md border border-olive/30 bg-olive/[0.06] px-3 py-2.5">
          <Check
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-olive"
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1">
            <div className="font-mohave text-[13px] tracking-[-0.003em] text-text">
              {t("todayBar.allCaughtUp", "All caught up")}
            </div>
            <div
              className="mt-0.5 font-mono text-[10px] text-text-3"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {caughtUpDetail ?? t("todayBar.allCaughtUpDetail", "Nothing waiting on you")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const items = commitments.slice(0, 3);

  return (
    <div
      className={cn(
        "shrink-0 border-b border-line px-3.5 pb-3.5 pt-3",
        BG_HAS_COMMITS,
        className,
      )}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-cakemono text-[10.5px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
          {t("todayBar.yourMove", "YOUR MOVE")}
        </span>
        <span className="font-mono text-[10px] text-text-mute">
          · {t("todayBar.today", "today").toLowerCase()}
        </span>
        <span
          className="ml-auto font-mono text-[10px] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {items.length === 1
            ? t("todayBar.itemCount_one", "1 item")
            : t("todayBar.itemCount_other", "{count} items").replace(
                "{count}",
                String(items.length),
              )}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((c) => {
          const resolving = pendingResolveIds?.has(c.id) ?? false;
          return (
            <li
              key={c.id}
              data-testid="today-bar-commitment"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md border pr-1.5 transition-colors",
                c.urgent
                  ? "border-rose/30 bg-rose/[0.08] hover:bg-rose/[0.12]"
                  : "border-line-hi bg-inbox-elev hover:bg-inbox-elev/80",
                resolving && "opacity-60",
              )}
            >
              <Link
                href={`/inbox/${c.threadId}`}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pl-2.5 text-left"
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    c.urgent ? "bg-rose" : "bg-ops-accent",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mohave text-[12.5px] tracking-[-0.003em] text-text">
                    {c.text}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block font-mono text-[10px]",
                      c.urgent ? "text-rose" : "text-text-3",
                    )}
                    style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                  >
                    {c.due}
                  </span>
                </span>
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
                    "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-text-3 transition-colors",
                    "hover:bg-olive/[0.18] hover:text-olive disabled:cursor-not-allowed",
                  )}
                >
                  <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
              <Link
                href={`/inbox/${c.threadId}`}
                aria-label={t("todayBar.openThread", "Open thread")}
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-text-3 hover:text-text-2"
              >
                <ArrowRight
                  aria-hidden
                  className="h-[11px] w-[11px]"
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

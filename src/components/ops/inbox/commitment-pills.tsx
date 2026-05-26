"use client";

/**
 * CommitmentPills — renders the unresolved Phase C commitments attached
 * to the open thread. Sits between the detail header and the DetailBand.
 *
 * Each pill carries:
 *   - urgency dot (rose when due ≤ 24h, tan otherwise)
 *   - the fact text Phase C extracted (truncated)
 *   - due-date meta in tactical mono (TODAY 18:00 / FRI MAY 9)
 *   - inline ✓ resolve button — patches `agent_memories.id` directly
 *
 * The component renders nothing when there are no commitments — it's a
 * silent pass-through, not an empty state.
 *
 * Tokens:
 *   - Radii from the OPS sharp-corners scale (2.5px buttons / 5px panels)
 *   - Rose for urgent, tan for non-urgent (single-curve hover)
 *   - Stroke 1.5 on the Check icon (matches the inbox-wide convention)
 */

import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface CommitmentPillItem {
  /** `agent_memories.id` — the row to PATCH on resolve. */
  id: string;
  /** Phase C-extracted fact text (e.g. "Promised revised quote by Friday"). */
  content: string;
  /** Pre-formatted due display ("TODAY 18:00", "FRI MAY 9", "—"). */
  due: string;
  urgent: boolean;
}

interface CommitmentPillsProps {
  commitments: CommitmentPillItem[];
  onResolve: (commitmentId: string) => void;
  pendingResolveIds?: ReadonlySet<string>;
  className?: string;
}

export function CommitmentPills({
  commitments,
  onResolve,
  pendingResolveIds,
  className,
}: CommitmentPillsProps) {
  const { t } = useDictionary("inbox");

  if (commitments.length === 0) return null;

  return (
    <section
      aria-label={t("commitmentPills.aria", "Open commitments on this thread")}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-transparent px-2.5 py-1.5",
        className,
      )}
    >
      <span className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-mute">
        {t("commitmentPills.label", "Open commitments")}
      </span>
      {commitments.map((c) => {
        const resolving = pendingResolveIds?.has(c.id) ?? false;
        return (
          <span
            key={c.id}
            data-testid="commitment-pill"
            title={c.content}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-[2.5px] border bg-transparent px-1.5 py-0.5 transition-opacity",
              c.urgent ? "border-rose/35" : "border-line-hi",
              resolving && "opacity-60",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                c.urgent ? "bg-rose" : "bg-tan",
              )}
            />
            <span
              data-testid="commitment-pill-content"
              className="min-w-0 max-w-[420px] flex-1 truncate font-mohave text-[12px] text-text-2"
            >
              {c.content}
            </span>
            <span
              className={cn(
                "shrink-0 font-mono text-[11px] tabular-nums uppercase tracking-[0.18em]",
                c.urgent ? "text-rose" : "text-text-mute",
              )}
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {c.due}
            </span>
            <button
              type="button"
              onClick={() => onResolve(c.id)}
              disabled={resolving}
              aria-label={t(
                "commitmentPills.resolve",
                "Mark commitment resolved",
              )}
              title={t("commitmentPills.resolve", "Mark commitment resolved")}
              data-testid="commitment-pill-resolve"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-[2.5px] text-text-3 transition-colors",
                "hover:bg-olive/[0.18] hover:text-olive disabled:cursor-not-allowed",
              )}
            >
              <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </span>
        );
      })}
    </section>
  );
}

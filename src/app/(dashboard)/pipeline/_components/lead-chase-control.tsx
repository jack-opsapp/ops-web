"use client";

import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { useMarkOpportunityHandled } from "@/lib/hooks/use-opportunities";
import {
  getLeadChaseState,
  type DateLike,
  type LeadChaseStateInput,
} from "@/lib/leads/chase-state";
import { cn } from "@/lib/utils/cn";

export interface LeadChaseOpportunity extends LeadChaseStateInput {
  id: string;
  nextFollowUpAt: DateLike;
}

function toMutationDate(value: DateLike): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * One permission-aware chase-state control for board, mobile, and table scans.
 * HANDLED always routes through the canonical atomic opportunity mutation.
 */
export function LeadChaseControl({
  opportunity,
  canMarkHandled,
  density = "default",
  className,
}: {
  opportunity: LeadChaseOpportunity;
  canMarkHandled: boolean;
  density?: "default" | "compact";
  className?: string;
}) {
  const { t } = useDictionary("pipeline");
  const markHandled = useMarkOpportunityHandled();
  const state = getLeadChaseState(opportunity);

  if (state === null) return null;

  const isYourMove = state === "your_move";

  const handleMarkHandled = () => {
    markHandled.mutate(
      {
        id: opportunity.id,
        currentNextFollowUpAt: toMutationDate(opportunity.nextFollowUpAt),
      },
      {
        onError: (error) => {
          toast.error(
            t("toast.markHandledFailedTactic", "SYS :: HANDLE FAILED"),
            {
              description: error instanceof Error ? error.message : undefined,
            }
          );
        },
      }
    );
  };

  return (
    <div
      data-lead-chase-state={state}
      data-lead-chase-density={density}
      className={cn(
        "tracking-label flex min-w-0 shrink-0 items-center font-mono text-micro uppercase",
        density === "compact" ? "gap-1" : "gap-2",
        className
      )}
    >
      <span
        className={cn(
          "shrink-0 font-medium",
          isYourMove ? "text-tan" : "text-text-3"
        )}
      >
        {isYourMove
          ? t("card.yourMove", "YOUR MOVE")
          : t("card.waiting", "WAITING")}
      </span>
      {isYourMove && canMarkHandled ? (
        <button
          type="button"
          aria-label={t("card.markHandledLabel", "Mark handled")}
          disabled={markHandled.isPending}
          onClick={(event) => {
            event.stopPropagation();
            handleMarkHandled();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn(
            "shrink-0 rounded border border-line font-medium text-text-2 hover:border-line-hi hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:cursor-wait disabled:opacity-50",
            density === "compact" ? "px-1.5 py-0.5" : "px-2 py-1"
          )}
        >
          {t("card.markHandled", "HANDLED")}
        </button>
      ) : null}
    </div>
  );
}

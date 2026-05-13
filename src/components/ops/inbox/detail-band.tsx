"use client";

import {
  selectActionBand,
  type BandThreadInput,
} from "@/lib/inbox/band-selection";
import { SummaryBand } from "./bands/summary-band";
import {
  NeedsInputBand,
  type NeedsInputOption,
} from "./bands/needs-input-band";
import { AutoSentBand } from "./bands/auto-sent-band";
import { ClosedBand, type ClosedBandVariant } from "./bands/closed-band";

export type DetailBandAction =
  | "provide-answer"
  | "type-reply"
  | `answer:${string}`;

interface DetailBandProps {
  thread: BandThreadInput;
  /** Summary band — ISO of summary update. */
  summaryUpdatedAt?: string | null;
  /** Needs-input band — agent question text. */
  agentQuestion?: string;
  agentOptions?: NeedsInputOption[];
  /** Needs-input band — minutes since Claude paused. */
  agentPausedMinutesAgo?: number;
  /** Auto-sent band — hours since auto-send. */
  autoSentHoursAgo?: number;
  /** Auto-sent band — short explanation line. */
  autoSentDetail?: string;
  /** Closed band — ISO of close timestamp. */
  closedAt?: string | null;
  /** Closed band — resolved-by-Claude vs archived-by-user. */
  closedVariant?: ClosedBandVariant;
  /** Closed band — optional secondary detail line. */
  closedDetail?: string;
  /** Renders relative timestamps; defaults to Date.now(). */
  renderedAt?: number;
  onAction: (action: DetailBandAction) => void;
}

export function DetailBand({
  thread,
  summaryUpdatedAt,
  agentQuestion,
  agentOptions,
  agentPausedMinutesAgo,
  autoSentHoursAgo,
  autoSentDetail,
  closedAt,
  closedVariant,
  closedDetail,
  renderedAt,
  onAction,
}: DetailBandProps) {
  const showSummary = !thread.closed && !!thread.aiSummary;
  const actionBand = selectActionBand(thread);

  if (!showSummary && actionBand === null) return null;

  return (
    <>
      {showSummary && (
        <SummaryBand
          body={thread.aiSummary ?? ""}
          updatedAt={summaryUpdatedAt}
          renderedAt={renderedAt}
        />
      )}
      {actionBand === "needs-input" && (
        <NeedsInputBand
          question={agentQuestion ?? ""}
          options={agentOptions}
          pausedMinutesAgo={agentPausedMinutesAgo}
          onAction={(id) => onAction(id as DetailBandAction)}
        />
      )}
      {actionBand === "auto-sent" && (
        <AutoSentBand
          hoursAgo={autoSentHoursAgo ?? 0}
          detail={autoSentDetail}
        />
      )}
      {actionBand === "closed" && (
        <ClosedBand
          closedAt={closedAt ?? null}
          variant={closedVariant}
          detail={closedDetail}
        />
      )}
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import {
  selectActionBand,
  type BandThreadInput,
} from "@/lib/inbox/band-selection";
import { SummaryBand } from "./bands/summary-band";
import {
  NeedsInputBand,
  type NeedsInputOption,
} from "./bands/needs-input-band";
import { BallYoursBand } from "./bands/ball-yours-band";
import { AutoSentBand } from "./bands/auto-sent-band";
import { ClosedBand, type ClosedBandVariant } from "./bands/closed-band";

export type DetailBandAction =
  | "reply"
  | "take-over"
  | "history"
  | "provide-answer"
  | "type-reply"
  | `answer:${string}`;

interface DetailBandProps {
  thread: BandThreadInput;
  clientName: string;
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
  /** Ball-yours band — pre-formatted wait clock ("18H" / "12D" / "MAR 4"). */
  ballYoursWaitDuration?: string;
  /**
   * Ball-yours band — clears AWAITING_REPLY for this thread. Hidden when
   * omitted (e.g. on rails where the override doesn't make sense). The
   * BallYoursBand renders an inline `✓` button when this is provided.
   */
  ballYoursOnAcknowledge?: () => void;
  /**
   * Ball-yours band — render-prop that wraps the snooze icon in the shared
   * `<SnoozePicker>` popover, mirroring the detail-header's snoozeSlot
   * pattern. Hidden when omitted.
   */
  ballYoursSnoozeSlot?: (button: ReactNode) => ReactNode;
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
  clientName,
  summaryUpdatedAt,
  agentQuestion,
  agentOptions,
  agentPausedMinutesAgo,
  autoSentHoursAgo,
  autoSentDetail,
  ballYoursWaitDuration,
  ballYoursOnAcknowledge,
  ballYoursSnoozeSlot,
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
          onHistory={() => onAction("history")}
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
      {actionBand === "ball-yours" && (
        <BallYoursBand
          clientName={clientName}
          waitDuration={ballYoursWaitDuration ?? ""}
          onReply={() => onAction("reply")}
          onAcknowledge={ballYoursOnAcknowledge}
          snoozeSlot={ballYoursSnoozeSlot}
        />
      )}
      {actionBand === "auto-sent" && (
        <AutoSentBand
          hoursAgo={autoSentHoursAgo ?? 0}
          detail={autoSentDetail}
          onTakeOver={() => onAction("take-over")}
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

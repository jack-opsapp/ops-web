"use client";

import {
  selectBand,
  type BandThreadInput,
} from "@/lib/inbox/band-selection";
import { SummaryBand } from "./bands/summary-band";
import {
  NeedsInputBand,
  type NeedsInputOption,
} from "./bands/needs-input-band";
import { BallYoursBand } from "./bands/ball-yours-band";
import { AutoSentBand } from "./bands/auto-sent-band";
import { ClosedBand } from "./bands/closed-band";

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
  /** Ball-yours band — relative last-reply meta ("Last reply · 2h"). */
  ballYoursLastReplyLabel?: string;
  /** Closed band — ISO of close timestamp. */
  closedAt?: string | null;
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
  ballYoursLastReplyLabel,
  closedAt,
  renderedAt,
  onAction,
}: DetailBandProps) {
  const kind = selectBand(thread);
  if (!kind) return null;

  switch (kind) {
    case "summary":
      return (
        <SummaryBand
          body={thread.aiSummary ?? ""}
          updatedAt={summaryUpdatedAt}
          renderedAt={renderedAt}
          onHistory={() => onAction("history")}
        />
      );
    case "needs-input":
      return (
        <NeedsInputBand
          question={agentQuestion ?? ""}
          options={agentOptions}
          pausedMinutesAgo={agentPausedMinutesAgo}
          onAction={(id) => onAction(id as DetailBandAction)}
        />
      );
    case "ball-yours":
      return (
        <BallYoursBand
          clientName={clientName}
          lastReplyLabel={ballYoursLastReplyLabel}
          onReply={() => onAction("reply")}
        />
      );
    case "auto-sent":
      return (
        <AutoSentBand
          hoursAgo={autoSentHoursAgo ?? 0}
          detail={autoSentDetail}
          onTakeOver={() => onAction("take-over")}
        />
      );
    case "closed":
      return <ClosedBand closedAt={closedAt ?? null} />;
  }
}

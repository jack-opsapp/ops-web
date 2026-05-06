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
  | "revise"
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
  /** Auto-sent band — hours since auto-send. */
  autoSentHoursAgo?: number;
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
  autoSentHoursAgo,
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
          onAction={(id) => onAction(id as DetailBandAction)}
        />
      );
    case "ball-yours":
      return (
        <BallYoursBand
          clientName={clientName}
          onReply={() => onAction("reply")}
        />
      );
    case "auto-sent":
      return (
        <AutoSentBand
          hoursAgo={autoSentHoursAgo ?? 0}
          onRevise={() => onAction("revise")}
        />
      );
    case "closed":
      return <ClosedBand closedAt={closedAt ?? null} />;
  }
}

/**
 * Pure annotation pass that decorates each message with run/boundary flags.
 * The renderer reads the flags to decide:
 *   - whether to draw a tail corner (last of an author run)
 *   - whether to collapse the vertical gap (within a run)
 *   - whether to insert a day-separator above (dayBoundary)
 *
 * Run break rules — a message starts a new run when ANY of:
 *   - first message in the list
 *   - different `authorId` from previous
 *   - different `source` from previous (so AI-on-behalf vs human reads distinct)
 *   - more than 5 minutes since the previous message in the same author/source
 */

const RUN_GAP_MS = 5 * 60 * 1000;

export type MessageSource = "human" | "ai";

export interface MessageForGrouping {
  id: string;
  authorId: string;
  /** Unix milliseconds. */
  ts: number;
  source: MessageSource;
}

export interface AnnotatedMessage<T extends MessageForGrouping = MessageForGrouping> {
  message: T;
  isFirstOfRun: boolean;
  isLastOfRun: boolean;
  /** True when this is the first message on a new calendar day. */
  dayBoundary: boolean;
}

function isSameCalendarDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

function startsNewRun(prev: MessageForGrouping, curr: MessageForGrouping): boolean {
  if (prev.authorId !== curr.authorId) return true;
  if (prev.source !== curr.source) return true;
  if (curr.ts - prev.ts > RUN_GAP_MS) return true;
  return false;
}

export function annotateMessages<T extends MessageForGrouping>(
  messages: T[],
): AnnotatedMessage<T>[] {
  if (messages.length === 0) return [];

  const out: AnnotatedMessage<T>[] = [];
  for (let i = 0; i < messages.length; i++) {
    const curr = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    const isFirstOfRun = !prev || startsNewRun(prev, curr);
    const isLastOfRun = !next || startsNewRun(curr, next);
    const dayBoundary = !prev || !isSameCalendarDay(prev.ts, curr.ts);

    out.push({ message: curr, isFirstOfRun, isLastOfRun, dayBoundary });
  }
  return out;
}

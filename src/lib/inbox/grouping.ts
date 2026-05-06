/**
 * Pure thread-grouping function for the redesigned inbox left column.
 *
 * Groups (top → bottom):
 *   NEEDS_YOUR_INPUT  → threads where Claude is blocked waiting on the user
 *   URGENT            → threads explicitly labelled URGENT
 *   TODAY             → recency: ts is in the same calendar day as `now`
 *   THIS_WEEK         → recency: ts within last 7 days but not today
 *   EARLIER           → everything older
 *
 * Suppressed by default:
 *   - threads with `phaseC === "auto_sent"`  (Claude already replied; quiet pile)
 *   - threads with `closed === true`         (resolved; archived from list)
 *
 * Within each group, threads are sorted newest-first by `ts`.
 *
 * Group precedence: NEEDS_YOUR_INPUT wins over URGENT wins over recency.
 */

export type PhaseC = "none" | "ai_drafted" | "auto_sent";

export type GroupKey =
  | "NEEDS_YOUR_INPUT"
  | "URGENT"
  | "TODAY"
  | "THIS_WEEK"
  | "EARLIER";

export const GROUP_ORDER: readonly GroupKey[] = [
  "NEEDS_YOUR_INPUT",
  "URGENT",
  "TODAY",
  "THIS_WEEK",
  "EARLIER",
] as const;

export interface ThreadForGrouping {
  id: string;
  /** Unix milliseconds — most recent activity. */
  ts: number;
  labels: string[];
  agent: { needsInput: boolean };
  phaseC: PhaseC;
  closed: boolean;
}

const DAY_MS = 1000 * 60 * 60 * 24;

function isSameCalendarDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

function classify(thread: ThreadForGrouping, now: number): GroupKey | null {
  if (thread.closed) return null;
  if (thread.phaseC === "auto_sent") return null;
  if (thread.agent.needsInput) return "NEEDS_YOUR_INPUT";
  if (thread.labels.includes("URGENT")) return "URGENT";
  if (isSameCalendarDay(thread.ts, now)) return "TODAY";
  if (now - thread.ts <= 7 * DAY_MS) return "THIS_WEEK";
  return "EARLIER";
}

export function groupThreads<T extends ThreadForGrouping>(
  threads: T[],
  now: number,
): Map<GroupKey, T[]> {
  const out = new Map<GroupKey, T[]>();
  for (const key of GROUP_ORDER) out.set(key, []);

  for (const thread of threads) {
    const key = classify(thread, now);
    if (key) out.get(key)!.push(thread);
  }

  for (const key of GROUP_ORDER) {
    out.get(key)!.sort((a, b) => b.ts - a.ts);
  }

  return out;
}

// src/lib/inbox/format-wait.ts
import type { StateTagTone } from "@/components/ops/inbox/state-tag";

const MIN_MS = 60_000;
const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;
const WEEK_MS = 7 * DAY_MS;
const TWO_WEEKS_MS = 14 * DAY_MS;

/**
 * Formats a wait duration into a terse human-readable clock label.
 *
 * - < 60m  → "45M"
 * - < 24h  → "18H"
 * - < 30d  → "12D"
 * - ≥ 30d  → absolute date "APR 3" (derived from asOf − durationMs)
 *
 * @param durationMs - Elapsed milliseconds (e.g. Date.now() - lastInboundAt)
 * @param asOf       - Reference point for absolute date calculation (defaults to now)
 */
export function formatWaitClock(durationMs: number, asOf: Date = new Date()): string {
  const ms = Math.max(0, durationMs);
  if (ms < HOUR_MS) {
    const m = Math.max(1, Math.round(ms / MIN_MS));
    return `${m}M`;
  }
  if (ms < DAY_MS) {
    const h = Math.round(ms / HOUR_MS);
    return `${h}H`;
  }
  if (ms < 30 * DAY_MS) {
    const d = Math.floor(ms / DAY_MS);
    return `${d}D`;
  }
  const at = new Date(asOf.getTime() - ms);
  return at
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

// ─── State-tag types ────────────────────────────────────────────────────────

export type StateTagKind =
  | "draft_ready"
  | "auto_sent"
  | "yours"
  | "overdue"
  | "alarmed"
  | "theirs"
  | "fyi"
  | "sys"
  | "closed";

export interface StateTagResult {
  kind: StateTagKind;
  tone: StateTagTone;
  prefix?: string;
  value?: string;
  /** True when this thread should also render the row alarm strip. */
  alarmStrip: boolean;
}

export interface StateTagInputs {
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  hasAiDraft: boolean;
  /** True if the last outbound was sent by the AI agent within the last 24h. */
  sentByAgentRecently: boolean;
  /** ThreadCategory enum value (string — enum is defined in email-thread.ts). */
  category: string;
  closed: boolean;
  now: number;
}

/**
 * Derives the state-tag from a thread's runtime signals.
 *
 * Precedence (highest to lowest):
 *   closed > draft_ready > auto_sent > fyi > overdue/alarmed > yours > theirs > fyi(fallback)
 *
 * SYS detection: The ThreadCategory enum currently does not have a `SYS` value.
 * The `OTHER` path below is a placeholder — refine when SYS enum lands in Phase B2.
 */
export function computeStateTag(input: StateTagInputs): StateTagResult {
  const {
    lastInboundAt,
    lastOutboundAt,
    hasAiDraft,
    sentByAgentRecently,
    category,
    closed,
    now,
  } = input;

  if (closed) {
    return { kind: "closed", tone: "neutral", prefix: "CLOSED", alarmStrip: false };
  }
  if (hasAiDraft) {
    return { kind: "draft_ready", tone: "lavender", prefix: "DRAFT READY", alarmStrip: false };
  }
  if (sentByAgentRecently) {
    return { kind: "auto_sent", tone: "lavender", prefix: "AUTO-SENT", alarmStrip: false };
  }
  if (category === "FYI") {
    return { kind: "fyi", tone: "neutral", prefix: "FYI", alarmStrip: false };
  }

  // SYS detection placeholder — refine when SYS enum lands in Phase B2.
  // `OTHER` is the closest current category; this path will be narrowed to `SYS` only.
  if (category === "SYS" || category === "OTHER") {
    if (lastOutboundAt && (!lastInboundAt || lastOutboundAt > lastInboundAt)) {
      return { kind: "sys", tone: "neutral", prefix: "SYS", alarmStrip: false };
    }
  }

  const inboundUnreplied =
    lastInboundAt !== null &&
    (!lastOutboundAt || lastInboundAt > lastOutboundAt);
  const outboundUnreplied =
    lastOutboundAt !== null &&
    (!lastInboundAt || lastOutboundAt > lastInboundAt);

  if (inboundUnreplied && lastInboundAt !== null) {
    const elapsed = now - lastInboundAt;
    if (elapsed > TWO_WEEKS_MS) {
      const days = Math.floor(elapsed / DAY_MS);
      return {
        kind: "alarmed",
        tone: "rose",
        prefix: `+${days}D`,
        value: "WAITING",
        alarmStrip: true,
      };
    }
    if (elapsed > WEEK_MS) {
      const days = Math.floor(elapsed / DAY_MS);
      return {
        kind: "overdue",
        tone: "rose",
        prefix: `+${days}D`,
        value: "WAITING",
        alarmStrip: false,
      };
    }
    return {
      kind: "yours",
      tone: "accent",
      prefix: "YOURS",
      value: formatWaitClock(elapsed),
      alarmStrip: false,
    };
  }

  if (outboundUnreplied && lastOutboundAt !== null) {
    const elapsed = now - lastOutboundAt;
    return {
      kind: "theirs",
      tone: elapsed > WEEK_MS ? "tan" : "neutral",
      prefix: "THEIRS",
      value: formatWaitClock(elapsed),
      alarmStrip: false,
    };
  }

  return { kind: "fyi", tone: "neutral", prefix: "FYI", alarmStrip: false };
}

// src/lib/inbox/format-wait.ts
import type { StateTagTone } from "@/components/ops/inbox/state-tag";
import type { EmailThreadLabel } from "@/lib/types/email-thread";

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
  /**
   * Secondary labels emitted by the Phase C classifier. The presence of
   * `AWAITING_REPLY` is the canonical signal that the operator is on the hook
   * for a reply — without it, an unreplied inbound is treated as FYI rather
   * than escalating through YOURS/OVERDUE/ALARMED. Pass the thread's full
   * label array; computeStateTag only inspects `AWAITING_REPLY`.
   */
  labels: ReadonlyArray<EmailThreadLabel>;
  closed: boolean;
  now: number;
}

/**
 * Derives the state-tag from a thread's runtime signals.
 *
 * Precedence (highest to lowest):
 *   closed > draft_ready > auto_sent > overdue/alarmed > yours > theirs > fyi
 *
 * "Is this thread on the operator?" — gated on the classifier's
 * `AWAITING_REPLY` label, not on raw inbound/outbound timestamps. Auto-
 * notifications, forwarded form submissions, and receipts have an unreplied
 * inbound but no AWAITING_REPLY label; they collapse to FYI here so the
 * operator's NEEDS REPLY band only contains threads that actually need a
 * reply.
 */
export function computeStateTag(input: StateTagInputs): StateTagResult {
  const {
    lastInboundAt,
    lastOutboundAt,
    hasAiDraft,
    sentByAgentRecently,
    labels,
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

  const awaitingReply = labels.includes("AWAITING_REPLY");
  const inboundUnreplied =
    lastInboundAt !== null &&
    (!lastOutboundAt || lastInboundAt > lastOutboundAt);
  const outboundUnreplied =
    lastOutboundAt !== null &&
    (!lastInboundAt || lastOutboundAt > lastInboundAt);

  if (inboundUnreplied && lastInboundAt !== null && awaitingReply) {
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
      tone:
        elapsed > TWO_WEEKS_MS
          ? "rose"
          : elapsed > WEEK_MS
            ? "tan"
            : "neutral",
      prefix: "THEIRS",
      value: formatWaitClock(elapsed),
      alarmStrip: false,
    };
  }

  return { kind: "fyi", tone: "neutral", prefix: "FYI", alarmStrip: false };
}

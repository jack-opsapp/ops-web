const HANDLED_COMEBACK_MS = 3 * 24 * 60 * 60 * 1000;

export type DateLike = Date | string | null | undefined;

export type LeadChaseState = "your_move" | "waiting";

export interface LeadChaseStateInput {
  stage: string;
  lastMessageDirection: "in" | "out" | null;
  lastInboundAt: DateLike;
  handledAt: DateLike;
}

function toValidMillis(value: DateLike): number | null {
  if (value == null) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

/** Canonical cross-client YOUR MOVE rule for a pipeline opportunity. */
export function isLeadYourMove(input: LeadChaseStateInput): boolean {
  if (input.stage === "new_lead" || input.lastMessageDirection !== "in") {
    return false;
  }

  if (input.handledAt == null) return true;

  const handledAt = toValidMillis(input.handledAt);
  const lastInboundAt = toValidMillis(input.lastInboundAt);
  // Reply debt is fail-safe: malformed or temporarily incomplete projection
  // data must never hide a customer's latest inbound from the operator.
  if (handledAt === null || lastInboundAt === null) return true;
  return lastInboundAt > handledAt;
}

/** Canonical presentation state shared by every lead scan surface. */
export function getLeadChaseState(
  input: LeadChaseStateInput
): LeadChaseState | null {
  if (isLeadYourMove(input)) return "your_move";

  if (
    input.stage !== "new_lead" &&
    input.lastMessageDirection === "in" &&
    input.handledAt != null
  ) {
    return "waiting";
  }

  return null;
}

/**
 * Comeback rule for HANDLED: default to +3 days, but retain a valid future
 * follow-up when it occurs sooner. Past, invalid, and later dates are replaced.
 */
export function computeHandledFollowUpAt(
  existingFollowUpAt: DateLike,
  handledAt: Date = new Date()
): Date {
  const fallbackMillis = handledAt.getTime() + HANDLED_COMEBACK_MS;
  const existingMillis = toValidMillis(existingFollowUpAt);
  if (
    existingMillis !== null &&
    existingMillis > handledAt.getTime() &&
    existingMillis < fallbackMillis
  ) {
    return new Date(existingMillis);
  }
  return new Date(fallbackMillis);
}

const HANDLED_COMEBACK_MS = 3 * 24 * 60 * 60 * 1000;

export type DateLike = Date | string | null | undefined;

export type LeadChaseState = "your_move" | "waiting";

export interface LeadChaseStateInput {
  stage: string;
  lastMessageDirection: "in" | "out" | null;
  lastInboundAt: DateLike;
  lastOutboundAt: DateLike;
  handledAt: DateLike;
  operatorActionRequiredAt: DateLike;
}

function toValidMillis(value: DateLike): number | null {
  if (value == null) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Canonical cross-client YOUR MOVE rule for a pipeline opportunity.
 *
 * The newest valid event wins. Manual signals resolve exact ties before
 * correspondence; the explicit action-required correction resolves a tie with
 * handled. Inbound/outbound correspondence ties use the projected direction.
 */
export function isLeadYourMove(input: LeadChaseStateInput): boolean {
  if (input.stage === "new_lead") return false;

  const lastInboundAt = toValidMillis(input.lastInboundAt);
  const lastOutboundAt = toValidMillis(input.lastOutboundAt);
  const handledAt = toValidMillis(input.handledAt);
  const operatorActionRequiredAt = toValidMillis(
    input.operatorActionRequiredAt
  );
  const validSignals = [
    lastInboundAt,
    lastOutboundAt,
    handledAt,
    operatorActionRequiredAt,
  ].filter((value): value is number => value !== null);

  if (validSignals.length === 0) {
    return input.lastMessageDirection === "in";
  }

  const latest = Math.max(...validSignals);
  if (operatorActionRequiredAt === latest) return true;
  if (handledAt === latest) return false;

  const inboundIsLatest = lastInboundAt === latest;
  const outboundIsLatest = lastOutboundAt === latest;
  if (inboundIsLatest && outboundIsLatest) {
    return input.lastMessageDirection === "in";
  }
  return inboundIsLatest;
}

/** Canonical presentation state shared by every lead scan surface. */
export function getLeadChaseState(
  input: LeadChaseStateInput
): LeadChaseState | null {
  if (isLeadYourMove(input)) return "your_move";
  return input.stage === "new_lead" ? null : "waiting";
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

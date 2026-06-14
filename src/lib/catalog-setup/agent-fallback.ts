// Pure driver/commit resolution for the wizard's failure modes (spec §16:
// "Offline", "Agent off", "Agent failure mid-session"). The guided survey +
// template + manual lanes always stand alone, so any agent problem degrades to
// the deterministic path with ZERO data loss — every already-accepted card stays
// on the canvas. Framework-free → unit-tested without a browser.

export type DriverKind = "agent" | "guided";

export interface DriverConditions {
  online: boolean;
  agentEnabled: boolean;
  agentErrored: boolean;
}

/**
 * The agent drives only when it can actually help: online, enabled, and not
 * already failed this session. Otherwise the deterministic guided path takes
 * over (it never depends on the agent).
 */
export function resolveDriver({
  online,
  agentEnabled,
  agentErrored,
}: DriverConditions): DriverKind {
  return online && agentEnabled && !agentErrored ? "agent" : "guided";
}

/** Commits are held while offline — staged cards persist client-side until back. */
export function commitsHeld(online: boolean): boolean {
  return !online;
}

/**
 * The no-data-loss guarantee: an agent failure mid-session returns the exact
 * set of already-accepted cards, untouched (same reference). The owner keeps
 * every row they accepted and simply continues on the guided path.
 */
export function preserveAcceptedOnFailure<T>(prevAccepted: T): T {
  return prevAccepted;
}

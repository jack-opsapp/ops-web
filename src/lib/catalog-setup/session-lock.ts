// Single-session-per-company lock predicate (plan Task 6.3 / spec §16 "only one
// setup session at a time per company"). PURE conflict logic + a session-id
// minter; the network read of the lock row is the caller's concern (mocked in
// tests). A stale lock (heartbeat older than LOCK_TTL_MS) self-releases so an
// abandoned/crashed tab never permanently blocks resume.

/** Staleness window: a lock whose heartbeat is older than this is dead. */
export const LOCK_TTL_MS = 120_000;

export interface LockState {
  /** The session id that currently holds the lock. */
  sessionId: string;
  /** Epoch ms of the holder's last heartbeat. */
  heartbeatAt: number;
}

/**
 * Is the lock held by ANOTHER live session? Free when: no lock exists, the lock
 * is mine, or another session's lock is stale (heartbeat older than the TTL).
 */
export function isHeldByOther(
  lock: LockState | null,
  mySessionId: string,
  nowMs: number,
): boolean {
  if (!lock) return false;
  if (lock.sessionId === mySessionId) return false;
  const age = nowMs - lock.heartbeatAt;
  return age <= LOCK_TTL_MS;
}

/** A fresh, collision-resistant session id, prefixed `cw_` (catalog wizard). */
export function buildSessionId(): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `cw_${rand}`;
}

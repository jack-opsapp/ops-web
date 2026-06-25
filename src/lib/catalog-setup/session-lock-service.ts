// Single-session-per-company lock SERVICE (plan Task 6.3 / spec §16 "only one
// setup session at a time per company"). A thin, fail-open wrapper over the pure
// `isHeldByOther` predicate + a swappable `LockStore` adapter that owns the
// network read/write of the lock row. The substrate is intentionally abstracted:
// the predicate and this wrapper don't care WHICH table backs the lock, so the
// substrate can be chosen/changed without touching the logic or the UI.
//
// FAIL-OPEN is the cardinal rule. A lock is a courtesy guard against two windows
// building divergent catalogs at once — it must NEVER wall a legitimate operator
// out of setup. The real data-integrity guard is the merge-capable, idempotent
// `catalog_setup_save` RPC, which makes concurrent commits merge rather than
// corrupt. So every store error here resolves to "not held / acquired", never to
// a block.

import { isHeldByOther, type LockState } from "./session-lock";

/**
 * The lock substrate, abstracted to a read/write/release triple. The supabase
 * implementation lives with its only consumer (the wizard lock hook); tests pass
 * a mock so the network read is never real.
 */
export interface LockStore {
  /** The current lock row for a company, or null when none exists. */
  read(companyId: string): Promise<LockState | null>;
  /** Claim/refresh the lock for `sessionId` at `heartbeatAt` (upsert). */
  write(companyId: string, sessionId: string, heartbeatAt: number): Promise<void>;
  /** Drop the lock if it's still mine (best-effort). */
  release(companyId: string, sessionId: string): Promise<void>;
}

export interface LockProbe {
  /** Is another LIVE session holding the lock? */
  heldByOther: boolean;
  /** The row that was read (diagnostics); null when absent or on a fail-open read. */
  current: LockState | null;
}

/**
 * Read the lock and decide whether another live session holds it, WITHOUT taking
 * it. Fail-open: any read error resolves to not-held (the lock infra must never
 * be the thing that blocks setup).
 */
export async function probeSessionLock(
  store: LockStore,
  companyId: string,
  mySessionId: string,
  nowMs: number,
  myUserId?: string | null,
): Promise<LockProbe> {
  try {
    const current = await store.read(companyId);
    return {
      heldByOther: isHeldByOther(current, mySessionId, nowMs, myUserId),
      current,
    };
  } catch {
    return { heldByOther: false, current: null };
  }
}

/**
 * Acquire the lock: probe, and if it's free (no row / mine / stale), write my
 * session as the holder. If another live session holds it, do NOT overwrite —
 * report `heldByOther`. Fail-open: a read error → acquired; a write error is
 * swallowed (still acquired). The probe-then-write is not atomic, so a true
 * simultaneous double-start is last-write-wins — benign here (the once-ever owner
 * setup makes it vanishingly rare, and the commit RPC merges regardless).
 */
export async function acquireSessionLock(
  store: LockStore,
  companyId: string,
  mySessionId: string,
  nowMs: number,
  myUserId?: string | null,
): Promise<LockProbe> {
  const probe = await probeSessionLock(store, companyId, mySessionId, nowMs, myUserId);
  if (probe.heldByOther) return probe;
  try {
    await store.write(companyId, mySessionId, nowMs);
  } catch {
    // Swallow — fail-open. A failed claim must not block setup.
  }
  return {
    heldByOther: false,
    current: { sessionId: mySessionId, heartbeatAt: nowMs },
  };
}

/** Refresh my lock's heartbeat. Best-effort — never throws into the UI. */
export async function heartbeatSessionLock(
  store: LockStore,
  companyId: string,
  mySessionId: string,
  nowMs: number,
): Promise<void> {
  try {
    await store.write(companyId, mySessionId, nowMs);
  } catch {
    // Swallow — a missed heartbeat just lets the lock go stale, which self-heals.
  }
}

/** Release my lock on exit. Best-effort — never throws. */
export async function releaseSessionLock(
  store: LockStore,
  companyId: string,
  mySessionId: string,
): Promise<void> {
  try {
    await store.release(companyId, mySessionId);
  } catch {
    // Swallow — a missed release just lets the lock go stale (TTL self-heals).
  }
}

"use client";

/**
 * useCatalogSetupLock — acquire + heartbeat the company's single setup-session
 * lock for the lifetime of the wizard, and report when another LIVE session in
 * the company already holds it (spec §16 "only one setup session at a time per
 * company"; plan Task 6.3). Pairs with the pure `isHeldByOther` predicate + the
 * fail-open `session-lock-service` wrapper.
 *
 * FAIL-OPEN. The lock is a courtesy guard, never a barrier: every store error is
 * swallowed by the service, so the only thing this can do is ADD the honest
 * "already in setup" panel. The substrate (catalog_setup_session_locks) is LIVE
 * on prod (applied 2026-06-15) and the lock is ON BY DEFAULT — set
 * NEXT_PUBLIC_CATALOG_SETUP_LOCK_ENABLED="false" as a kill-switch if it ever
 * needs disabling. When off the hook never touches the network and reports
 * not-held. (It is also inert wherever the wizard isn't mounted: the shell-only
 * dev preview and the gate preview render their components directly, not this
 * route, so they never acquire a lock.)
 */

import { useEffect, useRef, useState } from "react";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";
import { buildSessionId, type LockState } from "@/lib/catalog-setup/session-lock";
import {
  acquireSessionLock,
  heartbeatSessionLock,
  releaseSessionLock,
  type LockStore,
} from "@/lib/catalog-setup/session-lock-service";

// On by default now the substrate is live; the env var is a kill-switch (="false").
const LOCK_ENABLED =
  process.env.NEXT_PUBLIC_CATALOG_SETUP_LOCK_ENABLED !== "false";

/** Refresh well under the 120s staleness TTL so a live session never expires. */
const HEARTBEAT_MS = 30_000;

const LOCK_TABLE = "catalog_setup_session_locks";

const LOCK_SESSION_KEY = "ops-catalog-setup-lock-session";

/**
 * Per-TAB stable lock session id (sessionStorage). A page reload re-reads the same
 * id, so the operator reclaims their OWN still-fresh lock row (isHeldByOther is
 * false for a matching id) instead of minting a new id that reads the orphan as
 * held-by-other and walls the sole operator out of their own setup for up to the
 * 120s TTL. A genuinely separate tab gets its own sessionStorage → its own id, so
 * the one-session-per-company guard still holds.
 */
function getOrCreateLockSessionId(): string {
  if (typeof window === "undefined") return buildSessionId();
  const existing = window.sessionStorage.getItem(LOCK_SESSION_KEY);
  if (existing) return existing;
  const minted = buildSessionId();
  window.sessionStorage.setItem(LOCK_SESSION_KEY, minted);
  return minted;
}

interface LockRow {
  session_id: string;
  heartbeat_at: string;
}

/**
 * Supabase-backed LockStore against the dedicated catalog_setup_session_locks
 * table (company_id PK → one row per company; upsert = claim/refresh). Addressed
 * through a narrow cast because the table is provisioned by a not-yet-applied
 * migration and isn't in the generated Database types yet; the hook is env-gated
 * off until that migration lands, so this path is dormant in prod until then.
 */
export function createSupabaseLockStore(userId?: string | null): LockStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = () => (requireSupabase() as any).from(LOCK_TABLE);
  return {
    async read(companyId) {
      const { data, error } = await table()
        .select("session_id, heartbeat_at")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as LockRow;
      const parsed = Date.parse(row.heartbeat_at);
      const lock: LockState = {
        sessionId: row.session_id,
        heartbeatAt: Number.isNaN(parsed) ? 0 : parsed,
      };
      return lock;
    },
    async write(companyId, sessionId, heartbeatAt) {
      const iso = new Date(heartbeatAt).toISOString();
      const { error } = await table().upsert(
        {
          company_id: companyId,
          session_id: sessionId,
          user_id: userId ?? null,
          heartbeat_at: iso,
          updated_at: iso,
        },
        { onConflict: "company_id" },
      );
      if (error) throw error;
    },
    async release(companyId, sessionId) {
      const { error } = await table()
        .delete()
        .eq("company_id", companyId)
        .eq("session_id", sessionId);
      if (error) throw error;
    },
  };
}

export interface CatalogSetupLock {
  /** Another live session in this company is running setup. */
  heldByOther: boolean;
  /** The first probe has resolved (until then, render the wizard optimistically). */
  ready: boolean;
}

export function useCatalogSetupLock(): CatalogSetupLock {
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";
  const userId = useAuthStore((s) => s.currentUser?.id ?? null);
  const [heldByOther, setHeldByOther] = useState(false);
  const [ready, setReady] = useState(!LOCK_ENABLED || !companyId);
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) sessionIdRef.current = getOrCreateLockSessionId();

  useEffect(() => {
    if (!LOCK_ENABLED || !companyId) {
      setReady(true);
      return;
    }
    const store = createSupabaseLockStore(userId);
    const mySession = sessionIdRef.current as string;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const probe = await acquireSessionLock(
        store,
        companyId,
        mySession,
        Date.now(),
      );
      if (cancelled) return;
      setHeldByOther(probe.heldByOther);
      setReady(true);
      // Only heartbeat when WE hold it — a session that lost the race must not
      // keep a row alive and starve the holder.
      if (!probe.heldByOther) {
        interval = setInterval(() => {
          void heartbeatSessionLock(store, companyId, mySession, Date.now());
        }, HEARTBEAT_MS);
      }
    })();

    // Best-effort release on tab close. pagehide covers mobile Safari / bfcache
    // where beforeunload never fires; the TTL self-heals if both are missed, and
    // the persisted per-tab session id lets a reload reclaim its own row anyway.
    const onUnload = () => {
      void releaseSessionLock(store, companyId, mySession);
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      void releaseSessionLock(store, companyId, mySession);
    };
  }, [companyId, userId]);

  return { heldByOther, ready };
}

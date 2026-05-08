"use client";

import * as React from "react";

// `useWindowPersistence` — localStorage round-trip for window pos+size.
//
// On mount: reads `opsWin:<key>` once and exposes the parsed snapshot
// via `loaded` (or null if absent / corrupt).
// On change: writes the new snapshot back, debounced 200ms so dragging
// 60+ frames per second doesn't spam localStorage.
// CRITICAL: skips the FIRST write after mount so we don't immediately
// overwrite the loaded snapshot with the same value (the original
// handoff comment notes this stalled main-thread when 20+ windows
// were open).
// On unmount: flushes any pending write so the most recent state is
// always durable, even if the user closes the window mid-drag.

const STORAGE_PREFIX = "opsWin:";
const DEBOUNCE_MS = 200;

interface PersistenceSnapshot {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface UseWindowPersistenceOpts {
  /** Stable identifier — usually the window id from useWindowStore. */
  key: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface UseWindowPersistenceReturn {
  /** Snapshot read from storage on mount, or null when none. */
  loaded: PersistenceSnapshot | null;
}

function readSnapshot(key: string): PersistenceSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistenceSnapshot;
    // Loose validation — don't trust storage.
    if (
      typeof parsed?.position?.x === "number" &&
      typeof parsed?.position?.y === "number" &&
      typeof parsed?.size?.width === "number" &&
      typeof parsed?.size?.height === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSnapshot(key: string, snapshot: PersistenceSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify(snapshot),
    );
  } catch {
    // Quota / private mode — drop silently. Position recovery is a
    // nicety, not a critical path.
  }
}

export function useWindowPersistence({
  key,
  position,
  size,
}: UseWindowPersistenceOpts): UseWindowPersistenceReturn {
  // Read once on mount; useState initialiser only runs the first time.
  const [loaded] = React.useState<PersistenceSnapshot | null>(() => readSnapshot(key));

  // Skip-initial-write — the loaded snapshot is identical to the
  // current props on mount (the parent applies it before the hook
  // sees it), and overwriting it with itself just thrashes storage.
  const hasMountedRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest pending snapshot — flushed on unmount.
  const latestRef = React.useRef<PersistenceSnapshot>({ position, size });
  latestRef.current = { position, size };

  // Track whether a write is pending. Stays true between schedule and
  // flush so the unmount-flush effect can write even after the per-dep
  // cleanup has cleared the timer.
  const pendingWriteRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    pendingWriteRef.current = true;
    timerRef.current = setTimeout(() => {
      writeSnapshot(key, latestRef.current);
      timerRef.current = null;
      pendingWriteRef.current = false;
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [key, position.x, position.y, size.width, size.height]);

  // Flush on unmount — guaranteed durability. We can't read timerRef
  // here because the per-dep cleanup already cleared it; instead we
  // check pendingWriteRef which only flips false when the timer
  // actually fired.
  React.useEffect(() => {
    return () => {
      if (pendingWriteRef.current) {
        pendingWriteRef.current = false;
        writeSnapshot(key, latestRef.current);
      }
    };
    // Intentionally empty-deps: only fire on unmount. `key` is stable
    // for a given window instance — if it ever changed mid-mount, the
    // window-store would have torn this down anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loaded };
}

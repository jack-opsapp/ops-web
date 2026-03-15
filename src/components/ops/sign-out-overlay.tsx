"use client";

/**
 * SignOutOverlay — Tactical sign-out animation
 *
 * 3 sequential progress bars over 4 seconds:
 *   1. Clearing local data (0–1.2s)
 *   2. Releasing database connection (1.0–2.4s)
 *   3. Signing out [USER NAME] (2.0–3.5s)
 * All bars complete → hold briefly → navigate to /login
 *
 * Cleanup (stores, cookies, Firebase) happens at ~1.2s so the
 * dashboard underneath can't flash back. The overlay stays
 * mounted (never calls end()) until window.location.href
 * replaces the React tree entirely.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useSignOutStore } from "@/stores/signout-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSetupStore } from "@/stores/setup-store";
import { signOut } from "@/lib/firebase/auth";

// ─── Constants ──────────────────────────────────────────────────────────────

const TOTAL_MS = 4000;
const CLEANUP_AT_MS = 1200; // align with "clearing local data" completing

interface ProgressLine {
  label: string;
  startMs: number;
  fillMs: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SignOutOverlay() {
  const { active, userName } = useSignOutStore();
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const rafRef = useRef(0);
  const cleanedUpRef = useRef(false);
  const navigatedRef = useRef(false);

  const lines: ProgressLine[] = [
    { label: "CLEARING LOCAL DATA", startMs: 0, fillMs: 1200 },
    { label: "RELEASING DATABASE CONNECTION", startMs: 1000, fillMs: 1400 },
    { label: `SIGNING OUT ${userName.toUpperCase()}`, startMs: 2000, fillMs: 1200 },
  ];

  const performCleanup = useCallback(() => {
    if (cleanedUpRef.current) return;
    cleanedUpRef.current = true;

    // Clear cookies
    document.cookie = "ops-auth-token=; path=/; max-age=0";
    document.cookie = "__session=; path=/; max-age=0";

    // Clear stores
    useSetupStore.getState().reset();
    useAuthStore.getState().logout();

    // Firebase sign out
    signOut().catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      cleanedUpRef.current = false;
      navigatedRef.current = false;
      return;
    }

    startRef.current = performance.now();

    function tick(now: number) {
      const ms = now - startRef.current;
      setElapsed(ms);

      // Perform cleanup early so dashboard can't flash
      if (ms >= CLEANUP_AT_MS) {
        performCleanup();
      }

      // Animation done → navigate (overlay stays mounted)
      if (ms >= TOTAL_MS) {
        if (!navigatedRef.current) {
          navigatedRef.current = true;
          window.location.href = "/login";
        }
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [active, performCleanup]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center">
      {/* OPS mark */}
      <span className="font-mohave text-[32px] tracking-[0.25em] text-[rgba(255,255,255,0.06)] uppercase mb-12 select-none">
        OPS
      </span>

      {/* Progress lines */}
      <div className="w-full max-w-[320px] space-y-5 px-6">
        {lines.map((line, i) => {
          const lineElapsed = Math.max(0, elapsed - line.startMs);
          const progress = Math.min(lineElapsed / line.fillMs, 1);
          const started = elapsed >= line.startMs;
          const complete = progress >= 1;

          return (
            <div
              key={i}
              className="transition-opacity duration-300"
              style={{ opacity: started ? 1 : 0 }}
            >
              {/* Label row */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-[0.15em]">
                  {line.label}
                </span>
                <span
                  className="font-kosugi text-[9px] uppercase tracking-[0.1em] transition-colors duration-200"
                  style={{ color: complete ? "rgba(89, 119, 148, 0.8)" : "rgba(255,255,255,0.15)" }}
                >
                  {complete ? "DONE" : `${Math.round(progress * 100)}%`}
                </span>
              </div>

              {/* Bar track */}
              <div className="w-full h-[2px] bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress * 100}%`,
                    backgroundColor: complete
                      ? "rgba(89, 119, 148, 0.6)"
                      : "rgba(89, 119, 148, 0.35)",
                    transition: "background-color 200ms ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Timestamp */}
      <p className="font-kosugi text-[9px] text-[rgba(255,255,255,0.08)] uppercase tracking-[0.2em] mt-10 select-none">
        [{new Date().toISOString().split("T")[0]}]
      </p>
    </div>
  );
}

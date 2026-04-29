"use client";

/**
 * ActivePauseBanner — sticky banner shown across the email-admin tab when
 * ANY scope is paused. Polls /api/admin/email/pauses every 10s.
 *
 * Visual spec:
 *   - olive #9DB582 border at low alpha (warning, not error — pauses are
 *     reversible operator actions, not crashes).
 *   - tan #C4A868 for the // PAUSED eyebrow.
 *   - sentence-case body, no emoji, no exclamation points.
 *
 * Tactical voice: `// PAUSED  GLOBAL is paused  [reason]`.
 */
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { activePauseBannerVariants } from "@/lib/utils/motion";

interface ActivePauseRow {
  scope: string;
  isPaused: boolean;
  pauseReason: string | null;
  pausedUntil: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
}

interface PausesResponse {
  ok: boolean;
  active: ActivePauseRow[];
}

async function fetchActivePauses(): Promise<ActivePauseRow[]> {
  const r = await fetch("/api/admin/email/pauses", { cache: "no-store" });
  if (!r.ok) return [];
  const j = (await r.json()) as PausesResponse;
  return j.active ?? [];
}

function formatScope(scope: string): string {
  if (scope === "global") return "ALL EMAIL";
  if (scope.startsWith("bucket:")) {
    const name = scope.split(":")[1] ?? "";
    return `BUCKET / ${name.toUpperCase()}`;
  }
  if (scope.startsWith("campaign:")) {
    const id = scope.split(":")[1] ?? "";
    return `CAMPAIGN / ${id.slice(0, 8)}`;
  }
  return scope.toUpperCase();
}

export function ActivePauseBanner() {
  const reduced = useReducedMotion();
  const { data } = useQuery({
    queryKey: ["email-active-pauses"],
    queryFn: fetchActivePauses,
    refetchInterval: 10_000,
  });

  const pauses = data ?? [];

  return (
    <AnimatePresence>
      {pauses.length > 0 && (
        <motion.div
          key="active-pause-banner"
          variants={reduced ? undefined : activePauseBannerVariants}
          initial={reduced ? false : "initial"}
          animate={reduced ? false : "animate"}
          exit={reduced ? undefined : "exit"}
          className="sticky top-0 z-30 border-b border-[#9DB582]/40 px-6 py-3"
          style={{
            background: "rgba(157, 181, 130, 0.08)",
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C4A868] shrink-0">
                {"// PAUSED"}
              </div>
              <div className="font-mohave text-[14px] text-[#EDEDED] truncate">
                {pauses.length === 1
                  ? `${formatScope(pauses[0].scope)} is paused`
                  : `${pauses.length} scopes paused`}
              </div>
              {pauses[0]?.pauseReason && (
                <div className="font-mono text-[11px] text-[#8A8A8A] truncate">
                  [{pauses[0].pauseReason}]
                </div>
              )}
            </div>
            <a
              href="/admin/email?tab=killswitches"
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6F94B0] hover:text-[#EDEDED] shrink-0"
            >
              {"Manage →"}
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

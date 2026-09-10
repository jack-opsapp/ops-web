"use client";

/**
 * Engine readiness ledger — shown on /admin/google-ads while the account is
 * dark (no activity in the last 30 days). Seven facts, one line each: what
 * Google will and will not accept from OPS right now, and whether the first
 * measured click has arrived. Reads /api/admin/google-ads/readiness.
 *
 * Skeleton while pending (a paused fetch must never read as "nothing to
 * show"), a single line on failure, never an empty panel.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { ReadinessCheck, ReadinessKey, ReadinessState } from "@/lib/ads/readiness";

export const READINESS_ROW_TITLES = [
  "Service account can write",
  "Customer data terms accepted",
  "Enhanced conversions for leads",
  "Data Manager API reachable",
  "Conversion actions in place",
  "Click ids arriving",
  "First event delivered",
] as const;

const TITLE_BY_KEY: Record<ReadinessKey, (typeof READINESS_ROW_TITLES)[number]> = {
  service_account_role: "Service account can write",
  customer_data_terms: "Customer data terms accepted",
  enhanced_conversions_for_leads: "Enhanced conversions for leads",
  data_manager_api: "Data Manager API reachable",
  conversion_actions: "Conversion actions in place",
  click_id_capture: "Click ids arriving",
  first_event_sent: "First event delivered",
};

const STATE_LABEL: Record<ReadinessState, string> = {
  ready: "READY",
  blocked: "BLOCKED",
  pending: "PENDING",
};

const DOT_CLASS: Record<ReadinessState, string> = {
  ready: "bg-olive",
  blocked: "bg-rose",
  pending: "bg-fill-neutral",
};

const LABEL_CLASS: Record<ReadinessState, string> = {
  ready: "text-olive",
  blocked: "text-rose",
  pending: "text-text-3",
};

interface ReadinessPayload {
  probedAt: string | null;
  allReady: boolean;
  checks: ReadinessCheck[];
}

type LedgerStatus =
  | { kind: "pending" }
  | { kind: "error" }
  | { kind: "ready"; data: ReadinessPayload };

function formatProbedAt(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function isPayload(value: unknown): value is ReadinessPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ReadinessPayload).checks)
  );
}

export function ReadinessLedger() {
  const [status, setStatus] = useState<LedgerStatus>({ kind: "pending" });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/google-ads/readiness", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!isPayload(body)) throw new Error("malformed readiness payload");
        if (alive) setStatus({ kind: "ready", data: body });
      })
      .catch(() => {
        if (alive) setStatus({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (status.kind === "pending") {
    return (
      <div
        data-testid="readiness-skeleton"
        className="glass-surface rounded-panel px-3 py-2 animate-pulse"
        aria-busy="true"
      >
        <div className="h-1.5 w-data rounded-bar bg-fill-neutral-dim" />
        <div className="mt-2 space-y-1.5">
          {READINESS_ROW_TITLES.map((title) => (
            <div key={title} className="h-2 rounded-bar bg-fill-neutral-dim" />
          ))}
        </div>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <section className="glass-surface rounded-panel px-3 py-2" aria-label="Engine readiness">
        <h2 className="font-mono text-micro uppercase tracking-authority text-text-3">
          <span className="text-text-mute">{"//"}</span> ENGINE READINESS
        </h2>
        <p className="mt-1 font-mono text-micro text-text-3">Readiness unavailable</p>
      </section>
    );
  }

  const { checks, probedAt } = status.data;

  return (
    <section className="glass-surface rounded-panel px-3 py-2" aria-label="Engine readiness">
      <header className="flex items-baseline justify-between gap-2 pb-1">
        <h2 className="font-mono text-micro uppercase tracking-authority text-text-3">
          <span className="text-text-mute">{"//"}</span> ENGINE READINESS
        </h2>
        <span className="font-mono text-micro uppercase tracking-wider text-text-3 tabular-nums">
          {`PROBED ${formatProbedAt(probedAt)}`}
        </span>
      </header>
      <ul className="divide-y divide-line">
        {checks.map((check, index) => (
          <motion.li
            key={check.key}
            data-state={check.state}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0.15 : 0.2,
              delay: reduceMotion ? 0 : index * 0.03,
              ease: EASE_SMOOTH,
            }}
            className="flex items-center gap-1.5 py-1.5"
          >
            <span aria-hidden="true" className={`h-1 w-1 shrink-0 rounded-full ${DOT_CLASS[check.state]}`} />
            <div className="min-w-0 flex-1">
              <div data-row-title className="font-mohave text-body-sm text-text">
                {TITLE_BY_KEY[check.key] ?? check.key}
              </div>
              <div data-row-reason className="font-mono text-micro text-text-2 tabular-nums">
                {check.reason || "—"}
              </div>
            </div>
            <span className={`font-mono text-micro uppercase tracking-wider ${LABEL_CLASS[check.state]}`}>
              {STATE_LABEL[check.state]}
            </span>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

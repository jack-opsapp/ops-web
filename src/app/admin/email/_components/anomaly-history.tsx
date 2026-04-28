"use client";

/**
 * Paginated audit log of detected anomalies. Each row expands to reveal
 * the full context JSON and the action_taken text written by the cron.
 */
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { AnomalyLogRow, AnomalyKind } from "@/lib/admin/types";

const KIND_LABEL: Record<AnomalyKind, string> = {
  bounce_spike: "BOUNCE SPIKE",
  spam_spike: "SPAM SPIKE",
  delivery_drop: "DELIVERY DROP",
  volume_drop: "VOLUME DROP",
};

const PAGE_SIZE = 25;

function isVisible(): boolean {
  return typeof document !== "undefined"
    ? document.visibilityState === "visible"
    : true;
}

export function AnomalyHistory() {
  const reduce = useReducedMotion();
  const [page, setPage] = React.useState(0);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["anomalies", page],
    queryFn: async (): Promise<{ rows: AnomalyLogRow[]; total: number }> => {
      const r = await fetch(
        `/api/admin/email/monitor/anomalies?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      );
      if (!r.ok) throw new Error("anomalies_failed");
      return (await r.json()) as { rows: AnomalyLogRow[]; total: number };
    },
    refetchInterval: () => (isVisible() ? 15000 : false),
    refetchIntervalInBackground: false,
  });

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  return (
    <div
      className="rounded-panel overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <p
        className="px-3 py-2 font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        // ANOMALY LOG [{q.data?.total ?? 0}]
      </p>
      {(q.data?.rows.length ?? 0) === 0 && !q.isLoading && (
        <p className="font-mono text-[11px] text-text-mute py-6 px-3">
          [no anomalies recorded]
        </p>
      )}
      {q.data?.rows.map((r) => {
        const isOpen = expanded.has(r.id);
        return (
          <div key={r.id} className="border-t border-white/[0.04]">
            <button
              type="button"
              onClick={() => toggle(r.id)}
              className="w-full grid grid-cols-[120px_140px_1fr_160px] gap-3 px-3 py-2 items-center text-left hover:bg-white/[0.03] transition-colors"
            >
              <span
                className="font-cakemono font-light text-[10px] tracking-[0.06em]"
                style={{
                  color: r.severity === "critical" ? "#93321A" : "#C4A868",
                }}
              >
                {r.severity === "critical" ? "CRITICAL" : "WARN"}
              </span>
              <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-text-2">
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>
              <span
                className="font-mono text-[11px] text-text"
                style={{ fontFeatureSettings: '"tnum" 1' }}
              >
                {Number(r.metric_value).toFixed(2)} / {r.threshold} ({r.window_minutes}m)
              </span>
              <span className="font-mono text-[11px] text-text-3 text-right">
                {new Date(r.detected_at).toLocaleString()}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={
                    reduce
                      ? { opacity: 1, height: "auto" }
                      : { opacity: 1, height: "auto" }
                  }
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
                  }
                  className="px-3 pb-3 overflow-hidden"
                >
                  {r.action_taken && (
                    <p className="font-mono text-[11px] text-[#9DB582] mb-2">
                      [action] {r.action_taken}
                    </p>
                  )}
                  <pre
                    className="font-mono text-[10px] text-text-2 whitespace-pre-wrap p-2 rounded-chip"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {JSON.stringify(r.context, null, 2)}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      {q.data && q.data.total > PAGE_SIZE && (
        <div
          className="flex items-center justify-between p-2 font-mono text-[11px] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1' }}
        >
          <span>
            [page {page + 1} of {Math.ceil(q.data.total / PAGE_SIZE)}]
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(p - 1, 0))}
              className="px-2 py-0.5 border border-white/10 rounded-chip disabled:opacity-30"
            >
              PREV
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= q.data.total}
              onClick={() => setPage((p) => p + 1)}
              className="px-2 py-0.5 border border-white/10 rounded-chip disabled:opacity-30"
            >
              NEXT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

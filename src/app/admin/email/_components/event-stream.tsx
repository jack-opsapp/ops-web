"use client";

/**
 * Live tail of the most recent email events. Refreshes every 5 seconds while
 * the tab is visible — pauses on hidden tab to avoid wasted polling.
 */
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { eventStreamRowVariants } from "@/lib/utils/motion";
import type { EventStreamRow } from "@/lib/admin/types";

interface Props {
  eventTypes?: string[];
}

const EVENT_COLORS: Record<string, string> = {
  delivered: "#9DB582",
  processed: "#B5B5B5",
  open: "#C4A868",
  click: "#6F94B0",
  bounce: "#B58289",
  spamreport: "#93321A",
  dropped: "#C4A868",
  deferred: "#8A8A8A",
  unsubscribe: "#B58289",
  group_unsubscribe: "#B58289",
};

function isVisible(): boolean {
  return typeof document !== "undefined"
    ? document.visibilityState === "visible"
    : true;
}

export function EventStream({ eventTypes }: Props) {
  const reduce = useReducedMotion();
  const stream = useQuery({
    queryKey: ["eventStream", eventTypes?.join(",") ?? ""],
    queryFn: async (): Promise<EventStreamRow[]> => {
      const sp = new URLSearchParams({ limit: "50" });
      if (eventTypes && eventTypes.length > 0) {
        sp.set("events", eventTypes.join(","));
      }
      const r = await fetch(`/api/admin/email/monitor/stream?${sp.toString()}`);
      if (!r.ok) throw new Error("stream_failed");
      const json = (await r.json()) as { events?: EventStreamRow[] };
      return json.events ?? [];
    },
    refetchInterval: () => (isVisible() ? 5000 : false),
    refetchIntervalInBackground: false,
  });

  return (
    <div
      className="rounded-panel overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <p
        className="px-3 py-2 font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        // EVENT STREAM [last 50]
      </p>
      <div className="max-h-[420px] overflow-y-auto scrollbar-hide">
        <AnimatePresence initial={false}>
          {stream.data?.map((e) => (
            <motion.div
              key={e.id}
              variants={reduce ? undefined : eventStreamRowVariants}
              initial={reduce ? false : "hidden"}
              animate={reduce ? undefined : "visible"}
              exit={reduce ? undefined : "exit"}
              className="grid grid-cols-[80px_1fr_120px] gap-3 px-3 py-1.5 border-t border-white/[0.04] items-center font-mono text-[11px]"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              <span
                className="font-cakemono font-light text-[10px] tracking-[0.06em]"
                style={{ color: EVENT_COLORS[e.event] ?? "#B5B5B5" }}
              >
                {e.event.toUpperCase()}
              </span>
              <span className="text-text truncate">{e.email}</span>
              <span className="text-text-3 text-right">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {(stream.data?.length ?? 0) === 0 && !stream.isLoading && (
          <p className="font-mono text-[11px] text-text-mute py-6">
            [no events in window]
          </p>
        )}
        {stream.isLoading && (stream.data?.length ?? 0) === 0 && (
          <p className="font-mono text-[11px] text-text-mute py-6">
            [loading...]
          </p>
        )}
      </div>
    </div>
  );
}

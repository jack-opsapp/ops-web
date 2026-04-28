"use client";

/**
 * Horizontal-bar list of the top 10 bounce-receiver domains in the window.
 * Refreshes every 10 seconds while visible.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { TopBounceDomain } from "@/lib/admin/types";

interface Props {
  minutesBack: number;
}

function isVisible(): boolean {
  return typeof document !== "undefined"
    ? document.visibilityState === "visible"
    : true;
}

export function TopBounceDomains({ minutesBack }: Props) {
  const reduce = useReducedMotion();
  const q = useQuery({
    queryKey: ["topBounceDomains", minutesBack],
    queryFn: async (): Promise<TopBounceDomain[]> => {
      const r = await fetch(
        `/api/admin/email/monitor/domains?minutesBack=${minutesBack}&limit=10`
      );
      if (!r.ok) throw new Error("domains_failed");
      const json = (await r.json()) as { domains?: TopBounceDomain[] };
      return json.domains ?? [];
    },
    refetchInterval: () => (isVisible() ? 10000 : false),
    refetchIntervalInBackground: false,
  });

  const max = Math.max(...(q.data?.map((d) => d.bounce_count) ?? [1]), 1);

  return (
    <div
      className="rounded-panel p-3"
      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3 block mb-3">
        // TOP BOUNCE DOMAINS
      </span>
      <div className="space-y-2">
        {q.data?.map((d, i) => (
          <div
            key={d.domain}
            className="grid grid-cols-[140px_1fr_60px] gap-2 items-center"
          >
            <span className="font-mono text-[11px] text-text truncate">
              {d.domain}
            </span>
            <div
              className="h-[4px] rounded-bar overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <motion.div
                className="h-full"
                style={{ background: "#B58289" }}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(d.bounce_count / max) * 100}%` }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }
                }
              />
            </div>
            <span
              className="font-mono text-[11px] text-text-2 text-right"
              style={{ fontFeatureSettings: '"tnum" 1' }}
            >
              {d.bounce_count}
            </span>
          </div>
        ))}
        {(q.data?.length ?? 0) === 0 && !q.isLoading && (
          <p className="font-mono text-[11px] text-text-mute py-2">
            [no bounces in window]
          </p>
        )}
      </div>
    </div>
  );
}

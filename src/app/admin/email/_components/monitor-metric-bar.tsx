"use client";

/**
 * 6 metric cards (sent, delivered, bounced, spam, opened, clicked) — each
 * displays the period total in JetBrains Mono and a sparkline drawn from
 * the by_minute buckets returned by email_event_metrics.
 */
import { motion, useReducedMotion } from "framer-motion";
import { sparklineVariants } from "@/lib/utils/motion";
import type { EventMetrics, EventMetricsBucket } from "@/lib/admin/types";

interface Props {
  metrics: EventMetrics | null;
}

type BucketKey = "sent" | "delivered" | "bounced" | "spam" | "open" | "click";

interface CardSpec {
  key: BucketKey;
  label: string;
  total: number;
  color: string;
}

export function MonitorMetricBar({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-panel p-3 h-[64px]"
            style={{
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)",
            }}
          />
        ))}
      </div>
    );
  }

  const cards: CardSpec[] = [
    { key: "sent", label: "SENT", total: metrics.total_sent, color: "#B5B5B5" },
    { key: "delivered", label: "DELIVERED", total: metrics.total_delivered, color: "#9DB582" },
    { key: "bounced", label: "BOUNCED", total: metrics.total_bounced, color: "#B58289" },
    { key: "spam", label: "SPAM", total: metrics.total_spam, color: "#93321A" },
    { key: "open", label: "OPENED", total: metrics.total_open, color: "#C4A868" },
    { key: "click", label: "CLICKED", total: metrics.total_click, color: "#6F94B0" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((c) => (
        <Card key={c.key} spec={c} buckets={metrics.by_minute} />
      ))}
    </div>
  );
}

function Card({ spec, buckets }: { spec: CardSpec; buckets: EventMetricsBucket[] }) {
  const reduce = useReducedMotion();
  const points = buckets.map((b) => Number(b[spec.key]) || 0);
  const max = Math.max(...points, 1);
  const path =
    points.length > 1
      ? "M " +
        points
          .map((v, i) => `${(i / (points.length - 1)) * 100} ${30 - (v / max) * 28}`)
          .join(" L ")
      : "M 0 28 L 100 28";

  return (
    <div
      className="rounded-panel p-3"
      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3">
          {spec.label}
        </span>
        <span
          className="font-mono text-[18px]"
          style={{ color: spec.color, fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {spec.total.toLocaleString()}
        </span>
      </div>
      <svg viewBox="0 0 100 30" className="w-full h-8" preserveAspectRatio="none">
        <motion.path
          d={path}
          fill="none"
          stroke={spec.color}
          strokeWidth="1.2"
          strokeLinecap="round"
          variants={reduce ? undefined : sparklineVariants}
          initial={reduce ? false : "hidden"}
          animate={reduce ? undefined : "visible"}
        />
      </svg>
    </div>
  );
}

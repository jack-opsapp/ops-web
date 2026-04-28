"use client";

/**
 * Event Monitor — top-level orchestration of the live deliverability tab.
 *
 * Layout (desktop):
 *   header :: title + filter chips
 *   row 1  :: bounce gauge | 6 metric cards (sent/delivered/bounced/spam/open/click)
 *   row 2  :: live event stream | top-10 bounce domains
 *   row 3  :: full anomaly history
 *
 * Polling cadence: 5s for metrics + stream while tab visible, 10s for
 * top-bounce-domains, 15s for anomaly history. All paused on hidden.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BounceGauge } from "./bounce-gauge";
import { EventStream } from "./event-stream";
import { MonitorMetricBar } from "./monitor-metric-bar";
import { TopBounceDomains } from "./top-bounce-domains";
import { AnomalyHistory } from "./anomaly-history";
import { MonitorFilters } from "./monitor-filters";
import type { EventMetrics } from "@/lib/admin/types";

function isVisible(): boolean {
  return typeof document !== "undefined"
    ? document.visibilityState === "visible"
    : true;
}

export function EventMonitorTab() {
  const [windowMinutes, setWindowMinutes] = React.useState(60);
  const [bucket, setBucket] = React.useState<"1m" | "5m" | "15m">("5m");
  const [eventTypes, setEventTypes] = React.useState<string[]>([]);

  const metrics = useQuery({
    queryKey: ["eventMetrics", windowMinutes, bucket],
    queryFn: async (): Promise<EventMetrics | null> => {
      const r = await fetch(
        `/api/admin/email/monitor/metrics?minutesBack=${windowMinutes}&bucket=${bucket}`
      );
      if (!r.ok) throw new Error("metrics_failed");
      const json = (await r.json()) as { metrics?: EventMetrics | null };
      return json.metrics ?? null;
    },
    refetchInterval: () => (isVisible() ? 5000 : false),
    refetchIntervalInBackground: false,
  });

  // Always keep a 15-min snapshot for the gauge — independent of UI window.
  const gauge = useQuery({
    queryKey: ["gaugeMetrics"],
    queryFn: async (): Promise<EventMetrics | null> => {
      const r = await fetch(
        "/api/admin/email/monitor/metrics?minutesBack=15"
      );
      if (!r.ok) throw new Error("gauge_failed");
      const json = (await r.json()) as { metrics?: EventMetrics | null };
      return json.metrics ?? null;
    },
    refetchInterval: () => (isVisible() ? 5000 : false),
    refetchIntervalInBackground: false,
  });

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-text">
            // EVENT MONITOR
          </h3>
          <p className="font-mono text-[11px] text-text-3">
            [live deliverability — refreshes every 5s while visible]
          </p>
        </div>
        <MonitorFilters
          windowMinutes={windowMinutes}
          setWindowMinutes={setWindowMinutes}
          bucket={bucket}
          setBucket={setBucket}
          eventTypes={eventTypes}
          setEventTypes={setEventTypes}
        />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <BounceGauge bouncePct={Number(gauge.data?.bounce_pct ?? 0)} />
        <MonitorMetricBar metrics={metrics.data ?? null} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EventStream eventTypes={eventTypes.length > 0 ? eventTypes : undefined} />
        <TopBounceDomains minutesBack={windowMinutes} />
      </div>

      <AnomalyHistory />
    </section>
  );
}

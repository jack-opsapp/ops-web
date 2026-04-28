"use client";

/**
 * Filter chips for the Event Monitor — window length, bucket size, event
 * type filter for the live stream.
 */
import * as React from "react";

interface Props {
  windowMinutes: number;
  setWindowMinutes: (n: number) => void;
  bucket: "1m" | "5m" | "15m";
  setBucket: (b: "1m" | "5m" | "15m") => void;
  eventTypes: string[];
  setEventTypes: (t: string[]) => void;
}

const WINDOWS: Array<{ id: number; label: string }> = [
  { id: 15, label: "15M" },
  { id: 60, label: "1H" },
  { id: 360, label: "6H" },
  { id: 1440, label: "24H" },
];

const BUCKETS: ReadonlyArray<{ id: "1m" | "5m" | "15m"; label: string }> = [
  { id: "1m", label: "1M" },
  { id: "5m", label: "5M" },
  { id: "15m", label: "15M" },
];

const EVENTS = ["processed", "delivered", "bounce", "spamreport", "open", "click"];

export function MonitorFilters({
  windowMinutes,
  setWindowMinutes,
  bucket,
  setBucket,
  eventTypes,
  setEventTypes,
}: Props) {
  function toggleEvent(e: string) {
    if (eventTypes.includes(e)) {
      setEventTypes(eventTypes.filter((x) => x !== e));
    } else {
      setEventTypes([...eventTypes, e]);
    }
  }

  return (
    <div className="flex gap-3 flex-wrap items-end">
      <ChipGroup
        label="WINDOW"
        options={WINDOWS.map((w) => ({ id: String(w.id), label: w.label }))}
        active={String(windowMinutes)}
        onChange={(v) => setWindowMinutes(Number(v))}
      />
      <ChipGroup
        label="BUCKET"
        options={BUCKETS.map((b) => ({ id: b.id, label: b.label }))}
        active={bucket}
        onChange={(v) => setBucket(v as "1m" | "5m" | "15m")}
      />
      <div>
        <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3 block mb-1">
          EVENTS
        </span>
        <div className="flex gap-1 flex-wrap">
          {EVENTS.map((e) => {
            const on = eventTypes.includes(e);
            return (
              <button
                key={e}
                type="button"
                onClick={() => toggleEvent(e)}
                className="font-mono text-[10px] px-2 py-0.5 rounded-chip"
                style={{
                  border: `1px solid ${on ? "#6F94B0" : "rgba(255,255,255,0.12)"}`,
                  color: on ? "#6F94B0" : "#B5B5B5",
                }}
              >
                {e}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  active,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3 block mb-1">
        {label}
      </span>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="font-cakemono font-light text-[10px] tracking-[0.06em] px-2 py-0.5 rounded-chip"
            style={{
              border: `1px solid ${active === o.id ? "#6F94B0" : "rgba(255,255,255,0.12)"}`,
              color: active === o.id ? "#6F94B0" : "#B5B5B5",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

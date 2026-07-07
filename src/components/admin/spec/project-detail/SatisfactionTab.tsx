"use client";

import { useState } from "react";
import type {
  SpecSatisfactionMilestone,
  SpecSatisfactionTab,
} from "@/lib/admin/spec-types";
import { formatDate } from "./format";

interface SatisfactionTabProps {
  data: SpecSatisfactionTab;
}

type MilestoneFilter = "all" | SpecSatisfactionMilestone;

const MILESTONE_LABEL: Record<SpecSatisfactionMilestone, string> = {
  midpoint: "MIDPOINT",
  delivery: "DELIVERY",
};

/**
 * Static 1-5 color scale. Earth-tone semantic mapping per OPS design system:
 *   1 — brick   (failing scope)
 *   2 — rose    (customer disputes scope)
 *   3 — tan     (scope met, minor preferences)
 *   4 — olive   (done, move on)
 *   5 — olive+  (perfect)
 */
const RATING_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "rgb(var(--status-error-rgb) / 0.35)", text: "var(--text)" },     // brick · failing
  2: { bg: "rgb(var(--status-rose-rgb) / 0.30)", text: "var(--text)" },      // rose
  3: { bg: "rgb(var(--status-warning-rgb) / 0.30)", text: "var(--text)" },   // tan
  4: { bg: "rgb(var(--status-success-rgb) / 0.30)", text: "var(--text)" },   // olive
  5: { bg: "rgb(var(--status-success-rgb) / 0.55)", text: "var(--text)" },   // olive +
};

export function SatisfactionTab({ data }: SatisfactionTabProps) {
  const [filter, setFilter] = useState<MilestoneFilter>("all");

  const filteredRows = data.rows.filter((r) => filter === "all" || r.milestone === filter);
  const midpointCount = data.rows.filter((r) => r.milestone === "midpoint").length;
  const deliveryCount = data.rows.filter((r) => r.milestone === "delivery").length;

  const avg = filteredRows.length > 0
    ? filteredRows.reduce((acc, r) => acc + r.rating, 0) / filteredRows.length
    : null;

  return (
    <div className="space-y-6">
      <section
        aria-label="Satisfaction summary"
        className="glass-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-text">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            SATISFACTION RATINGS
          </h2>
          <FilterChips filter={filter} onChange={setFilter} midpointCount={midpointCount} deliveryCount={deliveryCount} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Kpi label="MIDPOINT" value={midpointCount.toString()} />
          <Kpi label="DELIVERY" value={deliveryCount.toString()} />
          <Kpi label="FEATURES" value={data.heatMap.length.toString()} />
          <Kpi label="AVG" value={avg != null ? avg.toFixed(1) : "—"} tone={ratingTone(avg)} />
        </div>
      </section>

      {data.heatMap.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section
            aria-label="Feature × rating heat map"
            className="glass-surface p-5"
          >
            <h3 className="mb-4 font-cakemono text-[12px] font-light uppercase leading-none text-text">
              <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
                {"//"}
              </span>
              FEATURE HEAT MAP
            </h3>
            <SatisfactionHeatMap heatMap={data.heatMap} />
            <RatingLegend />
          </section>

          <section
            aria-label="Detailed ratings"
            className="glass-surface p-5"
          >
            <h3 className="mb-4 font-cakemono text-[12px] font-light uppercase leading-none text-text">
              <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
                {"//"}
              </span>
              DETAILED RATINGS
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] text-left">
                    <Th>MILESTONE</Th>
                    <Th>FEATURE</Th>
                    <Th align="right">RATING</Th>
                    <Th>NOTES</Th>
                    <Th>SUBMITTED</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-white/[0.04] last:border-b-0">
                      <Td>
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-2">
                          {MILESTONE_LABEL[row.milestone]}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[13px] text-text">{row.featureName}</span>
                      </Td>
                      <Td align="right">
                        <RatingChip rating={row.rating} />
                      </Td>
                      <Td>
                        {row.notes ? (
                          <span className="block max-w-[320px] text-[12px] text-text-2">{row.notes}</span>
                        ) : (
                          <span className="font-mono text-[10px] text-text-mute">—</span>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono text-[11px] tabular-nums text-text-2">
                          {formatDate(row.submittedAt)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        <span className="text-text-mute">[</span>
        PHASE 1 · READ-ONLY · CUSTOMER FILES VIA SURVEY EMAILS · FULL SURVEY UI SHIPS IN PHASE 2
        <span className="text-text-mute">]</span>
      </p>
    </div>
  );
}

/**
 * Heat-map render. SVG grid: feature × milestone (midpoint + delivery).
 * - Static color scale (1-5 → earth tone gradient).
 * - Empty cells render as bordered placeholder.
 * - Stagger entry animation per data-viz spec (cubic-bezier 0.16, 1, 0.3, 1).
 * - Reduced-motion honored — instant render when set.
 */
function SatisfactionHeatMap({
  heatMap,
}: {
  heatMap: SpecSatisfactionTab["heatMap"];
}) {
  const milestones: SpecSatisfactionMilestone[] = ["midpoint", "delivery"];

  return (
    <div className="overflow-x-auto" role="img" aria-label="Feature ratings heat map: features rows × midpoint/delivery columns">
      <table className="w-full min-w-[480px] border-separate" style={{ borderSpacing: "4px" }}>
        <thead>
          <tr>
            <th className="text-left">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">FEATURE</span>
            </th>
            {milestones.map((m) => (
              <th key={m} className="px-1 text-center">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
                  {MILESTONE_LABEL[m]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatMap.map((cell, idx) => (
            <tr key={cell.featureName}>
              <td className="py-1 pr-3">
                <span className="block max-w-[280px] truncate text-[13px] text-text" title={cell.featureName}>
                  {cell.featureName}
                </span>
              </td>
              {milestones.map((m) => {
                const rating = m === "midpoint" ? cell.midpoint : cell.delivery;
                return (
                  <td key={m} className="px-1">
                    <HeatCell rating={rating} delayMs={idx * 30} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Hidden screen-reader table — same data, accessible to AT. */}
      <table className="sr-only">
        <caption>Heat map data: feature rows with midpoint and delivery ratings</caption>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Midpoint rating</th>
            <th>Delivery rating</th>
          </tr>
        </thead>
        <tbody>
          {heatMap.map((cell) => (
            <tr key={cell.featureName}>
              <td>{cell.featureName}</td>
              <td>{cell.midpoint ?? "not submitted"}</td>
              <td>{cell.delivery ?? "not submitted"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatCell({ rating, delayMs }: { rating: number | null; delayMs: number }) {
  if (rating == null) {
    return (
      <div
        className="flex h-8 min-w-[64px] items-center justify-center rounded-chip border border-dashed border-white/[0.08] font-mono text-[10px] text-text-mute"
        title="Not submitted"
        aria-label="Not submitted"
      >
        —
      </div>
    );
  }
  const palette = RATING_COLORS[rating] ?? RATING_COLORS[3];
  return (
    <div
      className="flex h-8 min-w-[64px] items-center justify-center rounded-chip font-mono text-[12px] tabular-nums opacity-0"
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
        animation: `spec-heat-reveal 300ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms forwards`,
      }}
      title={`Rating: ${rating}/5`}
      aria-label={`Rating ${rating} out of 5`}
    >
      {rating}
      <span className="ml-0.5 text-[9px] text-text-2">/5</span>
      <style>{`
        @keyframes spec-heat-reveal {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="spec-heat-reveal"] {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function RatingChip({ rating }: { rating: number }) {
  const palette = RATING_COLORS[rating] ?? RATING_COLORS[3];
  return (
    <span
      className="inline-flex items-center justify-center rounded-chip px-2 py-0.5 font-mono text-[11px] tabular-nums"
      style={{ backgroundColor: palette.bg, color: palette.text }}
    >
      {rating}/5
    </span>
  );
}

function RatingLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">SCALE</span>
      {[1, 2, 3, 4, 5].map((n) => {
        const p = RATING_COLORS[n];
        return (
          <span
            key={n}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-3"
          >
            <span
              className="inline-block h-3 w-3 rounded-bar"
              style={{ backgroundColor: p.bg }}
              aria-hidden="true"
            />
            {n} {ratingMeaning(n)}
          </span>
        );
      })}
    </div>
  );
}

function ratingMeaning(n: number): string {
  switch (n) {
    case 5: return "PERFECT";
    case 4: return "DONE";
    case 3: return "PREFERENCES";
    case 2: return "DISPUTE";
    case 1: return "FAIL";
    default: return "";
  }
}

function ratingTone(avg: number | null): string {
  if (avg == null) return "text-text";
  if (avg >= 4) return "text-olive";
  if (avg >= 3) return "text-tan";
  if (avg >= 2) return "text-rose";
  return "text-brick";
}

function FilterChips({
  filter,
  onChange,
  midpointCount,
  deliveryCount,
}: {
  filter: MilestoneFilter;
  onChange: (v: MilestoneFilter) => void;
  midpointCount: number;
  deliveryCount: number;
}) {
  const options: { value: MilestoneFilter; label: string; count: number | null }[] = [
    { value: "all", label: "ALL", count: midpointCount + deliveryCount },
    { value: "midpoint", label: "MIDPOINT", count: midpointCount },
    { value: "delivery", label: "DELIVERY", count: deliveryCount },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Filter by milestone">
      {options.map((opt) => {
        const active = filter === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-chip border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 ease-smooth ${
              active
                ? "border-text text-text"
                : "border-white/[0.10] text-text-3 hover:text-text"
            }`}
          >
            {opt.label}
            {opt.count != null && (
              <span className="ml-1.5 tabular-nums text-text-mute">({opt.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-panel border border-white/[0.08] bg-fill-neutral-dim p-8 text-center backdrop-blur-[28px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        — no ratings yet
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        midpoint + delivery surveys auto-fire on milestone acceptance.
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <td className={`px-3 py-3 align-middle ${align === "right" ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">{label}</p>
      <p className={`mt-1 font-mono text-[16px] tabular-nums leading-none ${tone ?? "text-text"}`}>
        {value}
      </p>
    </div>
  );
}

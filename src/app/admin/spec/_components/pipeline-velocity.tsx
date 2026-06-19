import Link from "next/link";
import type {
  CycleTimeRow,
  PipelineVelocity as PipelineVelocityType,
  SlowestProject,
  VelocityRow,
} from "@/lib/admin/spec-types";
import { formatStatusLabel, formatTier } from "./format";

interface PipelineVelocityProps {
  data: PipelineVelocityType;
}

export function PipelineVelocity({ data }: PipelineVelocityProps) {
  return (
    <section
      aria-label="Pipeline velocity"
      className="px-8 py-6"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          PIPELINE VELOCITY
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>AVG DAYS · CURRENT SNAPSHOT
          <span className="text-text-mute">]</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PerStatus rows={data.perStatus} />
        <Slowest rows={data.slowest} />
        <CycleTime rows={data.cycleTime} />
      </div>
    </section>
  );
}

function PerStatus({ rows }: { rows: VelocityRow[] }) {
  const peak = Math.max(1, ...rows.map((r) => r.avgDaysCurrent));
  return (
    <div className="glass-surface p-5">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        AVG DAYS PER STATUS
      </h3>
      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const widthPct = row.avgDaysCurrent === 0 ? 0 : Math.round((row.avgDaysCurrent / peak) * 100);
          return (
            <li key={row.status} className="font-mono text-[11px] uppercase tracking-[0.12em]">
              <div className="flex items-baseline justify-between">
                <span className="text-text">{formatStatusLabel(row.status)}</span>
                <span className="tabular-nums text-tan">
                  {row.avgDaysCurrent}D
                  <span className="ml-2 text-text-mute">
                    <span className="text-text-mute">[</span>n={row.sampleSize}
                    <span className="text-text-mute">]</span>
                  </span>
                </span>
              </div>
              <div className="mt-1 h-[2px] w-full overflow-hidden rounded-[2px] bg-white/[0.06]">
                <div
                  aria-hidden="true"
                  style={{ width: `${widthPct}%`, backgroundColor: "rgba(255,255,255,0.14)" }}
                  className="h-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Slowest({ rows }: { rows: SlowestProject[] }) {
  return (
    <div className="glass-surface p-5">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        SLOWEST PROJECTS
      </h3>
      {rows.length === 0 ? (
        <p className="mt-4 font-mono text-[12px] text-text-mute">— nothing today</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/admin/spec/${row.id}`}
                className="group flex items-center justify-between gap-3 text-[12px] text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
              >
                <span className="truncate">{row.customerLabel}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
                  {formatTier(row.tier)} · {formatStatusLabel(row.status)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-tan">
                  {row.daysInStatus}D
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CycleTime({ rows }: { rows: CycleTimeRow[] }) {
  return (
    <div className="glass-surface p-5">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        CYCLE TIME · DEPOSIT → WALKTHROUGH
      </h3>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li
            key={row.tier}
            className="flex items-baseline justify-between font-mono text-[12px] uppercase tracking-[0.12em]"
          >
            <span className="text-text">{formatTier(row.tier)}</span>
            <span className="flex items-baseline gap-3">
              <span className="tabular-nums text-olive">
                {row.avgDays == null ? "—" : `${row.avgDays}D`}
              </span>
              <span className="text-text-mute">
                <span className="text-text-mute">[</span>n={row.sampleSize}
                <span className="text-text-mute">]</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

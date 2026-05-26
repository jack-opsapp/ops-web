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
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          PIPELINE VELOCITY
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>AVG DAYS · CURRENT SNAPSHOT
          <span className="text-[#3A3A3A]">]</span>
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
    <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        AVG DAYS PER STATUS
      </h3>
      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const widthPct = row.avgDaysCurrent === 0 ? 0 : Math.round((row.avgDaysCurrent / peak) * 100);
          return (
            <li key={row.status} className="font-mono text-[11px] uppercase tracking-[0.12em]">
              <div className="flex items-baseline justify-between">
                <span className="text-[#EDEDED]">{formatStatusLabel(row.status)}</span>
                <span className="tabular-nums text-[#C4A868]">
                  {row.avgDaysCurrent}D
                  <span className="ml-2 text-[#6A6A6A]">
                    <span className="text-[#3A3A3A]">[</span>n={row.sampleSize}
                    <span className="text-[#3A3A3A]">]</span>
                  </span>
                </span>
              </div>
              <div className="mt-1 h-[2px] w-full overflow-hidden rounded-[2px] bg-white/[0.06]">
                <div
                  aria-hidden="true"
                  style={{ width: `${widthPct}%`, backgroundColor: "#6F94B0" }}
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
    <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        SLOWEST PROJECTS
      </h3>
      {rows.length === 0 ? (
        <p className="mt-4 font-mono text-[12px] text-[#6A6A6A]">— nothing today</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/admin/spec/${row.id}`}
                className="group flex items-center justify-between gap-3 text-[12px] text-[#EDEDED] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#6F94B0]"
              >
                <span className="truncate">{row.customerLabel}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8A8A8A]">
                  {formatTier(row.tier)} · {formatStatusLabel(row.status)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#C4A868]">
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
    <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        CYCLE TIME · DEPOSIT → WALKTHROUGH
      </h3>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li
            key={row.tier}
            className="flex items-baseline justify-between font-mono text-[12px] uppercase tracking-[0.12em]"
          >
            <span className="text-[#EDEDED]">{formatTier(row.tier)}</span>
            <span className="flex items-baseline gap-3">
              <span className="tabular-nums text-[#9DB582]">
                {row.avgDays == null ? "—" : `${row.avgDays}D`}
              </span>
              <span className="text-[#6A6A6A]">
                <span className="text-[#3A3A3A]">[</span>n={row.sampleSize}
                <span className="text-[#3A3A3A]">]</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

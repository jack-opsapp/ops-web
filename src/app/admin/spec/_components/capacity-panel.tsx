import type { CapacityRow } from "@/lib/admin/spec-types";

interface CapacityPanelProps {
  rows: CapacityRow[];
}

export function CapacityPanel({ rows }: CapacityPanelProps) {
  return (
    <section
      aria-label="Capacity status"
      className="border-b border-white/[0.08] px-8 py-6"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          CAPACITY
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>READ ONLY · EDIT VIA /ADMIN/SPEC/CAPACITY
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {rows.map((row) => (
          <CapacityCard key={row.tier} row={row} />
        ))}
      </div>
    </section>
  );
}

function CapacityCard({ row }: { row: CapacityRow }) {
  const ratio = row.slotCeiling === 0 ? 0 : Math.min(1, row.active / row.slotCeiling);
  const ratioPct = Math.round(ratio * 100);
  const isFull = row.active >= row.slotCeiling;
  const isClosed = !row.isAcceptingBookings;

  const trackColor = isClosed
    ? "#93321A"
    : isFull
      ? "#C4A868"
      : "#9DB582";

  return (
    <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] backdrop-blur-[28px] p-5">
      <div className="flex items-baseline justify-between">
        <span className="font-cakemono text-[15px] font-light uppercase tracking-[0.04em] text-[#EDEDED]">
          {row.tier}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
          {isClosed ? "CLOSED" : isFull ? "FULL" : "OPEN"}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-[26px] tabular-nums text-[#EDEDED] leading-none">
          {row.active}
        </span>
        <span className="font-mono text-[14px] tabular-nums text-[#8A8A8A] leading-none">
          / {row.slotCeiling}
        </span>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-[#6A6A6A]">
          {ratioPct}% UTIL
        </span>
      </div>

      {/* Capacity strip */}
      <div className="mt-2 h-[2px] w-full overflow-hidden rounded-[2px] bg-white/[0.06]">
        <div
          aria-hidden="true"
          className="h-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${ratioPct}%`, backgroundColor: trackColor }}
        />
      </div>

      {/* Hold + queue breakdown */}
      <dl className="mt-4 grid grid-cols-3 gap-x-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[#8A8A8A]">
        <div>
          <dt className="text-[#6A6A6A]">QUEUE</dt>
          <dd className="mt-1 tabular-nums text-[#EDEDED]">{row.queued}</dd>
        </div>
        <div>
          <dt className="text-[#6A6A6A]">HOLD · CUST</dt>
          <dd className="mt-1 tabular-nums text-[#EDEDED]">{row.holdCustomerRequested}</dd>
        </div>
        <div>
          <dt className="text-[#6A6A6A]">HOLD · OPS</dt>
          <dd className="mt-1 tabular-nums text-[#EDEDED]">{row.holdOpsBlocked}</dd>
        </div>
      </dl>

      {/* Manual override + public note */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span className="text-[#6A6A6A]">NEXT START</span>
          <span className="text-[#EDEDED]">
            {row.manualNextStartOverride ? row.manualNextStartOverride : "[auto]"}
          </span>
        </div>
        {row.publicNote ? (
          <p className="text-[11px] text-[#B5B5B5]">
            <span className="font-mono text-[#6A6A6A]">NOTE</span> · {row.publicNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}

import type { RevenueSummary as RevenueSummaryType } from "@/lib/admin/spec-types";
import { formatCents, formatCentsCompact } from "./format";

interface RevenueSummaryProps {
  data: RevenueSummaryType;
}

export function RevenueSummary({ data }: RevenueSummaryProps) {
  const sparkPath = buildSparkPath(data.monthlyTrend.map((p) => p.cents));
  const peak = Math.max(0, ...data.monthlyTrend.map((p) => p.cents));

  return (
    <section
      aria-label="Revenue summary"
      className="border-b border-white/[0.08] px-8 py-6"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          REVENUE
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>FROM SPEC_PAYMENTS · NET REFUNDS
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr,1fr,1fr,1fr,2fr]">
        <Kpi label="PAID · THIS MONTH" value={formatCents(data.paidThisMonthCents)} tone="text-[#9DB582]" />
        <Kpi label="PAID · QTR" value={formatCents(data.paidThisQuarterCents)} tone="text-[#9DB582]" />
        <Kpi label="PAID · YTD" value={formatCents(data.paidYtdCents)} tone="text-[#9DB582]" />
        <Kpi label="PENDING" value={formatCents(data.pendingCents)} tone="text-[#C4A868]" />

        <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]">
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
              12-MONTH PAID TREND
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6A6A6A]">
              <span className="text-[#3A3A3A]">[</span>PEAK {formatCentsCompact(peak)}
              <span className="text-[#3A3A3A]">]</span>
            </span>
          </div>

          <svg
            viewBox="0 0 200 56"
            className="mt-3 w-full"
            role="img"
            aria-label="Monthly paid revenue trend, 12 months"
            preserveAspectRatio="none"
          >
            {sparkPath ? (
              <>
                <path d={sparkPath.fill} fill="rgba(157,181,130,0.10)" stroke="none" />
                <path
                  d={sparkPath.line}
                  fill="none"
                  stroke="#9DB582"
                  strokeWidth="1.25"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : (
              <line x1="0" y1="42" x2="200" y2="42" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            )}
          </svg>

          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-[#6A6A6A]">
            <span>{data.monthlyTrend[0]?.label.slice(5) ?? "—"}</span>
            <span>{data.monthlyTrend.at(-1)?.label.slice(5) ?? "—"}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em]">
            <div className="flex items-center justify-between">
              <span className="text-[#6A6A6A]">OVERDUE</span>
              <span className="tabular-nums text-[#B58289]">{formatCents(data.overdueCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#6A6A6A]">REFUNDED · ALL TIME</span>
              <span className="tabular-nums text-[#B58289]">{formatCents(data.refundedCents)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">{label}</p>
      <p className={`mt-2 font-mono text-[22px] tabular-nums leading-none ${tone}`}>{value}</p>
    </div>
  );
}

/**
 * Build smoothed sparkline paths. We render two paths layered:
 *  - `fill` — closed polygon for the soft area underneath
 *  - `line` — the trend stroke on top
 * Returns null when there's nothing to draw (all-zero series).
 */
function buildSparkPath(values: number[]): { line: string; fill: string } | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  if (max === 0) return null;

  const w = 200;
  const h = 56;
  const inset = 4;
  const usable = h - inset * 2;
  const step = w / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - inset - (v / max) * usable;
    return { x, y };
  });

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const fill = `${line} L${w.toFixed(1)},${h} L0,${h} Z`;
  return { line, fill };
}

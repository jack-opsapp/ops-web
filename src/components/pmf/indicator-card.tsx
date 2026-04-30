import { PmfCard } from "@/components/pmf/ui/card";
import { StatusDot } from "@/components/pmf/ui/status-dot";
import { Sparkline } from "@/components/pmf/ui/sparkline";
import type { IndicatorState } from "@/lib/pmf/types";
import { fmtInt, fmtPct } from "@/lib/pmf/formatters";

interface IndicatorCardProps {
  state: IndicatorState;
}

export function IndicatorCard({ state }: IndicatorCardProps) {
  const displayValue = state.unit === "percent" ? fmtPct(state.value) : fmtInt(state.value);
  const deltaSign = state.delta_wow > 0 ? "↑" : state.delta_wow < 0 ? "↓" : "—";
  const deltaClass =
    state.delta_wow > 0 ? "text-[color:var(--olive)]" :
    state.delta_wow < 0 ? "text-[color:var(--rose)]" :
                          "text-[color:var(--text-3)]";

  return (
    <PmfCard className="relative p-4">
      <div className="absolute top-3 right-3">
        <StatusDot status={state.status} size={5} />
      </div>
      <div className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)]">
        <span className="text-[color:var(--text-mute)] mr-1">{"//"}</span>
        {state.label}
      </div>
      <div className="mt-3 font-mono text-[20px] font-semibold tabular-nums text-[color:var(--text)]">
        {displayValue}
      </div>
      <div className={`mt-1 font-mono text-[11px] tabular-nums ${deltaClass}`}>
        {deltaSign} {state.unit === "percent" ? fmtPct(Math.abs(state.delta_wow)) : fmtInt(Math.abs(state.delta_wow))} WOW
      </div>
      <div className="mt-2">
        <Sparkline data={state.sparkline} width={120} height={20} />
      </div>
    </PmfCard>
  );
}

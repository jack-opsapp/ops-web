import { PmfCard } from "@/components/pmf/ui/card";
import { StatusDot } from "@/components/pmf/ui/status-dot";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import { HeroNumber } from "@/components/pmf/ui/hero-number";
import { ProgressDots } from "@/components/pmf/ui/progress-dots";
import { fmtUsd } from "@/lib/pmf/formatters";
import type { MarkerState } from "@/lib/pmf/types";

interface MarkerCardProps {
  state: MarkerState;
  asCurrency?: boolean;
}

export function MarkerCard({ state, asCurrency }: MarkerCardProps) {
  const pct =
    state.target > 0
      ? Math.min(100, Math.round((state.value / state.target) * 100))
      : 0;

  const dotCount = Math.min(state.target, 8);
  const dotValue = Math.min(state.value, dotCount);
  const detailLine = state.detail;

  return (
    <PmfCard className="relative h-[220px] flex flex-col justify-between">
      <div className="absolute top-4 right-4">
        <StatusDot status={state.status} size={8} label={`marker ${state.status}`} />
      </div>

      <SlashHeader variant="panel-title">{state.label}</SlashHeader>

      <div className="flex-1 flex items-end">
        {asCurrency ? (
          <div
            className="font-mohave font-light text-[64px] leading-none tabular-nums text-[color:var(--text)]"
            aria-label={`${state.value} of ${state.target}`}
          >
            {fmtUsd(state.value * 100)}
            <span className="text-[color:var(--text-3)] text-[32px]">
              {" "}/ {fmtUsd(state.target * 100)}
            </span>
          </div>
        ) : (
          <HeroNumber value={state.value} total={state.target} />
        )}
      </div>

      <div className="flex items-center justify-between">
        <ProgressDots value={dotValue} target={dotCount} status={state.status} />
        <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-[color:var(--text-3)]">
          <span className="text-[color:var(--text-3)]">[</span>
          {state.status.toUpperCase()} · {pct}% OF TARGET
          <span className="text-[color:var(--text-3)]">]</span>
        </span>
      </div>

      {detailLine && (
        <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-[color:var(--text-mute)] mt-1">
          {detailLine}
        </div>
      )}
    </PmfCard>
  );
}

// STUB — replaced by Task 18 (IndicatorCard component).
// Renders a placeholder so the dashboard page compiles and visually
// flags the gap until the real component lands.
import { PmfCard } from "@/components/pmf/ui/card";
import type { IndicatorState } from "@/lib/pmf/types";

interface IndicatorCardProps {
  state: IndicatorState;
}

export function IndicatorCard({ state }: IndicatorCardProps) {
  return (
    <PmfCard className="p-4 h-[140px] flex items-center justify-center">
      <div className="font-mono text-[11px] text-[color:var(--text-mute)] text-center">
        // STUB · INDICATOR<br />
        {state.label}<br />
        [TASK 18 PENDING]
      </div>
    </PmfCard>
  );
}

import { PROGRESS_COMPLETE_COLOR } from "../../project-progress-color";

export function CellProgress({ value }: { value: number | null }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, Math.round(value * 100)));
  const completed = pct === 100;
  // Olive (healthy/complete), not the rose of the Completed status — a full
  // bar must read positive (cohesion audit §6).
  const completedColor = PROGRESS_COMPLETE_COLOR;
  return (
    <div className="flex w-full min-w-0 items-center gap-[8px]">
      <div className="h-[6px] min-w-[44px] flex-1 overflow-hidden rounded-bar bg-fill-neutral-dim">
        <div
          className="h-full rounded-bar bg-fill-neutral"
          style={{
            width: `${pct ?? 0}%`,
            backgroundColor: completed ? completedColor : undefined,
          }}
        />
      </div>
      <span
        className="w-[38px] text-right font-mono text-micro tabular-nums text-text-3"
        style={{ color: completed ? completedColor : undefined }}
      >
        {pct == null ? "—" : `${pct}%`}
      </span>
    </div>
  );
}

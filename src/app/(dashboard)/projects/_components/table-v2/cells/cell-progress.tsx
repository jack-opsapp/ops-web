export function CellProgress({ value }: { value: number | null }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-bar bg-fill-neutral-dim">
        <div className="h-full rounded-bar bg-fill-neutral" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-micro tabular-nums text-text-3">{pct == null ? "—" : `${pct}%`}</span>
    </div>
  );
}

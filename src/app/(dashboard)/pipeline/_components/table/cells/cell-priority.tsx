/**
 * Priority cell. Renders the priority slug ("low" | "medium" | "high") as a
 * small neutral chip — uppercase mono on a dim fill, no accent and no earth-tone
 * semantics. Empty priority collapses to the "—" sentinel so blank rows read the
 * same as every other empty cell. Priority is a raw slug from the model; we
 * uppercase it for the tactical label voice rather than mapping to bespoke copy.
 */
export function CellPriority({ value }: { value: string | null }) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return <span className="font-mono tabular-nums text-text-3">—</span>;
  }
  return (
    <span className="inline-flex items-center rounded-chip bg-fill-neutral-dim px-[6px] py-[2px] font-mono text-micro uppercase tracking-wider text-text-2">
      {trimmed}
    </span>
  );
}

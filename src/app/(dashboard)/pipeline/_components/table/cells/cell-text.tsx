import { cn } from "@/lib/utils/cn";

/**
 * Read-only text cell for the pipeline table. Mirrors the projects table's
 * `CellText`: truncates to a single line, renders the "—" sentinel for empty
 * values, and defaults to Mohave/text. Numeric or mono treatments pass their
 * own `className`.
 */
export function CellText({
  value,
  title,
  className,
}: {
  value: string | null;
  title?: string;
  className?: string;
}) {
  const display = value?.trim() || "—";
  return (
    <span title={title ?? display} className={cn("block min-w-0 truncate font-mohave text-text", className)}>
      {display}
    </span>
  );
}

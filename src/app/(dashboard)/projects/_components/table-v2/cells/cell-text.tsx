import { cn } from "@/lib/utils/cn";

export function CellText({ value, title, className }: { value: string | null; title?: string; className?: string }) {
  const display = value?.trim() || "—";
  return (
    <span title={title ?? display} className={cn("block min-w-0 truncate font-mohave text-text", className)}>
      {display}
    </span>
  );
}

import { PROJECT_STATUS_COLORS, type ProjectStatus } from "@/lib/types/models";
import { formatProjectStatusLabel } from "@/lib/utils/project-table-formatters";

export function CellStatus({ status }: { status: ProjectStatus }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-chip border px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-text-2"
      style={{ borderColor: PROJECT_STATUS_COLORS[status] }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLORS[status] }} />
      <span className="truncate">{formatProjectStatusLabel(status)}</span>
    </span>
  );
}

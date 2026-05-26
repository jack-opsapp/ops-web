import { StatusBadge, type ProjectStatus as BadgeProjectStatus } from "@/components/ops/status-badge";
import { ProjectStatus } from "@/lib/types/models";
import { formatProjectStatusLabel } from "@/lib/utils/project-table-formatters";

function toBadgeStatus(status: ProjectStatus): BadgeProjectStatus {
  switch (status) {
    case ProjectStatus.RFQ:
      return "rfq";
    case ProjectStatus.Estimated:
      return "estimated";
    case ProjectStatus.Accepted:
      return "accepted";
    case ProjectStatus.InProgress:
      return "in-progress";
    case ProjectStatus.Completed:
      return "completed";
    case ProjectStatus.Closed:
      return "closed";
    case ProjectStatus.Archived:
      return "archived";
  }
}

export function CellStatus({ status }: { status: ProjectStatus }) {
  return (
    <StatusBadge
      status={toBadgeStatus(status)}
      label={formatProjectStatusLabel(status)}
      className="max-w-full justify-center px-1.5 py-[2px] text-[11px] leading-none"
    />
  );
}

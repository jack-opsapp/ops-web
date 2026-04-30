import type { DataSetupRequestStatus } from "@/lib/admin/data-setup-queries";

const CONFIG: Record<
  DataSetupRequestStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "PENDING",
    className: "text-tan bg-tan-soft border-tan-line",
  },
  scheduled: {
    label: "SCHEDULED",
    className: "text-tan bg-tan-soft border-tan-line",
  },
  in_progress: {
    label: "IN PROGRESS",
    className: "text-text bg-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.18)]",
  },
  completed: {
    label: "COMPLETED",
    className: "text-olive bg-olive-soft border-olive-line",
  },
  cancelled: {
    label: "CANCELLED",
    className: "text-text-mute bg-[rgba(255,255,255,0.04)] border-line",
  },
};

export function StatusPill({ status }: { status: DataSetupRequestStatus }) {
  const { label, className } = CONFIG[status];
  return (
    <span
      className={
        "inline-flex items-center px-1 py-[1px] rounded-chip " +
        "font-mono text-micro uppercase tracking-wide " +
        "border " +
        className
      }
    >
      {label}
    </span>
  );
}

"use client";

interface TaskItem {
  id: string;
  title: string;
  status: string;
  scheduledDate?: string;
}

interface PortalTaskTimelineProps {
  tasks: TaskItem[];
}

const STATUS_COLORS: Record<string, { dot: string; label: string }> = {
  Booked: { dot: "#417394", label: "Booked" },
  booked: { dot: "#417394", label: "Booked" },
  "In Progress": { dot: "#C4A868", label: "In Progress" },
  in_progress: { dot: "#C4A868", label: "In Progress" },
  Completed: { dot: "#9DB582", label: "Completed" },
  completed: { dot: "#9DB582", label: "Completed" },
  Cancelled: { dot: "#B58289", label: "Cancelled" },
  cancelled: { dot: "#B58289", label: "Cancelled" },
};

const DEFAULT_STATUS = { dot: "#9CA3AF", label: "" };

function formatScheduledDate(date?: string): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getStatusDisplay(status: string) {
  const found = STATUS_COLORS[status];
  if (found) return found;
  // Fallback: format the raw status string
  return {
    ...DEFAULT_STATUS,
    label: status
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

export function PortalTaskTimeline({ tasks }: PortalTaskTimelineProps) {
  if (tasks.length === 0) return null;

  return (
    <div
      className="rounded-xl p-6"
      style={{
        backgroundColor: "var(--portal-card)",
        border: "1px solid var(--portal-border)",
        borderRadius: "var(--portal-radius-lg)",
      }}
    >
      <div className="relative">
        {tasks.map((task, index) => {
          const statusDisplay = getStatusDisplay(task.status);
          const isLast = index === tasks.length - 1;

          return (
            <div key={task.id} className="relative flex gap-4" style={{ paddingBottom: isLast ? 0 : 24 }}>
              {/* Timeline line */}
              {!isLast && (
                <div
                  className="absolute left-[7px] top-[18px]"
                  style={{
                    width: 2,
                    bottom: 0,
                    backgroundColor: "var(--portal-border)",
                  }}
                />
              )}

              {/* Dot */}
              <div
                className="relative shrink-0 mt-1.5"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  backgroundColor: statusDisplay.dot,
                  border: "3px solid var(--portal-card)",
                  boxShadow: `0 0 0 2px ${statusDisplay.dot}`,
                }}
              />

              {/* Content */}
              <div className="flex-1 min-w-0 pb-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{task.title}</p>
                  <span
                    className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: `${statusDisplay.dot}20`,
                      color: statusDisplay.dot,
                    }}
                  >
                    {statusDisplay.label}
                  </span>
                </div>
                {task.scheduledDate && (
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "var(--portal-text-tertiary)" }}
                  >
                    {formatScheduledDate(task.scheduledDate)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";

interface TaskItem {
  id: string;
  title: string;
  status: string;
  scheduledDate?: string;
}

interface PortalTaskTimelineProps {
  tasks: TaskItem[];
}

const STATUS_DOTS: Record<string, string> = {
  Booked: "#417394",
  booked: "#417394",
  "In Progress": "#C4A868",
  in_progress: "#C4A868",
  Completed: "#9DB582",
  completed: "#9DB582",
  Cancelled: "#B58289",
  cancelled: "#B58289",
};

const STATUS_KEYS: Record<string, string> = {
  Booked: "taskTimeline.booked",
  booked: "taskTimeline.booked",
  "In Progress": "taskTimeline.inProgress",
  in_progress: "taskTimeline.inProgress",
  Completed: "taskTimeline.completed",
  completed: "taskTimeline.completed",
  Cancelled: "taskTimeline.cancelled",
  cancelled: "taskTimeline.cancelled",
};

const DEFAULT_DOT = "#9CA3AF";

function formatScheduledDate(date: string | undefined, locale: Locale): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PortalTaskTimeline({ tasks }: PortalTaskTimelineProps) {
  const { t } = useDictionary("portal");
  const { locale } = useLocale();

  function getStatusDisplay(status: string) {
    const dot = STATUS_DOTS[status] ?? DEFAULT_DOT;
    const key = STATUS_KEYS[status];
    const label = key
      ? t(key)
      : status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { dot, label };
  }
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
                    {formatScheduledDate(task.scheduledDate, locale)}
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

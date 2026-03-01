"use client";

import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus, getTaskDisplayTitle } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";
import { useTasks, useUpdateTaskStatus } from "@/lib/hooks";
import { isBefore, isSameDay, differenceInDays } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OverdueTasksWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverdueTasksWidget({ size }: OverdueTasksWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data, isLoading } = useTasks();
  const today = useMemo(() => new Date(), []);

  const overdueTasks = useMemo(() => {
    if (!data?.tasks) return [];
    return data.tasks.filter((task) => {
      if (
        task.status === TaskStatus.Completed ||
        task.status === TaskStatus.Cancelled
      )
        return false;
      const startDate = task.calendarEvent?.startDate
        ? new Date(task.calendarEvent.startDate)
        : null;
      if (!startDate) return false;
      return isBefore(startDate, today) && !isSameDay(startDate, today);
    });
  }, [data?.tasks, today]);

  // ── SM: Count only ──────────────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">{t("overdueTasks.title")}</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                {t("overdueTasks.loading")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "font-mohave text-[24px] leading-none font-medium",
                  overdueTasks.length > 0
                    ? "text-status-error"
                    : "text-text-primary"
                )}
              >
                {overdueTasks.length}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                {t("overdueTasks.overdue")}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const maxItems = size === "lg" ? 7 : 3;

  // ── MD / LG: List with checkboxes ─────────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("overdueTasks.title")}</CardTitle>
          <span
            className={cn(
              "font-mono text-[11px]",
              overdueTasks.length > 0
                ? "text-status-error"
                : "text-text-tertiary"
            )}
          >
            {isLoading ? "..." : overdueTasks.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("overdueTasks.loadingTasks")}
            </span>
          </div>
        ) : overdueTasks.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("overdueTasks.noOverdue")}
          </p>
        ) : (
          <div className="space-y-[4px]">
            <AnimatePresence>
              {overdueTasks.slice(0, maxItems).map((task) => (
                <OverdueTaskRow key={task.id} task={task} today={today} />
              ))}
            </AnimatePresence>
            {overdueTasks.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                {t("overdueTasks.more").replace("{count}", String(overdueTasks.length - maxItems))}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overdue task row with one-click complete
// ---------------------------------------------------------------------------

function OverdueTaskRow({
  task,
  today,
}: {
  task: ProjectTask;
  today: Date;
}) {
  const { t } = useDictionary("dashboard");
  const [completing, setCompleting] = useState(false);
  const updateStatus = useUpdateTaskStatus();

  const displayTitle = getTaskDisplayTitle(task, task.taskType);
  const projectName = task.project?.title ?? t("overdueTasks.unassigned");
  const startDate = task.calendarEvent?.startDate
    ? new Date(task.calendarEvent.startDate)
    : null;
  const daysOverdue = startDate ? differenceInDays(today, startDate) : 0;

  const handleComplete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (completing) return;
      setCompleting(true);
      updateStatus.mutate(
        { id: task.id, status: TaskStatus.Completed },
        { onError: () => setCompleting(false) }
      );
    },
    [task.id, completing, updateStatus]
  );

  return (
    <motion.div
      layout
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group",
        completing && "opacity-50"
      )}
    >
      {/* One-click complete checkbox */}
      <button
        onClick={handleComplete}
        className={cn(
          "w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 transition-all duration-200",
          completing
            ? "bg-status-success border-status-success"
            : "border-border-medium hover:border-ops-accent hover:bg-ops-accent/10"
        )}
        title={t("overdueTasks.completeTask")}
      >
        {completing && <Check className="w-[12px] h-[12px] text-white" />}
      </button>

      <AlertCircle className="w-[14px] h-[14px] text-status-error shrink-0" />

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "font-mohave text-body-sm text-text-primary truncate transition-all duration-200",
            completing && "line-through text-text-disabled"
          )}
        >
          {displayTitle}
        </p>
        <span className="font-mono text-[10px] text-text-tertiary truncate block">
          {projectName}
        </span>
      </div>

      <span className="font-mono text-[11px] text-status-error shrink-0">
        {daysOverdue}d
      </span>
    </motion.div>
  );
}

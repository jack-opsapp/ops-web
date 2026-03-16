"use client";

import { useMemo, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus, TASK_STATUS_COLORS } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";
import { useTasks } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

const STATUS_LABEL_KEYS: Record<string, string> = {
  [TaskStatus.Booked]: "stat.statusBooked",
  [TaskStatus.InProgress]: "stat.statusInProgress",
  [TaskStatus.Completed]: "stat.statusCompleted",
  [TaskStatus.Cancelled]: "taskStatusChart.cancelled",
};

const DISPLAY_STATUSES = [
  TaskStatus.Booked,
  TaskStatus.InProgress,
  TaskStatus.Completed,
  TaskStatus.Cancelled,
];

interface TaskStatusChartWidgetProps {
  size: WidgetSize;
  tasks?: ProjectTask[];
  isLoading?: boolean;
  config?: Record<string, unknown>;
}

// Custom tooltip
function ChartTooltip({ active, payload, t }: TooltipProps<number, string> & { t: (key: string) => string }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-[rgba(10,10,10,0.95)] backdrop-blur-xl border border-[rgba(255,255,255,0.12)] rounded px-2 py-1.5 shadow-floating">
      <div className="flex items-center gap-1.5">
        <span
          className="w-[8px] h-[8px] rounded-sm shrink-0"
          style={{ backgroundColor: data.color }}
        />
        <span className="font-mohave text-body-sm text-text-primary">{data.label}</span>
      </div>
      <div className="flex items-center gap-1 mt-[2px]">
        <span className="font-mono text-body-sm text-text-primary font-medium">{data.value}</span>
        <span className="font-mono text-[10px] text-text-disabled">
          ({data.percentage}%)
        </span>
      </div>
    </div>
  );
}

export function TaskStatusChartWidget({
  size,
  tasks: externalTasks,
  isLoading: externalLoading,
  config,
}: TaskStatusChartWidgetProps) {
  const { t } = useDictionary("dashboard");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Self-contained: fetch own data if not provided
  const { data: tasksData, isLoading: selfLoading } = useTasks(undefined, {
    enabled: !externalTasks,
  });

  const tasks = externalTasks ?? tasksData?.tasks ?? [];
  const isLoading = externalLoading ?? selfLoading;

  const chartData = useMemo(() => {
    const activeTasks = tasks.filter((t) => !t.deletedAt);
    const total = activeTasks.length;

    return DISPLAY_STATUSES.map((status) => {
      const count = activeTasks.filter((t) => t.status === status).length;
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        name: status,
        label: t(STATUS_LABEL_KEYS[status] ?? status),
        value: count,
        color: TASK_STATUS_COLORS[status],
        percentage,
      };
    }).filter((d) => d.value > 0);
  }, [tasks, t]);

  const totalTasks = chartData.reduce((sum, d) => sum + d.value, 0);

  const ringConfig = useMemo(() => {
    if (size === "lg") return { innerRadius: 40, outerRadius: 60 };
    if (size === "md") return { innerRadius: 30, outerRadius: 46 };
    return { innerRadius: 22, outerRadius: 34 };
  }, [size]);

  const handleMouseEnter = useCallback((_: unknown, index: number) => {
    setHoveredIndex(index);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("taskStatusChart.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading ? "..." : totalTasks}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0 flex items-center">
          {isLoading ? (
            <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
          ) : chartData.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled">{t("taskStatusChart.empty")}</p>
          ) : (
            <div className="w-full h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    innerRadius={ringConfig.innerRadius}
                    outerRadius={ringConfig.outerRadius}
                    paddingAngle={1}
                    stroke="none"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={entry.color}
                        opacity={hoveredIndex !== null && hoveredIndex !== index ? 0.4 : 1}
                        style={{ transition: "opacity 200ms ease", cursor: "pointer" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip t={t} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // md / lg: ring chart + legend
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("taskStatusChart.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${totalTasks} ${t("taskStatusChart.total")}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("taskStatusChart.loading")}
            </span>
          </div>
        ) : chartData.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("taskStatusChart.empty")}
          </p>
        ) : (
          <div className={cn("flex gap-3", size === "lg" ? "flex-col" : "flex-row items-center")}>
            {/* Ring chart */}
            <div
              className={cn(
                "shrink-0",
                size === "lg" ? "w-full h-[140px]" : "w-[120px] h-[100px]"
              )}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    innerRadius={ringConfig.innerRadius}
                    outerRadius={ringConfig.outerRadius}
                    paddingAngle={1}
                    stroke="none"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={entry.color}
                        opacity={hoveredIndex !== null && hoveredIndex !== index ? 0.4 : 1}
                        style={{ transition: "opacity 200ms ease", cursor: "pointer" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip t={t} />} />
                  {/* Center label */}
                  <text
                    x="50%"
                    y="48%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-text-primary font-mono"
                    style={{ fontSize: "18px", fontWeight: 600 }}
                  >
                    {hoveredIndex !== null ? chartData[hoveredIndex]?.value : totalTasks}
                  </text>
                  <text
                    x="50%"
                    y="62%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-text-disabled font-kosugi"
                    style={{ fontSize: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}
                  >
                    {hoveredIndex !== null
                      ? chartData[hoveredIndex]?.label
                      : t("taskStatusChart.tasks")}
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className={cn("flex-1 min-w-0", size === "lg" ? "space-y-[4px]" : "space-y-[3px]")}>
              {chartData.map((entry, i) => (
                <div
                  key={entry.name}
                  className={cn(
                    "flex items-center justify-between px-1 py-[2px] rounded transition-colors cursor-default",
                    hoveredIndex === i && "bg-[rgba(255,255,255,0.06)]"
                  )}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="w-[8px] h-[8px] rounded-sm shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="font-mohave text-body-sm text-text-secondary">
                      {entry.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-body-sm text-text-primary font-medium">
                      {entry.value}
                    </span>
                    <span className="font-mono text-[10px] text-text-disabled">
                      ({entry.percentage}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
import {
  ProjectStatus,
  PROJECT_STATUS_COLORS,
  isActiveProjectStatus,
} from "@/lib/types/models";
import type { Project } from "@/lib/types/models";
import { useProjects } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// Status display labels (keyed to i18n)
const STATUS_LABEL_KEYS: Record<string, string> = {
  [ProjectStatus.RFQ]: "stat.statusRfq",
  [ProjectStatus.Estimated]: "stat.statusEstimated",
  [ProjectStatus.Accepted]: "stat.statusAccepted",
  [ProjectStatus.InProgress]: "stat.statusInProgress",
  [ProjectStatus.Completed]: "stat.statusCompleted",
  [ProjectStatus.Closed]: "stat.statusClosed",
  [ProjectStatus.Archived]: "stat.statusArchived",
};

const ACTIVE_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
];

interface ProjectStatusChartWidgetProps {
  size: WidgetSize;
  projects?: Project[];
  isLoading?: boolean;
  config?: Record<string, unknown>;
}

// Custom tooltip for the ring chart
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

export function ProjectStatusChartWidget({
  size,
  projects: externalProjects,
  isLoading: externalLoading,
  config,
}: ProjectStatusChartWidgetProps) {
  const { t } = useDictionary("dashboard");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Self-contained: fetch own data if not provided
  const { data: projectsData, isLoading: selfLoading } = useProjects(undefined, {
    enabled: !externalProjects,
  });

  const projects = externalProjects ?? projectsData?.projects ?? [];
  const isLoading = externalLoading ?? selfLoading;

  const chartData = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => !p.deletedAt && isActiveProjectStatus(p.status)
    );
    const total = activeProjects.length;

    return ACTIVE_STATUSES.map((status) => {
      const count = activeProjects.filter((p) => p.status === status).length;
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        name: status,
        label: t(STATUS_LABEL_KEYS[status] ?? status),
        value: count,
        color: PROJECT_STATUS_COLORS[status],
        percentage,
      };
    }).filter((d) => d.value > 0);
  }, [projects, t]);

  const totalProjects = chartData.reduce((sum, d) => sum + d.value, 0);

  // Ring dimensions based on size
  const ringConfig = useMemo(() => {
    if (size === "lg") return { innerRadius: 40, outerRadius: 60, cx: "50%", cy: "50%" };
    if (size === "md") return { innerRadius: 30, outerRadius: 46, cx: "50%", cy: "50%" };
    return { innerRadius: 22, outerRadius: 34, cx: "50%", cy: "50%" };
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
            <CardTitle className="text-card-subtitle">{t("projectStatusChart.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading ? "..." : totalProjects}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0 flex items-center">
          {isLoading ? (
            <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
          ) : chartData.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled">{t("projectStatusChart.empty")}</p>
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
          <CardTitle className="text-card-subtitle">{t("projectStatusChart.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${totalProjects} ${t("projectStatusChart.total")}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("projectStatusChart.loading")}
            </span>
          </div>
        ) : chartData.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("projectStatusChart.empty")}
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
                    {hoveredIndex !== null ? chartData[hoveredIndex]?.value : totalProjects}
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
                      : t("projectStatusChart.projects")}
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

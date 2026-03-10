"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@/lib/types/models";
import {
  ProjectStatus,
  isActiveProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

interface PipelineWidgetProps {
  size: WidgetSize;
  projects: Project[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

export function PipelineWidget({
  size,
  projects,
  isLoading,
  onNavigate,
}: PipelineWidgetProps) {
  const { t } = useDictionary("dashboard");
  const stages = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => !p.deletedAt && isActiveProjectStatus(p.status)
    );
    const total = activeProjects.length;

    const pipelineStatuses = [
      ProjectStatus.RFQ,
      ProjectStatus.Estimated,
      ProjectStatus.Accepted,
      ProjectStatus.InProgress,
    ];

    return pipelineStatuses.map((status) => {
      const count = activeProjects.filter((p) => p.status === status).length;
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        label: status === ProjectStatus.InProgress ? t("pipelineFunnel.inProgress") : status,
        count,
        color: PROJECT_STATUS_COLORS[status],
        percentage,
      };
    });
  }, [projects]);

  const totalProjects = stages.reduce((sum, s) => sum + s.count, 0);

  // Per-stage project lists (used by lg variant, cheap to compute regardless)
  const stageProjects = useMemo(() => {
    const pipelineStatuses = [
      ProjectStatus.RFQ,
      ProjectStatus.Estimated,
      ProjectStatus.Accepted,
      ProjectStatus.InProgress,
    ];
    return pipelineStatuses.map((status) => ({
      status,
      projects: projects.filter(
        (p) => !p.deletedAt && p.status === status
      ),
    }));
  }, [projects]);

  // sm: bar only
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("pipelineFunnel.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading ? "..." : `${totalProjects}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            </div>
          ) : (
            <div className="flex h-[8px] rounded-full overflow-hidden">
              {stages.map((stage, i) => (
                <div
                  key={i}
                  className="h-full transition-all duration-500"
                  style={{
                    width: totalProjects > 0 ? `${stage.percentage}%` : "25%",
                    backgroundColor: stage.color,
                    marginRight: i < stages.length - 1 ? "1px" : "0",
                    opacity: totalProjects > 0 ? 1 : 0.2,
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // lg: bar + list + stage detail with project names
  if (size === "lg") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("pipelineFunnel.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading ? "..." : `${totalProjects} ${t("pipelineFunnel.active")}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">{t("pipelineFunnel.loading")}</span>
            </div>
          ) : (
            <>
              {/* Stacked bar */}
              <div className="flex h-[8px] rounded-full overflow-hidden mb-2">
                {stages.map((stage, i) => (
                  <div
                    key={i}
                    className="h-full transition-all duration-500"
                    style={{
                      width: totalProjects > 0 ? `${stage.percentage}%` : "25%",
                      backgroundColor: stage.color,
                      marginRight: i < stages.length - 1 ? "1px" : "0",
                      opacity: totalProjects > 0 ? 1 : 0.2,
                    }}
                  />
                ))}
              </div>

              {/* Stage breakdown with project names */}
              <div className="space-y-1.5">
                {stages.map((stage, i) => (
                  <div key={i}>
                    <div
                      onClick={() => onNavigate("/pipeline")}
                      className="flex items-center justify-between cursor-pointer hover:bg-[rgba(255,255,255,0.04)] rounded px-1 py-[2px] transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className="w-[8px] h-[8px] rounded-sm shrink-0"
                          style={{ backgroundColor: stage.color }}
                        />
                        <span className="font-mohave text-body-sm text-text-secondary">
                          {stage.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-body-sm text-text-primary font-medium">
                          {stage.count}
                        </span>
                        <span className="font-mono text-[10px] text-text-disabled">
                          ({stage.percentage}%)
                        </span>
                      </div>
                    </div>
                    {/* Project names under each stage */}
                    {stageProjects[i]?.projects.slice(0, 2).map((p) => (
                      <div
                        key={p.id}
                        onClick={() => onNavigate(`/projects/${p.id}`)}
                        className="pl-[24px] py-[2px] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
                      >
                        <span className="font-mohave text-[12px] text-text-tertiary truncate block">
                          {p.title || t("pipelineFunnel.untitled")}
                        </span>
                      </div>
                    ))}
                    {(stageProjects[i]?.projects.length ?? 0) > 2 && (
                      <span className="font-mono text-[10px] text-text-disabled pl-[24px]">
                        +{(stageProjects[i]?.projects.length ?? 0) - 2} {t("pipelineFunnel.more")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // md: bar + list (current default)
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("pipelineFunnel.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${totalProjects} ${t("pipelineFunnel.active")}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">{t("pipelineFunnel.loading")}</span>
          </div>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="flex h-[8px] rounded-full overflow-hidden mb-2">
              {stages.map((stage, i) => (
                <div
                  key={i}
                  className="h-full transition-all duration-500"
                  style={{
                    width: totalProjects > 0 ? `${stage.percentage}%` : "25%",
                    backgroundColor: stage.color,
                    marginRight: i < stages.length - 1 ? "1px" : "0",
                    opacity: totalProjects > 0 ? 1 : 0.2,
                  }}
                />
              ))}
            </div>

            {/* Stage breakdown */}
            <div className="space-y-[6px]">
              {stages.map((stage, i) => (
                <div
                  key={i}
                  onClick={() => onNavigate("/pipeline")}
                  className="flex items-center justify-between cursor-pointer hover:bg-[rgba(255,255,255,0.04)] rounded px-1 py-[2px] transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="w-[8px] h-[8px] rounded-sm shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="font-mohave text-body-sm text-text-secondary">
                      {stage.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-body-sm text-text-primary font-medium">
                      {stage.count}
                    </span>
                    <span className="font-mono text-[10px] text-text-disabled">
                      ({stage.percentage}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

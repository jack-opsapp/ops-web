"use client";

import { useRouter } from "next/navigation";
import {
  MapPin,
  CalendarDays,
  ExternalLink,
  Loader2,
  Users,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useProject } from "@/lib/hooks/use-projects";
import { useProjectTasks } from "@/lib/hooks/use-tasks";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";

interface ProjectDetailSheetProps {
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectDetailSheet({ projectId, open, onOpenChange }: ProjectDetailSheetProps) {
  const router = useRouter();
  const { data: project, isLoading } = useProject(projectId ?? undefined);
  const { data: tasks } = useProjectTasks(projectId ?? undefined);

  const statusColor = project ? PROJECT_STATUS_COLORS[project.status] : "#999";
  const completedTasks = tasks?.filter((t) => t.status === "Completed").length ?? 0;
  const totalTasks = tasks?.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          {isLoading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-[16px] h-[16px] text-ops-accent animate-spin" />
              <SheetTitle>Loading...</SheetTitle>
            </div>
          ) : project ? (
            <>
              <div className="flex items-center gap-1.5">
                <SheetTitle className="truncate">{project.title}</SheetTitle>
                <span
                  className="shrink-0 px-[8px] py-[2px] rounded-full font-kosugi text-[10px] uppercase tracking-wider"
                  style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
                >
                  {project.status}
                </span>
              </div>
              <SheetDescription>{project.client?.name ?? "No Client"}</SheetDescription>
            </>
          ) : (
            <SheetTitle>Project not found</SheetTitle>
          )}
        </SheetHeader>

        <SheetBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
            </div>
          ) : project ? (
            <div className="space-y-3">
              {/* Address */}
              {project.address && (
                <div className="flex items-start gap-[8px]">
                  <MapPin className="w-[16px] h-[16px] text-text-tertiary mt-[2px] shrink-0" />
                  <span className="font-mohave text-body-sm text-text-secondary">{project.address}</span>
                </div>
              )}

              {/* Dates */}
              <div className="flex items-center gap-[8px]">
                <CalendarDays className="w-[16px] h-[16px] text-text-tertiary shrink-0" />
                <span className="font-mono text-[12px] text-text-secondary">
                  {project.startDate
                    ? new Date(project.startDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "No start date"}
                  {project.endDate && (
                    <>
                      {" — "}
                      {new Date(project.endDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </>
                  )}
                </span>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <div className="bg-background-elevated rounded-lg p-1.5 text-center">
                  <ClipboardList className="w-[16px] h-[16px] text-ops-accent mx-auto mb-[4px]" />
                  <p className="font-mono text-body text-text-primary">{completedTasks}/{totalTasks}</p>
                  <p className="font-kosugi text-[10px] text-text-disabled">Tasks</p>
                </div>
                <div className="bg-background-elevated rounded-lg p-1.5 text-center">
                  <Users className="w-[16px] h-[16px] text-ops-accent mx-auto mb-[4px]" />
                  <p className="font-mono text-body text-text-primary">{project.teamMemberIds?.length ?? 0}</p>
                  <p className="font-kosugi text-[10px] text-text-disabled">Team</p>
                </div>
                <div className="bg-background-elevated rounded-lg p-1.5 text-center">
                  <CalendarDays className="w-[16px] h-[16px] text-ops-accent mx-auto mb-[4px]" />
                  <p className="font-mono text-body text-text-primary">
                    {project.duration ? `${project.duration}d` : "—"}
                  </p>
                  <p className="font-kosugi text-[10px] text-text-disabled">Duration</p>
                </div>
              </div>

              {/* Notes */}
              {project.notes && (
                <div className="pt-1.5 border-t border-border-subtle">
                  <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider mb-[4px]">Notes</p>
                  <p className="font-mohave text-body-sm text-text-secondary whitespace-pre-wrap line-clamp-4">
                    {project.notes}
                  </p>
                </div>
              )}

              {/* Tasks preview */}
              {tasks && tasks.length > 0 && (
                <div className="pt-1.5 border-t border-border-subtle">
                  <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider mb-[6px]">Tasks</p>
                  <div className="space-y-[4px]">
                    {tasks.slice(0, 5).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-[8px] py-[4px] px-[8px] rounded bg-background-elevated"
                      >
                        <span
                          className="w-[8px] h-[8px] rounded-full shrink-0"
                          style={{ backgroundColor: task.taskColor || "#666" }}
                        />
                        <span className="font-mohave text-body-sm text-text-primary truncate">
                          {task.customTitle || "Untitled"}
                        </span>
                        <span className="ml-auto font-kosugi text-[10px] text-text-disabled shrink-0">
                          {task.status}
                        </span>
                      </div>
                    ))}
                    {tasks.length > 5 && (
                      <p className="font-kosugi text-[10px] text-text-disabled text-center py-[4px]">
                        +{tasks.length - 5} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Open full page button */}
              <div className="pt-2">
                <Button
                  className="w-full gap-[6px]"
                  onClick={() => {
                    onOpenChange(false);
                    router.push(`/projects/${project.id}`);
                  }}
                >
                  <ExternalLink className="w-[14px] h-[14px]" />
                  Open Full Details
                </Button>
              </div>
            </div>
          ) : (
            <p className="font-mohave text-body text-text-tertiary text-center py-4">
              Project not found
            </p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

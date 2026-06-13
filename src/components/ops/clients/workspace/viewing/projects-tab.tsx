"use client";

import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import { useClientProjects } from "@/lib/hooks/use-client-projects";
import { useWindowStore } from "@/stores/window-store";
import {
  ProjectStatus,
  PROJECT_STATUS_COLORS,
  type Project,
} from "@/lib/types/models";
import { formatEnumLabel } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/date";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Body } from "@/components/ops/projects/workspace/atoms/body";

const COMPLETED = new Set<ProjectStatus>([
  ProjectStatus.Completed,
  ProjectStatus.Closed,
  ProjectStatus.Archived,
]);

function ProjectRow({
  project,
  onOpen,
  crewLabel,
}: {
  project: Project;
  onOpen: () => void;
  crewLabel: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: PROJECT_STATUS_COLORS[project.status] }}
      />
      <Body size={14} color="text" className="min-w-0 flex-1 truncate">
        {project.title}
      </Body>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-3">
        {[
          formatEnumLabel(project.status).toUpperCase(),
          crewLabel,
          project.startDate ? formatDate(project.startDate, "MMM d") : null,
        ]
          .filter(Boolean)
          .join("  ·  ")}
      </span>
    </button>
  );
}

export function ProjectsTab({ clientId }: { clientId: string }) {
  const { t } = useDictionary("clients");
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const { data, isLoading } = useClientProjects(clientId);

  const { active, completed } = useMemo(() => {
    const rows = (data ?? []).filter((p) => !p.deletedAt);
    return {
      active: rows.filter((p) => !COMPLETED.has(p.status)),
      completed: rows.filter((p) => COMPLETED.has(p.status)),
    };
  }, [data]);

  const crewLabel = (p: Project) =>
    p.teamMemberIds.length > 0
      ? t("window.projects.crew", { count: String(p.teamMemberIds.length) })
      : null;

  if (!isLoading && active.length === 0 && completed.length === 0) {
    return (
      <div className="p-5">
        <Mono size={11} color="mute">
          {t("window.projects.empty")}
        </Mono>
      </div>
    );
  }

  return (
    <Stack gap={3} className="p-5">
      {active.length > 0 && (
        <Section
          title={t("window.projects.active")}
          rightSlot={
            <Mono size={11} color="text-3">
              {t("window.projects.summary", {
                active: String(active.length),
                done: String(completed.length),
              })}
            </Mono>
          }
        >
          <Stack gap={0} className="divide-y divide-glass-border">
            {active.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                crewLabel={crewLabel(p)}
                onOpen={() => openProjectWindow({ projectId: p.id, mode: "viewing" })}
              />
            ))}
          </Stack>
        </Section>
      )}

      {completed.length > 0 && (
        <Section title={t("window.projects.completed")}>
          <Stack gap={0} className="divide-y divide-glass-border opacity-70">
            {completed.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                crewLabel={crewLabel(p)}
                onOpen={() => openProjectWindow({ projectId: p.id, mode: "viewing" })}
              />
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

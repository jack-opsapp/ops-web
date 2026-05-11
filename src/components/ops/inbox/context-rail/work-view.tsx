"use client";

/**
 * WorkView — body of the WORK tab in the inbox right rail (spec § 6.3).
 *
 * Stacks two sections under tactical SlashLabel headers:
 *
 *   // LEADS · {n}
 *   { existing <PipelineList> — unchanged behavior }
 *
 *   // PROJECTS · {n}
 *   { stack of slim <ProjectGroup> rows, each collapsible to reveal tasks }
 *   [+ NEW PROJECT]
 *
 * The ProjectStatus enum (RFQ/Estimated/Accepted/InProgress/Completed/
 * Closed/Archived) maps to the spec's three-stage display set:
 *   RFQ                      → "RFQ"     · tan
 *   Estimated                → "QUOTED"  · tan
 *   Accepted | InProgress    → "ACTIVE"  · accent
 *   Completed | Closed       → "CLOSED"  · neutral
 *   Archived                 → "CLOSED"  · neutral
 *
 * Project linked-to-thread state is derived from
 *   pipelineOpps.find(o => o.id === project.opportunityId)?.threadId
 * matching `currentThreadId`. When matched, the ProjectGroup paints the
 * accent left bar + tint.
 */

import { useDictionary } from "@/i18n/client";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import type { Project } from "@/lib/types/models";
import { ProjectStatus } from "@/lib/types/models";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";
import { PipelineList, type PipelineOpp } from "./pipeline-list";
import {
  ProjectGroup,
  type ProjectGroupStage,
  type ProjectGroupTask,
} from "./project-group";
import type { ClientTaskRow } from "@/lib/hooks/use-client-tasks";

interface WorkViewProps {
  pipelineOpps: PipelineOpp[];
  projects: Project[];
  tasks: ClientTaskRow[];
  currentThreadId: string;
  onNewOpportunity: () => void;
  onNewProject: () => void;
  /** Optional override for the OPEN button on each ProjectGroup. When omitted
   *  the group falls back to a `<Link href="?project={id}">`. */
  onOpenProject?: (projectId: string) => void;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/** Maps the wire ProjectStatus enum to the rail's display stage tag.
 *  Documented inline in the file header — kept here as a small helper so
 *  the WorkView body stays declarative. */
function statusToStage(status: ProjectStatus): ProjectGroupStage {
  switch (status) {
    case ProjectStatus.RFQ:
      return { label: "RFQ", tone: "tan" };
    case ProjectStatus.Estimated:
      return { label: "QUOTED", tone: "tan" };
    case ProjectStatus.Accepted:
    case ProjectStatus.InProgress:
      return { label: "ACTIVE", tone: "accent" };
    case ProjectStatus.Completed:
    case ProjectStatus.Closed:
    case ProjectStatus.Archived:
      return { label: "CLOSED", tone: "neutral" };
    default:
      return { label: "CLOSED", tone: "neutral" };
  }
}

function toGroupTask(row: ClientTaskRow): ProjectGroupTask {
  return {
    id: row.id,
    label: row.label,
    assignee: row.assignee,
    due: row.due,
    status: row.status,
    overdue: row.overdue,
  };
}

export function WorkView({
  pipelineOpps,
  projects,
  tasks,
  currentThreadId,
  onNewOpportunity,
  onNewProject,
  onOpenProject,
  className,
}: WorkViewProps) {
  const { t } = useDictionary("inbox");

  // Build a quick lookup so each project can be flagged when its owning
  // opportunity is linked to the current rail thread.
  const oppThreadById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const opp of pipelineOpps) {
      map.set(opp.id, opp.threadId ?? null);
    }
    return map;
  }, [pipelineOpps]);

  const tasksByProject = useMemo(() => {
    const map = new Map<string, ClientTaskRow[]>();
    for (const row of tasks) {
      const list = map.get(row.projectId) ?? [];
      list.push(row);
      map.set(row.projectId, list);
    }
    return map;
  }, [tasks]);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* ── LEADS section ─────────────────────────────────────────── */}
      <section data-testid="work-view-leads">
        <SectionHeader
          label={t("rail.sectionLeads", "// LEADS")}
          count={pipelineOpps.length}
        />
        {/* PipelineList owns its own empty body ("no open opportunities") +
         *  the +New opportunity button. We just provide the SlashLabel +
         *  count header above it. */}
        <PipelineList
          opps={pipelineOpps}
          threadId={currentThreadId}
          onNewOpportunity={onNewOpportunity}
          className="mt-2"
        />
      </section>

      {/* ── PROJECTS section ──────────────────────────────────────── */}
      <section data-testid="work-view-projects">
        <SectionHeader
          label={t("rail.sectionProjects", "// PROJECTS")}
          count={projects.length}
        />
        {projects.length === 0 ? (
          <EmptyLine
            label={t("rail.emptyUnassigned", "[—] not assigned to a project")}
          />
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {projects.map((project) => {
              const linkedThreadId = project.opportunityId
                ? oppThreadById.get(project.opportunityId) ?? null
                : null;
              const groupProject = {
                id: project.id,
                name: project.title,
                stage: statusToStage(project.status),
                threadId: linkedThreadId,
              };
              const groupTasks = (tasksByProject.get(project.id) ?? []).map(
                toGroupTask,
              );
              return (
                <li key={project.id}>
                  <ProjectGroup
                    project={groupProject}
                    tasks={groupTasks}
                    currentThreadId={currentThreadId}
                    onOpen={onOpenProject}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={onNewProject}
          className="mt-2 inline-flex h-[26px] w-full items-center justify-center gap-1.5 rounded-[2.5px] border border-dashed border-line bg-transparent px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:border-line-hi hover:text-text"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("rail.addProject", "+ NEW PROJECT")}
        </button>
      </section>
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  count: number;
}

function SectionHeader({ label, count }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline justify-between px-0.5 pb-1">
      <SlashLabel label={label} tone="text-2" />
      <span
        className="font-mono text-[11px] tracking-[0.18em] text-text-mute"
        style={TNUM_ZERO}
      >
        {count}
      </span>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return (
    <p className="px-0.5 pt-1 font-mono text-[11px] text-text-3">{label}</p>
  );
}

import type { Project, ProjectTask } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import type { CrewLocation, CrewStatus } from "@/lib/api/services/crew-location-service";

export const POPUP_OPTIONS = {
  className: "ops-map-popup",
  closeButton: false,
  maxWidth: 220,
  minWidth: 180,
} as const;

// ── Project Popup ──
export function projectPopupHtml(project: Project): string {
  const statusColor = PROJECT_STATUS_COLORS[project.status] || "#8195B5";
  return `<div style="
    background: var(--surface-glass-dense);
    backdrop-filter: blur(28px) saturate(1.3); -webkit-backdrop-filter: blur(28px) saturate(1.3);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 180px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">${project.title}</div>
    <div style="font-size: 11px; color: #999; margin-bottom: 6px; font-family: 'Kosugi', sans-serif;">${project.address || "No address"}</div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="
        display: inline-block; width: 8px; height: 8px;
        border-radius: 50%; background: ${statusColor};
        box-shadow: 0 0 4px ${statusColor};
      "></span>
      <span style="font-size: 11px; color: ${statusColor}; font-family: 'Kosugi', sans-serif; text-transform: uppercase;">${project.status}</span>
    </div>
  </div>`;
}

// ── Grouped Project Popup (multiple projects at same location) ──
export function groupedProjectPopupHtml(projects: Project[]): string {
  const projectLines = projects
    .slice(0, 6)
    .map((p) => {
      const color = PROJECT_STATUS_COLORS[p.status] || "#8195B5";
      return `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; box-shadow: 0 0 4px ${color}; flex-shrink: 0;"></span>
        <div style="min-width: 0;">
          <div style="font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.title}</div>
          <div style="font-size: 9px; color: ${color}; font-family: 'Kosugi', sans-serif; text-transform: uppercase;">${p.status}</div>
        </div>
      </div>`;
    })
    .join("");

  const moreLine =
    projects.length > 6
      ? `<div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif; margin-top: 2px;">+${projects.length - 6} more</div>`
      : "";

  const address = projects[0]?.address || "No address";

  return `<div style="
    background: var(--surface-glass-dense);
    backdrop-filter: blur(28px) saturate(1.3); -webkit-backdrop-filter: blur(28px) saturate(1.3);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 180px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif; margin-bottom: 6px; text-transform: uppercase;">${address}</div>
    ${projectLines}
    ${moreLine}
  </div>`;
}

// ── Task Popup (for TODAY mode — grouped tasks at a project location) ──
export function taskPopupHtml(
  tasks: ProjectTask[],
  project: Project
): string {
  const taskLines = tasks
    .slice(0, 4)
    .map((t) => {
      const color = t.taskColor || "#8195B5";
      const name = t.customTitle || t.taskType?.display || "Task";
      return `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></span>
        <span style="font-size: 11px; font-family: 'Kosugi', sans-serif; color: #CCC;">${name}</span>
      </div>`;
    })
    .join("");

  const moreLine =
    tasks.length > 4
      ? `<div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif; margin-top: 2px;">+${tasks.length - 4} more</div>`
      : "";

  return `<div style="
    background: var(--surface-glass-dense);
    backdrop-filter: blur(28px) saturate(1.3); -webkit-backdrop-filter: blur(28px) saturate(1.3);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 160px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 13px; font-weight: 600; margin-bottom: 2px;">${project.title}</div>
    <div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif; margin-bottom: 6px;">${project.address || ""}</div>
    ${taskLines}
    ${moreLine}
  </div>`;
}

// ── Grouped Task Popup (TODAY mode — multiple projects at same location) ──
export function groupedTaskPopupHtml(
  projectTaskGroups: { project: Project; tasks: ProjectTask[] }[]
): string {
  const totalTasks = projectTaskGroups.reduce((sum, g) => sum + g.tasks.length, 0);
  const address = projectTaskGroups[0]?.project.address || "";

  // Show up to 3 projects, each with up to 2 tasks
  const maxProjects = 3;
  const projectSections = projectTaskGroups
    .slice(0, maxProjects)
    .map((group) => {
      const taskLines = group.tasks
        .slice(0, 2)
        .map((t) => {
          const color = t.taskColor || "#8195B5";
          const name = t.customTitle || t.taskType?.display || "Task";
          return `<div style="display: flex; align-items: center; gap: 5px; margin-bottom: 2px; padding-left: 12px;">
            <span style="display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></span>
            <span style="font-size: 10px; font-family: 'Kosugi', sans-serif; color: #CCC;">${name}</span>
          </div>`;
        })
        .join("");

      const taskMore =
        group.tasks.length > 2
          ? `<div style="font-size: 9px; color: #555; font-family: 'Kosugi', sans-serif; padding-left: 12px;">+${group.tasks.length - 2} more</div>`
          : "";

      return `<div style="margin-bottom: 6px;">
        <div style="font-size: 12px; font-weight: 500; margin-bottom: 2px;">${group.project.title}</div>
        ${taskLines}
        ${taskMore}
      </div>`;
    })
    .join("");

  const projectMore =
    projectTaskGroups.length > maxProjects
      ? `<div style="font-size: 9px; color: #555; font-family: 'Kosugi', sans-serif; margin-top: 2px;">+${projectTaskGroups.length - maxProjects} more projects</div>`
      : "";

  return `<div style="
    background: var(--surface-glass-dense);
    backdrop-filter: blur(28px) saturate(1.3); -webkit-backdrop-filter: blur(28px) saturate(1.3);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 180px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
      <div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif; text-transform: uppercase;">${address}</div>
      <div style="font-size: 9px; color: #555; font-family: 'Kosugi', sans-serif;">${totalTasks} TASKS</div>
    </div>
    ${projectSections}
    ${projectMore}
  </div>`;
}

// ── Crew Popup (real-time location data from crew_locations table) ──
const CREW_STATUS_LABELS: Record<CrewStatus, string> = {
  "on-site": "ON SITE",
  "en-route": "EN ROUTE",
  idle: "IDLE",
};
const CREW_STATUS_POPUP_COLORS: Record<CrewStatus, string> = {
  "on-site": "#A5B368",
  "en-route": "#C4A868",
  idle: "#8E8E93",
};

export function crewPopupHtml(
  location: CrewLocation,
  status: CrewStatus
): string {
  const name = [location.firstName, location.lastName]
    .filter(Boolean)
    .join(" ");
  const statusColor = CREW_STATUS_POPUP_COLORS[status];
  const statusLabel = CREW_STATUS_LABELS[status];

  const ageMs = Date.now() - location.updatedAt.getTime();
  const ageMins = Math.floor(ageMs / 60000);
  const ageLabel =
    ageMins < 1 ? "Just now" : ageMins === 1 ? "1 min ago" : `${ageMins} min ago`;

  const taskLine = location.currentTaskName
    ? `<div style="font-size: 10px; color: #999; font-family: 'Kosugi', sans-serif; margin-top: 4px;">${location.currentTaskName}</div>`
    : "";
  const projectLine = location.currentProjectName
    ? `<div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif;">${location.currentProjectName}</div>`
    : "";

  return `<div style="
    background: var(--surface-glass-dense);
    backdrop-filter: blur(28px) saturate(1.3); -webkit-backdrop-filter: blur(28px) saturate(1.3);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 140px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 13px; font-weight: 600; margin-bottom: 2px;">${name}</div>
    <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 2px;">
      <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 4px ${statusColor};"></span>
      <span style="font-size: 10px; color: ${statusColor}; font-family: 'Kosugi', sans-serif;">${statusLabel}</span>
      <span style="font-size: 9px; color: #555; font-family: 'Kosugi', sans-serif; margin-left: auto;">${ageLabel}</span>
    </div>
    ${taskLine}
    ${projectLine}
  </div>`;
}

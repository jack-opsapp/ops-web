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
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
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
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
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
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
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

import L from "leaflet";
import { PROJECT_STATUS_COLORS, type ProjectStatus } from "@/lib/types/models";
import type { CrewStatus } from "@/lib/api/services/crew-location-service";

// ── Project Pin: teardrop with status color + white center dot + glow ──
export function createProjectPinIcon(
  status: ProjectStatus,
  dimmed = false
): L.DivIcon {
  const color = PROJECT_STATUS_COLORS[status] || "#8195B5";
  const opacity = dimmed ? 0.5 : 1;
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--project" style="
        width: 28px; height: 28px;
        background: ${color};
        border: 2px solid rgba(0,0,0,0.4);
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 0 12px ${color}4D;
        opacity: ${opacity};
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      ">
        <div style="
          width: 10px; height: 10px;
          background: white;
          border-radius: 50%;
          margin: 7px auto 0;
          transform: rotate(45deg);
        "></div>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

// ── Project Pin with label (for ACTIVE/ALL modes — matches iOS) ──
export function createProjectPinWithLabel(
  status: ProjectStatus,
  projectName: string,
  dimmed = false
): L.DivIcon {
  const color = PROJECT_STATUS_COLORS[status] || "#8195B5";
  const opacity = dimmed ? 0.5 : 1;
  const truncName =
    projectName.length > 16 ? projectName.slice(0, 16) + "..." : projectName;
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--project-labeled" style="
        display: flex; flex-direction: column; align-items: center;
        opacity: ${opacity};
      ">
        <div style="
          width: 28px; height: 28px;
          background: ${color};
          border: 2px solid rgba(0,0,0,0.4);
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 0 12px ${color}4D;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        ">
          <div style="
            width: 10px; height: 10px;
            background: white;
            border-radius: 50%;
            margin: 7px auto 0;
            transform: rotate(45deg);
          "></div>
        </div>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 9px;
          color: #A7A7A7;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 3px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${truncName}</span>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [80, 48],
    iconAnchor: [40, 28],
    popupAnchor: [0, -28],
  });
}

// ── Stacked Project Pin: single teardrop + vertically stacked project labels ──
export function createStackedProjectPin(
  projects: { status: ProjectStatus; title: string }[],
  dimmed = false
): L.DivIcon {
  const primaryColor = PROJECT_STATUS_COLORS[projects[0].status] || "#8195B5";
  const opacity = dimmed ? 0.5 : 1;
  const count = projects.length;

  // Build stacked label lines — show up to 4 names, then "+N more"
  const maxLabels = 4;
  const labelLines = projects.slice(0, maxLabels).map((p) => {
    const color = PROJECT_STATUS_COLORS[p.status] || "#8195B5";
    const name = truncate(p.title, 16);
    return `<span style="
      display: flex; align-items: center; gap: 3px;
      font-family: 'Kosugi', sans-serif;
      font-size: 9px;
      color: #A7A7A7;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      line-height: 1.3;
    "><span style="
      width: 5px; height: 5px; border-radius: 50%;
      background: ${color}; flex-shrink: 0;
    "></span>${name}</span>`;
  }).join("");

  const moreLine = count > maxLabels
    ? `<span style="
        font-family: 'Kosugi', sans-serif;
        font-size: 8px; color: rgba(167,167,167,0.5);
        text-transform: uppercase; letter-spacing: 0.3px;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        line-height: 1.3;
      ">+${count - maxLabels} more</span>`
    : "";

  // Icon height scales with number of labels
  const labelCount = Math.min(count, maxLabels) + (count > maxLabels ? 1 : 0);
  const iconHeight = 32 + labelCount * 14;

  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--project-labeled" style="
        display: flex; flex-direction: column; align-items: center;
        opacity: ${opacity};
      ">
        <div style="position: relative;">
          <div style="
            width: 28px; height: 28px;
            background: ${primaryColor};
            border: 2px solid rgba(0,0,0,0.4);
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 0 12px ${primaryColor}4D;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
          ">
            <div style="
              width: 10px; height: 10px;
              background: white;
              border-radius: 50%;
              margin: 7px auto 0;
              transform: rotate(45deg);
            "></div>
          </div>
          <span style="
            position: absolute; top: -4px; right: -8px;
            background: rgba(10,10,10,0.9);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 50%;
            width: 16px; height: 16px;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Kosugi', sans-serif;
            font-size: 8px; color: #E5E5E5;
          ">${count}</span>
        </div>
        <div style="
          display: flex; flex-direction: column; align-items: flex-start;
          margin-top: 3px; gap: 0px;
        ">
          ${labelLines}
          ${moreLine}
        </div>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [100, iconHeight],
    iconAnchor: [50, 28],
    popupAnchor: [0, -28],
  });
}

// ── Task Pin (TODAY mode): circle with task color ring + task name + project sublabel ──
export function createTaskPinIcon(
  taskLabel: string,
  projectName: string,
  taskColor?: string,
  extraCount = 0
): L.DivIcon {
  const color = taskColor || "#8195B5";
  const displayLabel = extraCount > 0
    ? `${truncate(taskLabel, 12)} +${extraCount}`
    : truncate(taskLabel, 14);
  const truncProject = truncate(projectName, 16);

  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--task" style="
        display: flex; flex-direction: column; align-items: center;
      ">
        <div style="
          width: 20px; height: 20px;
          border: 2.5px solid ${color};
          border-radius: 50%;
          background: rgba(10,10,10,0.8);
          box-shadow: 0 0 8px ${color}33;
          transition: transform 0.15s ease;
        ">
          <div style="
            width: 7px; height: 7px;
            background: ${color};
            border-radius: 50%;
            margin: 4px auto 0;
          "></div>
        </div>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 9px;
          color: #E5E5E5;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 3px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${displayLabel}</span>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 8px;
          color: rgba(167,167,167,0.5);
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${truncProject}</span>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [80, 48],
    iconAnchor: [40, 10],
    popupAnchor: [0, -12],
  });
}

// ── Grouped Task Pin (TODAY mode): multiple projects at same location ──
// Shows a task circle with count badge + stacked project name labels
export function createGroupedTaskPinIcon(
  projectGroups: { projectName: string; taskCount: number; taskColor?: string }[]
): L.DivIcon {
  const totalTasks = projectGroups.reduce((sum, g) => sum + g.taskCount, 0);
  const primaryColor = projectGroups[0].taskColor || "#8195B5";

  // Build stacked project lines — show up to 3 projects
  const maxProjects = 3;
  const projectLines = projectGroups
    .slice(0, maxProjects)
    .map((g) => {
      const name = truncate(g.projectName, 16);
      const countLabel = g.taskCount > 1 ? ` (${g.taskCount})` : "";
      return `<span style="
        display: flex; align-items: center; gap: 3px;
        font-family: 'Kosugi', sans-serif;
        font-size: 8px;
        color: rgba(167,167,167,0.6);
        text-transform: uppercase;
        letter-spacing: 0.3px;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        line-height: 1.3;
      ">${name}${countLabel}</span>`;
    })
    .join("");

  const moreLine = projectGroups.length > maxProjects
    ? `<span style="
        font-family: 'Kosugi', sans-serif;
        font-size: 7px; color: rgba(167,167,167,0.4);
        text-transform: uppercase; letter-spacing: 0.3px;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        line-height: 1.3;
      ">+${projectGroups.length - maxProjects} more</span>`
    : "";

  const labelCount = Math.min(projectGroups.length, maxProjects) + (projectGroups.length > maxProjects ? 1 : 0);
  const iconHeight = 28 + labelCount * 12;

  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--task" style="
        display: flex; flex-direction: column; align-items: center;
      ">
        <div style="position: relative;">
          <div style="
            width: 20px; height: 20px;
            border: 2.5px solid ${primaryColor};
            border-radius: 50%;
            background: rgba(10,10,10,0.8);
            box-shadow: 0 0 8px ${primaryColor}33;
            transition: transform 0.15s ease;
          ">
            <div style="
              width: 7px; height: 7px;
              background: ${primaryColor};
              border-radius: 50%;
              margin: 4px auto 0;
            "></div>
          </div>
          <span style="
            position: absolute; top: -4px; right: -8px;
            background: rgba(10,10,10,0.9);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 50%;
            width: 14px; height: 14px;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Kosugi', sans-serif;
            font-size: 7px; color: #E5E5E5;
          ">${totalTasks}</span>
        </div>
        <div style="
          display: flex; flex-direction: column; align-items: center;
          margin-top: 3px; gap: 0px;
        ">
          ${projectLines}
          ${moreLine}
        </div>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [100, iconHeight],
    iconAnchor: [50, 10],
    popupAnchor: [0, -12],
  });
}

// ── Crew Pin: circle with status ring + initials + name label ──
const CREW_STATUS_COLORS: Record<CrewStatus, string> = {
  "on-site": "#A5B368",
  "en-route": "#C4A868",
  idle: "#8E8E93",
};

export function createCrewPinIcon(
  initials: string,
  firstName: string,
  status: CrewStatus = "idle"
): L.DivIcon {
  const ringColor = CREW_STATUS_COLORS[status];
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--crew" style="
        display: flex; flex-direction: column; align-items: center;
      ">
        <div style="
          width: 32px; height: 32px;
          border: 2.5px solid ${ringColor};
          border-radius: 50%;
          background: #191919;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 8px ${ringColor}33;
          transition: border-color 0.3s ease, transform 0.15s ease;
        ">
          <span style="
            font-family: 'Kosugi', sans-serif;
            font-size: 10px;
            color: #E5E5E5;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          ">${initials}</span>
        </div>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 9px;
          color: #A7A7A7;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 3px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${firstName}</span>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [60, 48],
    iconAnchor: [30, 16],
    popupAnchor: [0, -20],
  });
}

// ── Helpers ──
export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

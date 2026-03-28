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
function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

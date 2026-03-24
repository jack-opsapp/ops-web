"use client";

import { useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils/cn";
import type { Project } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS, ProjectStatus } from "@/lib/types/models";

// Fix Leaflet default marker icon path issue in bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ── Helpers ──
function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

// ── Single project pin: teardrop with status color ──
function createStatusIcon(status: ProjectStatus): L.DivIcon {
  const color = PROJECT_STATUS_COLORS[status] || "#417394";
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--project" style="
        width: 28px; height: 28px;
        background: ${color};
        border: 2px solid rgba(0,0,0,0.4);
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 0 8px ${color}80;
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

// ── Stacked project pin: single teardrop + vertically stacked project labels + count badge ──
function createStackedStatusIcon(
  projects: { status: ProjectStatus; title: string }[]
): L.DivIcon {
  const primaryColor = PROJECT_STATUS_COLORS[projects[0].status] || "#417394";
  const count = projects.length;

  // Build stacked label lines — show up to 4 names, then "+N more"
  const maxLabels = 4;
  const labelLines = projects
    .slice(0, maxLabels)
    .map((p) => {
      const color = PROJECT_STATUS_COLORS[p.status] || "#417394";
      const name = truncate(p.title, 18);
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
    })
    .join("");

  const moreLine =
    count > maxLabels
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

// ── Single project popup ──
function singleProjectPopupHtml(project: Project): string {
  const statusColor = PROJECT_STATUS_COLORS[project.status] || "#417394";
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

// ── Grouped project popup (multiple projects at same location) ──
function groupedProjectPopupHtml(projects: Project[]): string {
  const projectLines = projects
    .slice(0, 6)
    .map((p) => {
      const color = PROJECT_STATUS_COLORS[p.status] || "#417394";
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
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 180px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 10px; color: #666; font-family: 'Kosugi', sans-serif; margin-bottom: 6px; text-transform: uppercase;">${address}</div>
    ${projectLines}
    ${moreLine}
  </div>`;
}

const POPUP_OPTIONS = {
  className: "ops-map-popup",
  closeButton: false,
  maxWidth: 220,
  minWidth: 180,
} as const;

interface ProjectMapProps {
  projects: Project[];
  selectedProjectId?: string | null;
  onProjectSelect?: (project: Project) => void;
  className?: string;
}

export function ProjectMap({
  projects,
  selectedProjectId,
  onProjectSelect,
  className,
}: ProjectMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const mappableProjects = useMemo(
    () => projects.filter((p) => p.latitude != null && p.longitude != null && !p.deletedAt),
    [projects]
  );

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [39.8283, -98.5795], // Center of US
      zoom: 4,
      zoomControl: false,
      attributionControl: false,
    });

    // Dark map tiles (CartoDB dark)
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);

    // Custom zoom control position
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Attribution
    L.control
      .attribution({ position: "bottomleft", prefix: false })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>')
      .addTo(map);

    mapInstanceRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update markers when projects change — group by location to avoid overlapping pins
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;

    markers.clearLayers();

    if (mappableProjects.length === 0) return;

    // Group projects sharing the same coordinates to stack labels
    const locationGroups = new Map<string, Project[]>();
    for (const project of mappableProjects) {
      const key = `${project.latitude!.toFixed(6)},${project.longitude!.toFixed(6)}`;
      const group = locationGroups.get(key) ?? [];
      group.push(project);
      locationGroups.set(key, group);
    }

    const bounds: L.LatLngExpression[] = [];
    // Track which marker contains the selected project so we can open its popup
    let selectedMarker: L.Marker | null = null;

    for (const [_key, groupProjects] of locationGroups) {
      const lat = groupProjects[0].latitude!;
      const lng = groupProjects[0].longitude!;
      bounds.push([lat, lng]);

      if (groupProjects.length === 1) {
        // Single project at this location — standard pin
        const project = groupProjects[0];
        const icon = createStatusIcon(project.status);
        const marker = L.marker([lat, lng], { icon }).addTo(markers);
        marker.bindPopup(singleProjectPopupHtml(project), POPUP_OPTIONS);

        marker.on("click", () => {
          onProjectSelect?.(project);
        });

        if (project.id === selectedProjectId) {
          selectedMarker = marker;
        }
      } else {
        // Multiple projects at this location — stacked pin with count badge
        const icon = createStackedStatusIcon(
          groupProjects.map((p) => ({ status: p.status, title: p.title }))
        );
        const marker = L.marker([lat, lng], { icon }).addTo(markers);
        marker.bindPopup(groupedProjectPopupHtml(groupProjects), POPUP_OPTIONS);

        // Click selects the first project in the group
        marker.on("click", () => {
          onProjectSelect?.(groupProjects[0]);
        });

        if (groupProjects.some((p) => p.id === selectedProjectId)) {
          selectedMarker = marker;
        }
      }
    }

    // Open popup for selected project's marker
    if (selectedMarker) {
      selectedMarker.openPopup();
    }

    // Fit bounds with padding
    if (bounds.length > 0) {
      if (bounds.length === 1) {
        map.setView(bounds[0] as L.LatLngExpression, 14);
      } else {
        map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [50, 50] });
      }
    }
  }, [mappableProjects, selectedProjectId, onProjectSelect]);

  return (
    <div className={cn("relative w-full h-full", className)}>
      <div ref={mapRef} className="w-full h-full" />
      {/* Custom CSS overrides for dark theme */}
      <style jsx global>{`
        .ops-map-marker {
          background: transparent !important;
          border: none !important;
        }
        .ops-map-popup .leaflet-popup-content-wrapper {
          background: transparent;
          box-shadow: none;
          padding: 0;
          border-radius: 4px;
        }
        .ops-map-popup .leaflet-popup-content {
          margin: 0;
        }
        .ops-map-popup .leaflet-popup-tip {
          background: #111;
          border: 1px solid rgba(65, 115, 148, 0.25);
        }
        .leaflet-control-zoom a {
          background: #111 !important;
          color: #E5E5E5 !important;
          border-color: #333 !important;
        }
        .leaflet-control-zoom a:hover {
          background: #222 !important;
        }
      `}</style>
    </div>
  );
}

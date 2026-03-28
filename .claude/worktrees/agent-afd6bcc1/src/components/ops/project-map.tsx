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

function createStatusIcon(status: ProjectStatus): L.DivIcon {
  const color = PROJECT_STATUS_COLORS[status] || "#417394";
  return L.divIcon({
    html: `
      <div style="
        width: 28px; height: 28px;
        background: ${color};
        border: 2px solid rgba(0,0,0,0.4);
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 0 8px ${color}80;
      ">
        <div style="
          width: 10px; height: 10px;
          background: white;
          border-radius: 50%;
          margin: 7px auto 0;
        "></div>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

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

  // Update markers when projects change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;

    markers.clearLayers();

    if (mappableProjects.length === 0) return;

    const bounds: L.LatLngExpression[] = [];

    mappableProjects.forEach((project) => {
      const lat = project.latitude!;
      const lng = project.longitude!;
      bounds.push([lat, lng]);

      const icon = createStatusIcon(project.status);
      const marker = L.marker([lat, lng], { icon }).addTo(markers);

      // Popup content
      const statusColor = PROJECT_STATUS_COLORS[project.status] || "#417394";
      marker.bindPopup(
        `<div style="
          background: #111; color: #E5E5E5; padding: 8px 10px;
          border-radius: 4px; font-family: 'Mohave', sans-serif;
          min-width: 180px; border: 1px solid ${statusColor}40;
        ">
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">${project.title}</div>
          <div style="font-size: 11px; color: #999; margin-bottom: 6px;">${project.address || "No address"}</div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="
              display: inline-block; width: 8px; height: 8px;
              border-radius: 50%; background: ${statusColor};
              box-shadow: 0 0 4px ${statusColor};
            "></span>
            <span style="font-size: 11px; color: ${statusColor};">${project.status}</span>
          </div>
        </div>`,
        {
          className: "ops-map-popup",
          closeButton: false,
        }
      );

      marker.on("click", () => {
        onProjectSelect?.(project);
      });

      // Highlight selected
      if (project.id === selectedProjectId) {
        marker.openPopup();
      }
    });

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

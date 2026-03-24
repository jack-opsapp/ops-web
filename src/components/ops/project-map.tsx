"use client";

import { useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils/cn";
import type { Project } from "@/lib/types/models";
import { createProjectPinIcon, createStackedProjectPin } from "@/components/dashboard/map/pin-icons";
import {
  POPUP_OPTIONS,
  projectPopupHtml,
  groupedProjectPopupHtml,
} from "@/components/dashboard/map/pin-popups";

// Fix Leaflet default marker icon path issue in bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

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
        const icon = createProjectPinIcon(project.status);
        const marker = L.marker([lat, lng], { icon }).addTo(markers);
        marker.bindPopup(projectPopupHtml(project), POPUP_OPTIONS);

        marker.on("click", () => {
          onProjectSelect?.(project);
        });

        if (project.id === selectedProjectId) {
          selectedMarker = marker;
        }
      } else {
        // Multiple projects at this location — stacked pin with count badge
        const icon = createStackedProjectPin(
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

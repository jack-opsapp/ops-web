"use client";

/**
 * ProjectMapCanvas — the Mapbox GL surface for the Projects MAP view.
 *
 * Engine decision (P3.5, master plan §2 / cohesion audit §6): the standalone
 * /map page shipped on Leaflet, a *different* engine than the project
 * workspace window's Mapbox GL. This view unifies on Mapbox GL (react-map-gl)
 * so there is one engine, one pin language, and visual continuity into the
 * workspace window a pin click opens.
 *
 * Parity reproduced from the old Leaflet /map: dark canvas, status-colored
 * pins, location-grouped *stacked* pins with a count badge, fit-bounds on the
 * mappable set, custom zoom controls, a status legend. Upgrade: a pin click
 * opens the floating workspace window (the old page only highlighted).
 *
 * Honors the `mapDefaultZoom` preference for the single-pin / no-bounds case.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, type MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Minus, Plus, Crosshair } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { PROJECT_STATUS_COLORS, ProjectStatus, isActiveProjectStatus } from "@/lib/types/models";
import type { Project } from "@/lib/types/models";
import { ProjectMapPin } from "./project-map-pin";

const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
// Continent fallback view when nothing is mappable yet — the same neutral
// framing the Leaflet page used (center of North America).
const FALLBACK_CENTER = { latitude: 45.4, longitude: -98.5 } as const;
const FALLBACK_ZOOM = 3;
const FIT_PADDING = 64;
const FIT_DURATION = 720;

interface LocationGroup {
  key: string;
  latitude: number;
  longitude: number;
  projects: Project[];
}

function groupByLocation(projects: Project[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>();
  for (const p of projects) {
    if (p.latitude == null || p.longitude == null) continue;
    const key = `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.projects.push(p);
    } else {
      groups.set(key, { key, latitude: p.latitude, longitude: p.longitude, projects: [p] });
    }
  }
  return Array.from(groups.values());
}

interface ProjectMapCanvasProps {
  /** Already status/search-filtered; canvas plots only those with coordinates. */
  projects: Project[];
  selectedProjectId: string | null;
  /** Fires for pin click — the parent opens the workspace window + selects. */
  onPinClick: (project: Project) => void;
  /** Initial zoom for the single-pin case, from the mapDefaultZoom preference. */
  defaultZoom: number;
  reducedMotion: boolean;
}

export function ProjectMapCanvas({
  projects,
  selectedProjectId,
  onPinClick,
  defaultZoom,
  reducedMotion,
}: ProjectMapCanvasProps) {
  const { t } = useDictionary("projects-canvas");
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const mappable = useMemo(
    () => projects.filter((p) => p.latitude != null && p.longitude != null),
    [projects],
  );
  const groups = useMemo(() => groupByLocation(mappable), [mappable]);

  // Stable signature of the plotted set so fit-bounds only re-runs when the
  // actual coordinates change (filter / data change), not on every render.
  const boundsSignature = useMemo(
    () => groups.map((g) => g.key).sort().join("|"),
    [groups],
  );

  const fitToProjects = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (groups.length === 0) {
      map.flyTo({ center: [FALLBACK_CENTER.longitude, FALLBACK_CENTER.latitude], zoom: FALLBACK_ZOOM, duration: reducedMotion ? 0 : FIT_DURATION });
      return;
    }
    if (groups.length === 1) {
      map.flyTo({ center: [groups[0].longitude, groups[0].latitude], zoom: defaultZoom, duration: reducedMotion ? 0 : FIT_DURATION });
      return;
    }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const g of groups) {
      minLng = Math.min(minLng, g.longitude);
      maxLng = Math.max(maxLng, g.longitude);
      minLat = Math.min(minLat, g.latitude);
      maxLat = Math.max(maxLat, g.latitude);
    }
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: FIT_PADDING, duration: reducedMotion ? 0 : FIT_DURATION, maxZoom: 15 },
    );
  }, [groups, defaultZoom, reducedMotion]);

  // Refit whenever the plotted set changes.
  useEffect(() => {
    if (!boundsSignature) return;
    fitToProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsSignature]);

  // Fly to a newly-selected project (located from the drawer or another pin).
  useEffect(() => {
    if (!selectedProjectId) return;
    const target = mappable.find((p) => p.id === selectedProjectId);
    const map = mapRef.current;
    if (!target || !map || target.latitude == null || target.longitude == null) return;
    map.flyTo({
      center: [target.longitude, target.latitude],
      zoom: Math.max(map.getZoom(), defaultZoom),
      duration: reducedMotion ? 0 : FIT_DURATION,
    });
  }, [selectedProjectId, mappable, defaultZoom, reducedMotion]);

  if (!token) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--map-canvas-bg)" }}>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
          {t("map.tokenMissing")}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" style={{ background: "var(--map-canvas-bg)" }}>
      <MapGL
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={{ ...FALLBACK_CENTER, zoom: FALLBACK_ZOOM }}
        mapStyle={MAP_STYLE}
        attributionControl={false}
        onLoad={fitToProjects}
        reuseMaps
      >
        {groups.map((g) => {
          const primary = g.projects[0];
          const color = PROJECT_STATUS_COLORS[primary.status] ?? "#8F9AA3";
          const isSelected = g.projects.some((p) => p.id === selectedProjectId);
          const dimmed = g.projects.every((p) => !isActiveProjectStatus(p.status));
          const hovered = hoveredKey === g.key;
          return (
            <Marker
              key={g.key}
              latitude={g.latitude}
              longitude={g.longitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                onPinClick(primary);
              }}
            >
              <div
                className="relative cursor-pointer transition-transform duration-150 ease-smooth hover:scale-110"
                onMouseEnter={() => setHoveredKey(g.key)}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <ProjectMapPin
                  color={color}
                  selected={isSelected}
                  stackCount={g.projects.length}
                  dimmed={dimmed && !isSelected}
                  reducedMotion={reducedMotion}
                />
                {hovered && (
                  <div
                    className="glass-dense pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[5px] px-2 py-1 font-mono text-[11px] tracking-[0.06em] text-text"
                    style={{ bottom: 16 }}
                  >
                    {g.projects.length > 1
                      ? t("map.pinStackLabel").replace("{count}", String(g.projects.length))
                      : primary.title}
                  </div>
                )}
              </div>
            </Marker>
          );
        })}
      </MapGL>

      <MapStatusLegend />
      <MapZoomToolbar
        onZoomIn={() => mapRef.current?.zoomIn({ duration: reducedMotion ? 0 : 200 })}
        onZoomOut={() => mapRef.current?.zoomOut({ duration: reducedMotion ? 0 : 200 })}
        onRecenter={fitToProjects}
        zoomInLabel={t("map.toolbar.zoomIn")}
        zoomOutLabel={t("map.toolbar.zoomOut")}
        recenterLabel={t("map.toolbar.recenter")}
      />
    </div>
  );
}

// ─── Zoom / recenter toolbar (mirrors the workspace MapToolbar) ──────────────

function MapZoomToolbar({
  onZoomIn,
  onZoomOut,
  onRecenter,
  zoomInLabel,
  zoomOutLabel,
  recenterLabel,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  zoomInLabel: string;
  zoomOutLabel: string;
  recenterLabel: string;
}) {
  return (
    <div className="glass-dense absolute bottom-3 right-4 flex flex-col overflow-hidden rounded-[5px]">
      <ToolButton label={zoomInLabel} onClick={onZoomIn}><Plus className="h-[14px] w-[14px]" strokeWidth={1.5} /></ToolButton>
      <span className="mx-1.5 h-px bg-[var(--fill-neutral-dim)]" />
      <ToolButton label={zoomOutLabel} onClick={onZoomOut}><Minus className="h-[14px] w-[14px]" strokeWidth={1.5} /></ToolButton>
      <span className="mx-1.5 h-px bg-[var(--fill-neutral-dim)]" />
      <ToolButton label={recenterLabel} onClick={onRecenter}><Crosshair className="h-[14px] w-[14px]" strokeWidth={1.5} /></ToolButton>
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center text-text transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
    >
      {children}
    </button>
  );
}

// ─── Status legend (full 5-status ramp; glass-dense) ─────────────────────────

// Stable i18n key per status (ProjectStatus.InProgress's value has a space, so
// the enum value can't be a dotted key — slug it).
const LEGEND_STATUSES: { status: ProjectStatus; key: string }[] = [
  { status: ProjectStatus.RFQ, key: "rfq" },
  { status: ProjectStatus.Estimated, key: "estimated" },
  { status: ProjectStatus.Accepted, key: "accepted" },
  { status: ProjectStatus.InProgress, key: "inProgress" },
  { status: ProjectStatus.Completed, key: "completed" },
];

function MapStatusLegend() {
  const { t } = useDictionary("projects-canvas");
  return (
    <div className="glass-dense absolute bottom-3 left-3 rounded-[5px] p-2">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        {t("map.legend.title")}
      </div>
      <div className="flex flex-col gap-[3px]">
        {LEGEND_STATUSES.map((item) => (
          <div key={item.key} className="flex items-center gap-[7px]">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{ background: PROJECT_STATUS_COLORS[item.status] }}
            />
            <span className="font-mono text-[11px] text-text-3">
              {t(`map.legend.status.${item.key}`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

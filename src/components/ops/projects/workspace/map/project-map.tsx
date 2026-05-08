"use client";

import Map, { Marker } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useReducedMotion } from "framer-motion";

export interface OtherPin {
  id: string;
  latitude: number;
  longitude: number;
  color: string;
  label: string;
}

interface ProjectMapProps {
  latitude: number;
  longitude: number;
  pinColor: string;
  expanded: boolean;
  otherPins?: OtherPin[];
  onClick?: () => void;
}

const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const COMPACT_ZOOM = 14;
const EXPANDED_ZOOM = 13;
// Mapbox-specific dark canvas behind tile loads. There is no design-system
// token for "below the map surface" — this exists only to prevent a flash
// of the page background while tiles paint.
const MAP_CANVAS_BG = "#0a0d10";

export function ProjectMap({
  latitude,
  longitude,
  pinColor,
  expanded,
  otherPins = [],
  onClick,
}: ProjectMapProps) {
  const reducedMotion = useReducedMotion();
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!token) {
    return <MapTokenMissing />;
  }

  return (
    <div
      onClick={!expanded ? onClick : undefined}
      className={`relative h-full w-full overflow-hidden ${!expanded ? "cursor-zoom-in" : ""}`}
      style={{ background: MAP_CANVAS_BG }}
    >
      <Map
        mapboxAccessToken={token}
        initialViewState={{
          latitude,
          longitude,
          zoom: expanded ? EXPANDED_ZOOM : COMPACT_ZOOM,
        }}
        mapStyle={MAP_STYLE}
        attributionControl={expanded}
        interactive={expanded}
        dragPan={expanded}
        scrollZoom={expanded}
        doubleClickZoom={expanded}
        reuseMaps
      >
        <Marker latitude={latitude} longitude={longitude} anchor="center">
          <ProjectPin color={pinColor} animate={!reducedMotion} />
        </Marker>
        {expanded &&
          otherPins.map((p) => (
            <Marker key={p.id} latitude={p.latitude} longitude={p.longitude} anchor="center">
              <OtherProjectPin color={p.color} label={p.label} />
            </Marker>
          ))}
      </Map>
    </div>
  );
}

interface ProjectPinProps {
  color: string;
  animate: boolean;
}

function ProjectPin({ color, animate }: ProjectPinProps) {
  return (
    <div data-testid="project-pin" className="relative" aria-hidden="true">
      <div
        className={animate ? "animate-pin-pulse" : ""}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}55 0%, ${color}00 70%)`,
          position: "absolute",
          top: -14,
          left: -14,
        }}
      />
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 12px ${color}`,
          border: "2px solid var(--scrim-edge-stroke)",
          position: "absolute",
          top: -7,
          left: -7,
        }}
      />
      <div
        style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "var(--text)",
          position: "absolute",
          top: -2,
          left: -2,
        }}
      />
    </div>
  );
}

interface OtherProjectPinProps {
  color: string;
  label: string;
}

function OtherProjectPin({ color, label }: OtherProjectPinProps) {
  return (
    <div
      data-testid="other-project-pin"
      title={label}
      aria-label={label}
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}80`,
        border: "1px solid var(--scrim-edge-stroke)",
        opacity: 0.72,
      }}
    />
  );
}

function MapTokenMissing() {
  return (
    <div
      className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.18em]"
      style={{ background: MAP_CANVAS_BG, color: "var(--text-3)" }}
    >
      <span className="font-mono">// MAP UNAVAILABLE — NEXT_PUBLIC_MAPBOX_TOKEN MISSING</span>
    </div>
  );
}

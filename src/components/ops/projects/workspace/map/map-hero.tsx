"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ZoomIn,
  ZoomOut,
  Users,
  Layers,
  Crosshair,
  ChevronUp,
  Search,
  MapPin,
} from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { ProjectMap, type OtherPin } from "@/components/ops/projects/workspace/map/project-map";

// ─── Animation tokens ───────────────────────────────────────────────────────
// Single 280ms ease per CLAUDE.md — no spring, no bounce. Reduced-motion
// collapses to 0 duration so the layout snaps without easing.
const HERO_DURATION = 0.28;
const OVERLAY_DURATION = 0.18;
const COMPACT_HEIGHT = 220;

// ─── Visual tokens (per Phase 4 plan handoff) ───────────────────────────────
// The pill bg/border are intentionally NOT --glass — the handoff specifies a
// black-tinted glass over the map so address text reads against busy tiles.
const PILL_BG = "var(--scrim-window-shadow)";
const PILL_BORDER = "1px solid var(--line)";
const PILL_RADIUS = 5;
const OVERLAY_INSET = 14;
const TOOLBAR_TOP = 70;
// Mapbox-specific dark canvas — same value the ProjectMap paints so the
// height animation has no flash. Tokenized via --map-canvas-bg
// (cleanup 2026-05-07); scoped to the map surface only.
const MAP_CANVAS_BG = "var(--map-canvas-bg)";
const FADE_GRADIENT =
  "linear-gradient(180deg, transparent 0%, transparent 55%, var(--map-fade-mid) 80%, var(--map-fade-end) 100%)";

interface LegendCounts {
  accepted: number;
  completed: number;
  rfq: number;
}

interface MapHeroProps {
  latitude: number;
  longitude: number;
  address: string;
  /** Status hex used for pin glow + leading dots + address-pill icon. */
  statusColor: string;
  /** Uppercase label, e.g. "IN PROGRESS". */
  statusLabel: string;
  /** Display id for the expanded crumb, e.g. "PROJ-00247". */
  projectId: string;
  /** Display name for the expanded crumb, e.g. "Greenway Townhomes — Phase 2". */
  projectName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  otherPins?: OtherPin[];
  legend?: LegendCounts;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onShowCrew?: () => void;
  onShowLayers?: () => void;
  onRecenter?: () => void;
}

export function MapHero({
  latitude,
  longitude,
  address,
  statusColor,
  statusLabel,
  projectId,
  projectName,
  expanded,
  onToggleExpand,
  otherPins,
  legend,
  onZoomIn,
  onZoomOut,
  onShowCrew,
  onShowLayers,
  onRecenter,
}: MapHeroProps) {
  const reducedMotion = useReducedMotion();
  const heroTransition = reducedMotion
    ? { duration: 0 }
    : { duration: HERO_DURATION, ease: EASE_SMOOTH };
  const overlayTransition = reducedMotion
    ? { duration: 0 }
    : { duration: OVERLAY_DURATION, ease: EASE_SMOOTH };

  return (
    <motion.div
      data-testid="map-hero"
      data-expanded={expanded}
      initial={false}
      animate={{ height: expanded ? "100%" : COMPACT_HEIGHT }}
      transition={heroTransition}
      className="relative w-full overflow-hidden"
      style={{ background: MAP_CANVAS_BG }}
    >
      <div className="absolute inset-0">
        <ProjectMap
          latitude={latitude}
          longitude={longitude}
          pinColor={statusColor}
          expanded={expanded}
          otherPins={otherPins}
          onClick={!expanded ? onToggleExpand : undefined}
        />
      </div>

      {/* Bottom fade — compact only, anchors the address pill against busy map tiles. */}
      <AnimatePresence>
        {!expanded && (
          <motion.div
            key="fade"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={overlayTransition}
            className="pointer-events-none absolute inset-0"
            style={{ background: FADE_GRADIENT }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Top-left compact: status pill (status-only, no project info). */}
      <AnimatePresence>
        {!expanded && (
          <motion.div
            key="status-pill"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={overlayTransition}
            className="absolute"
            style={{ top: OVERLAY_INSET, left: OVERLAY_INSET }}
          >
            <MapStatusPill color={statusColor} label={statusLabel} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top-left expanded: project crumb pill — // {projectId} · {projectName} | address. */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="crumb"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={overlayTransition}
            className="absolute"
            style={{ top: OVERLAY_INSET, left: OVERLAY_INSET, maxWidth: "62%" }}
          >
            <MapProjectCrumb
              statusColor={statusColor}
              projectId={projectId}
              projectName={projectName}
              address={address}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top-right expanded: COLLAPSE chevron pill (replaces the X button). */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="collapse"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={overlayTransition}
            className="absolute"
            style={{ top: OVERLAY_INSET, right: OVERLAY_INSET }}
          >
            <MapCollapseButton onClick={onToggleExpand} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-right expanded: legend (moved from top-right per handoff). */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="legend"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ ...overlayTransition, delay: reducedMotion ? 0 : 0.04 }}
            className="absolute"
            style={{ bottom: OVERLAY_INSET, right: OVERLAY_INSET }}
          >
            <MapLegend
              statusColor={statusColor}
              counts={legend ?? { accepted: 0, completed: 0, rfq: 0 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left edge below crumb: vertical toolbar (moved from right-mid per handoff). */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="toolbar"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={overlayTransition}
            className="absolute"
            style={{ left: OVERLAY_INSET, top: TOOLBAR_TOP }}
          >
            <MapToolbar
              onZoomIn={onZoomIn}
              onZoomOut={onZoomOut}
              onShowCrew={onShowCrew}
              onShowLayers={onShowLayers}
              onRecenter={onRecenter}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-left compact: address pill with leading status-colored MapPin. */}
      <AnimatePresence>
        {!expanded && (
          <motion.div
            key="address"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={overlayTransition}
            className="absolute"
            style={{ bottom: OVERLAY_INSET, left: OVERLAY_INSET, maxWidth: "70%" }}
          >
            <MapAddressPill address={address} pinColor={statusColor} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-right compact: EXPAND MAP button. */}
      <AnimatePresence>
        {!expanded && (
          <motion.button
            key="expand-hint"
            type="button"
            data-testid="map-expand-hint"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={overlayTransition}
            onClick={onToggleExpand}
            className="absolute flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors"
            style={{
              bottom: OVERLAY_INSET,
              right: OVERLAY_INSET,
              color: "var(--text-2)",
              padding: "6px 8px",
              background: PILL_BG,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: PILL_BORDER,
              borderRadius: PILL_RADIUS,
            }}
          >
            <Search size={11} strokeWidth={1.5} aria-hidden="true" />
            <span>EXPAND MAP</span>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── MapAddressPill ─────────────────────────────────────────────────────────

function MapAddressPill({ address, pinColor }: { address: string; pinColor: string }) {
  return (
    <div
      data-testid="map-address-pill"
      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]"
      style={{
        color: "var(--text)",
        padding: "8px 10px",
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
      }}
    >
      <MapPin
        size={12}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: pinColor, flexShrink: 0 }}
      />
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {address}
      </span>
    </div>
  );
}

// ─── MapStatusPill ──────────────────────────────────────────────────────────

function MapStatusPill({ color, label }: { color: string; label: string }) {
  return (
    <div
      data-testid="map-status-pill"
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]"
      style={{
        // Status hex drives both the pill text and the dot — handoff spec.
        color,
        padding: "6px 10px",
        // Soft status background — 14% opacity behind the pill, color-only border.
        background: `${color}24`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: `1px solid ${color}66`,
        borderRadius: PILL_RADIUS,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}`,
          display: "inline-block",
        }}
      />
      <span>{label}</span>
    </div>
  );
}

// ─── MapProjectCrumb (expanded) ─────────────────────────────────────────────

function MapProjectCrumb({
  statusColor,
  projectId,
  projectName,
  address,
}: {
  statusColor: string;
  projectId: string;
  projectName: string;
  address: string;
}) {
  return (
    <div
      data-testid="map-project-crumb"
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]"
      style={{
        color: "var(--text)",
        padding: "8px 12px",
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
      }}
    >
      {/* Leading status dot — replaces the standalone status pill in expanded. */}
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: statusColor,
          boxShadow: `0 0 6px ${statusColor}`,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span data-testid="map-crumb-id" style={{ color: "var(--text-3)" }}>
        // {projectId}
      </span>
      <span style={{ color: "var(--text-mute)" }}>·</span>
      <span data-testid="map-crumb-name" style={{ color: "var(--text)" }}>
        {projectName}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 1,
          height: 12,
          background: "var(--fill-neutral)",
          margin: "0 4px",
        }}
      />
      <span
        data-testid="map-crumb-address"
        style={{
          color: "var(--text-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {address}
      </span>
    </div>
  );
}

// ─── MapCollapseButton (COLLAPSE chevron pill) ──────────────────────────────

function MapCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="map-collapse-button"
      onClick={onClick}
      aria-label="Collapse map"
      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors hover:bg-white/10"
      style={{
        color: "var(--text)",
        padding: "6px 10px",
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
      }}
    >
      <ChevronUp size={12} strokeWidth={1.5} aria-hidden="true" />
      <span>COLLAPSE</span>
    </button>
  );
}

// ─── MapToolbar ─────────────────────────────────────────────────────────────

interface ToolbarProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onShowCrew?: () => void;
  onShowLayers?: () => void;
  onRecenter?: () => void;
}

function MapToolbar({
  onZoomIn,
  onZoomOut,
  onShowCrew,
  onShowLayers,
  onRecenter,
}: ToolbarProps) {
  return (
    <div
      data-testid="map-toolbar"
      className="flex flex-col"
      style={{
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
        overflow: "hidden",
      }}
    >
      <ToolButton tool="zoom-in" label="Zoom in" onClick={onZoomIn} icon={<ZoomIn size={14} strokeWidth={1.5} />} />
      <ToolDivider />
      <ToolButton tool="zoom-out" label="Zoom out" onClick={onZoomOut} icon={<ZoomOut size={14} strokeWidth={1.5} />} />
      <ToolDivider />
      <ToolButton tool="crew" label="Show crew" onClick={onShowCrew} icon={<Users size={14} strokeWidth={1.5} />} />
      <ToolDivider />
      <ToolButton tool="layers" label="Toggle layers" onClick={onShowLayers} icon={<Layers size={14} strokeWidth={1.5} />} />
      <ToolDivider />
      <ToolButton tool="recenter" label="Recenter" onClick={onRecenter} icon={<Crosshair size={14} strokeWidth={1.5} />} />
    </div>
  );
}

function ToolButton({
  tool,
  label,
  onClick,
  icon,
}: {
  tool: string;
  label: string;
  onClick?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tool={tool}
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center transition-colors hover:bg-white/10"
      style={{ width: 32, height: 32, color: "var(--text)" }}
    >
      {icon}
    </button>
  );
}

function ToolDivider() {
  return (
    <div
      aria-hidden="true"
      style={{
        height: 1,
        background: "var(--fill-neutral-dim)",
        margin: "0 6px",
      }}
    />
  );
}

// ─── MapLegend ──────────────────────────────────────────────────────────────

function MapLegend({
  statusColor,
  counts,
}: {
  statusColor: string;
  counts: LegendCounts;
}) {
  return (
    <div
      data-testid="map-legend"
      className="font-mono text-[10px] uppercase tracking-[0.16em]"
      style={{
        color: "var(--text-2)",
        padding: "8px 10px",
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
        minWidth: 152,
      }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
          }}
        />
        <span style={{ color: "var(--text)" }}>// THIS PROJECT</span>
      </div>
      <LegendRow
        color={PROJECT_STATUS_COLORS[ProjectStatus.Accepted]}
        label="Accepted"
        count={counts.accepted}
      />
      <LegendRow
        color={PROJECT_STATUS_COLORS[ProjectStatus.Completed]}
        label="Completed"
        count={counts.completed}
      />
      <LegendRow
        color={PROJECT_STATUS_COLORS[ProjectStatus.RFQ]}
        label="RFQ"
        count={counts.rfq}
      />
    </div>
  );
}

function LegendRow({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: "2px 0" }}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: color,
            opacity: 0.85,
          }}
        />
        <span>{label}</span>
      </div>
      <span data-count={count} style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
    </div>
  );
}

"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ZoomIn,
  ZoomOut,
  Users,
  Layers,
  Crosshair,
  X,
  ArrowUpRight,
} from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { ProjectMap, type OtherPin } from "@/components/ops/projects/workspace/map/project-map";

// ─── Animation tokens ───────────────────────────────────────────────────────
// Single 280ms ease per CLAUDE.md — no spring, no bounce. Reduced-motion
// collapses to 0 duration so the layout snaps without easing.
const HERO_DURATION = 0.28;
const OVERLAY_DURATION = 0.18;
const COMPACT_HEIGHT = 220;

// ─── Visual tokens (per Phase 4 plan handoff) ───────────────────────────────
const PILL_BG = "rgba(0, 0, 0, 0.65)";
const PILL_BORDER = "1px solid rgba(255, 255, 255, 0.10)";
const PILL_RADIUS = 5;
const OVERLAY_INSET = 14;
const FADE_GRADIENT =
  "linear-gradient(180deg, transparent 0%, transparent 55%, rgba(20,20,20,0.55) 80%, rgba(20,20,20,0.95) 100%)";

interface LegendCounts {
  accepted: number;
  completed: number;
  rfq: number;
}

interface MapHeroProps {
  latitude: number;
  longitude: number;
  address: string;
  statusColor: string;
  statusLabel: string;
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
      style={{ background: "#0a0d10" }}
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

      {/* Top-left: status pill (always visible). */}
      <div
        className="absolute"
        style={{ top: OVERLAY_INSET, left: OVERLAY_INSET }}
      >
        <MapStatusPill color={statusColor} label={statusLabel} />
      </div>

      {/* Top-right: collapse button (expanded only). */}
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

      {/* Top-right (below collapse): legend (expanded only). */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="legend"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ ...overlayTransition, delay: reducedMotion ? 0 : 0.04 }}
            className="absolute"
            style={{ top: OVERLAY_INSET + 36, right: OVERLAY_INSET }}
          >
            <MapLegend
              statusColor={statusColor}
              counts={legend ?? { accepted: 0, completed: 0, rfq: 0 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right edge mid: toolbar (expanded only). */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="toolbar"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={overlayTransition}
            className="absolute"
            style={{
              right: OVERLAY_INSET,
              top: "50%",
              transform: "translateY(-50%)",
            }}
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

      {/* Bottom-left: address pill (always). */}
      <div
        className="absolute"
        style={{ bottom: OVERLAY_INSET, left: OVERLAY_INSET, maxWidth: "70%" }}
      >
        <MapAddressPill address={address} />
      </div>

      {/* Bottom-right: expand hint (compact only). */}
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
            className="absolute flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors hover:text-white"
            style={{
              bottom: OVERLAY_INSET,
              right: OVERLAY_INSET,
              color: "#B5B5B5",
              padding: "6px 8px",
              background: PILL_BG,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: PILL_BORDER,
              borderRadius: PILL_RADIUS,
            }}
          >
            <span>// EXPAND</span>
            <ArrowUpRight size={11} strokeWidth={1.5} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── MapAddressPill ─────────────────────────────────────────────────────────

function MapAddressPill({ address }: { address: string }) {
  return (
    <div
      data-testid="map-address-pill"
      className="font-mono text-[11px] uppercase tracking-[0.16em]"
      style={{
        color: "#EDEDED",
        padding: "8px 10px",
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {address}
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
        color: "#EDEDED",
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

// ─── MapCollapseButton ──────────────────────────────────────────────────────

function MapCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="map-collapse-button"
      onClick={onClick}
      aria-label="Collapse map"
      className="flex items-center justify-center transition-colors hover:bg-white/10"
      style={{
        width: 28,
        height: 28,
        background: PILL_BG,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: PILL_BORDER,
        borderRadius: PILL_RADIUS,
        color: "#EDEDED",
      }}
    >
      <X size={14} strokeWidth={1.5} />
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
      style={{ width: 32, height: 32, color: "#EDEDED" }}
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
        background: "rgba(255,255,255,0.06)",
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
        color: "#B5B5B5",
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
        <span style={{ color: "#EDEDED" }}>// THIS PROJECT</span>
      </div>
      <LegendRow color="#9DB582" label="Accepted" count={counts.accepted} />
      <LegendRow color="#B58289" label="Completed" count={counts.completed} />
      <LegendRow color="#8F9AA3" label="RFQ" count={counts.rfq} />
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
      <span data-count={count} style={{ color: "#EDEDED", fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
    </div>
  );
}

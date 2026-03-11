/* ── src/app/admin/_components/flow-galaxy/types.ts ── */

/* ── Colors ── */
export const HEALTH_COLORS = {
  healthy:  { r: 89, g: 119, b: 148 },   // #597794
  moderate: { r: 196, g: 168, b: 104 },  // #C4A868
  critical: { r: 147, g: 65, b: 55 },    // rgb(147,65,55)
} as const;

export const ACCENT = HEALTH_COLORS.healthy;
export const AMBER = HEALTH_COLORS.moderate;

/* ── Constants ── */
export const CAMERA_LERP = 0.06;
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4.0;
export const DEFAULT_ZOOM = 0.25;
export const STAR_COUNT = 800;
export const MAX_PARTICLES = 500;
export const MIN_RADIUS = 8;
export const MAX_RADIUS = 35;
export const GALAXY_RADIUS = 300;
export const RING_SPACING = 80;
export const MIN_NODE_SEPARATION = 60;
export const NODE_HIT_RADIUS = 28;
export const LANDING_CENTER = { x: -800, y: 0 };
export const APP_CENTER = { x: 800, y: 0 };

/* ── Zoom thresholds ── */
export const ZOOM_UNIVERSE = 0.3;
export const ZOOM_GALAXY = 1.0;
export const ZOOM_DETAIL = 2.5;
export const ZOOM_FADE_BAND = 0.2;

/* ── Camera ── */
export interface GalaxyCamera {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
}

/* ── Nodes ── */
export type GalaxyNodeType = 'entry' | 'page' | 'section' | 'element' | 'conversion' | 'dropoff' | 'retention';
export type HealthTier = 'healthy' | 'moderate' | 'critical';
export type GalaxyId = 'landing' | 'app';

export interface GalaxyNode {
  id: string;
  type: GalaxyNodeType;
  label: string;
  galaxyId: GalaxyId;
  wx: number;
  wy: number;
  dragOffsetX: number;
  dragOffsetY: number;
  views: number;
  avgDwellMs: number;
  clicks: number;
  clickBreakdown: { elementId: string; count: number }[];
  dropoffCount: number;
  dropoffRate: number;
  conversionRate: number;
  deviceBreakdown: { device: string; count: number }[];
  sparkline?: { label: string; value: number }[];
  radius: number;
  healthTier: HealthTier;
  glowRadius: number;
  isLive: boolean;
  parentId: string | null;
  children: GalaxyNode[];
  minZoom: number;
  maxZoom: number;
  depth: 0 | 1 | 2;
}

/* ── Edges ── */
export interface GalaxyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  count: number;
  isConversionPath: boolean;
  particleCount: number;
}

/* ── Particles ── */
export interface FlowParticle {
  edgeId: string;
  progress: number;
  speed: number;
  lateralOffset: number;
  color: { r: number; g: number; b: number };
  size: number;
  alpha: number;
}

export interface OrbitParticle {
  nodeId: string;
  angle: number;
  orbitRadius: number;
  speed: number;
  alpha: number;
}

export interface DropoffParticle {
  nodeId: string;
  angle: number;
  distance: number;
  maxDistance: number;
  speed: number;
  alpha: number;
}

/* ── Trace ── */
export interface TraceNodeMetric {
  reached: number;
  reachedPct: number;
  converted: number;
  convertedPct: number;
  droppedOff: number;
  droppedOffPct: number;
  avgDwellMs: number;
}

export interface TraceState {
  active: boolean;
  sourceNodeId: string;
  direction: 'downstream' | 'upstream';
  highlightedEdgeIds: Set<string>;
  highlightedNodeIds: Set<string>;
  nodeMetrics: Map<string, TraceNodeMetric>;
  edgeLabels: Map<string, { count: number; pct: number }>;
}

/* ── Context Menu ── */
export interface ContextMenuState {
  visible: boolean;
  screenX: number;
  screenY: number;
  nodeId: string;
  items: { label: string; action: () => void }[];
}

/* ── Galaxy Cluster ── */
export interface GalaxyCluster {
  id: GalaxyId;
  label: string;
  centerX: number;
  centerY: number;
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
}

/* ── Universe ── */
export interface UniverseData {
  galaxies: GalaxyCluster[];
  bridgeEdges: GalaxyEdge[];
}

/* ── Query params ── */
export interface GalaxyQueryParams {
  days: number;
  device: string;
}

/* ── Ambient star ── */
export interface AmbientStar {
  x: number;
  y: number;
  size: number;
  baseAlpha: number;
  phaseOffset: number;
  clusterIndex: number;
}

/* ── Helper fns ── */
export function computeRadius(views: number, maxViews: number): number {
  if (maxViews === 0) return MIN_RADIUS;
  const normalized = Math.sqrt(views / maxViews);
  return MIN_RADIUS + normalized * (MAX_RADIUS - MIN_RADIUS);
}

export function computeHealthTier(dropoffRate: number): HealthTier {
  if (dropoffRate < 0.25) return 'healthy';
  if (dropoffRate < 0.55) return 'moderate';
  return 'critical';
}

export function healthToColor(tier: HealthTier): { r: number; g: number; b: number } {
  return HEALTH_COLORS[tier];
}

export function worldToScreen(
  wx: number, wy: number,
  camera: GalaxyCamera,
  centerX: number, centerY: number,
): { sx: number; sy: number } {
  const sx = centerX + (wx - camera.x) * camera.zoom;
  const sy = centerY + (wy - camera.y) * camera.zoom;
  return { sx, sy };
}

export function screenToWorld(
  sx: number, sy: number,
  camera: GalaxyCamera,
  centerX: number, centerY: number,
): { wx: number; wy: number } {
  const wx = (sx - centerX) / camera.zoom + camera.x;
  const wy = (sy - centerY) / camera.zoom + camera.y;
  return { wx, wy };
}

export function zoomOpacity(currentZoom: number, minZoom: number, maxZoom: number): number {
  if (currentZoom < minZoom) {
    return Math.max(0, 1 - (minZoom - currentZoom) / ZOOM_FADE_BAND);
  }
  if (maxZoom !== Infinity && currentZoom > maxZoom) {
    return Math.max(0, 1 - (currentZoom - maxZoom) / ZOOM_FADE_BAND);
  }
  return 1;
}

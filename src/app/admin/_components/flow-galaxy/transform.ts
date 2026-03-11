/* ── src/app/admin/_components/flow-galaxy/transform.ts ── */

import type { FlowData, FlowNode } from '@/lib/admin/flow-types';
import type {
  GalaxyCluster, GalaxyNode, GalaxyEdge, UniverseData, GalaxyId,
} from './types';
import {
  computeRadius, computeHealthTier, healthToColor,
  GALAXY_RADIUS, RING_SPACING, MIN_NODE_SEPARATION,
  LANDING_CENTER, APP_CENTER, ZOOM_UNIVERSE, ZOOM_GALAXY, ZOOM_DETAIL,
  MAX_PARTICLES,
} from './types';

/* ── Layout helpers ── */

function layoutRing(
  nodes: GalaxyNode[],
  ringIndex: number,
  cx: number,
  cy: number,
) {
  if (nodes.length === 0) return;
  if (ringIndex === 0) {
    nodes[0].wx = cx;
    nodes[0].wy = cy;
    return;
  }
  const ringRadius = GALAXY_RADIUS - (ringIndex - 1) * RING_SPACING;
  const angleStep = (2 * Math.PI) / nodes.length;
  const angleOffset = ringIndex * 0.3;
  nodes.forEach((node, i) => {
    const angle = angleOffset + i * angleStep;
    node.wx = cx + Math.cos(angle) * ringRadius;
    node.wy = cy + Math.sin(angle) * ringRadius;
  });
}

function layoutSubNodes(parent: GalaxyNode) {
  const children = parent.children;
  if (children.length === 0) return;
  const dist = parent.radius * 2.5 + 20;
  const angleStep = (2 * Math.PI) / children.length;
  children.forEach((child, i) => {
    const angle = i * angleStep - Math.PI / 2;
    child.wx = parent.wx + Math.cos(angle) * dist;
    child.wy = parent.wy + Math.sin(angle) * dist;
    // Recurse for depth-2 children
    if (child.children.length > 0) {
      const subDist = child.radius * 2.0 + 12;
      const subStep = (2 * Math.PI) / child.children.length;
      child.children.forEach((grandchild, j) => {
        const subAngle = j * subStep - Math.PI / 2;
        grandchild.wx = child.wx + Math.cos(subAngle) * subDist;
        grandchild.wy = child.wy + Math.sin(subAngle) * subDist;
      });
    }
  });
}

/* ── FlowNode → GalaxyNode ── */

function makeGalaxyNode(
  fn: FlowNode,
  galaxyId: GalaxyId,
  maxViews: number,
  depth: 0 | 1 | 2,
  parentId: string | null,
): GalaxyNode {
  const radius = computeRadius(fn.views, maxViews);
  const healthTier = computeHealthTier(fn.dropoffRate);
  const dwellScore = Math.min(1, fn.avgDwellMs / 10000);

  const nodeType = fn.type === 'entry' ? 'entry'
    : fn.type === 'conversion' ? 'conversion'
    : depth === 0 ? 'page'
    : depth === 1 ? 'section'
    : 'element';

  return {
    id: `${galaxyId}:${fn.id}`,
    type: nodeType,
    label: fn.label,
    galaxyId,
    wx: 0, wy: 0,
    dragOffsetX: 0, dragOffsetY: 0,
    views: fn.views,
    avgDwellMs: fn.avgDwellMs,
    clicks: fn.clicks,
    clickBreakdown: fn.clickBreakdown,
    dropoffCount: fn.dropoffCount,
    dropoffRate: fn.dropoffRate,
    conversionRate: fn.conversionRate,
    deviceBreakdown: fn.deviceBreakdown,
    sparkline: undefined,
    radius,
    healthTier,
    glowRadius: radius * (2 + dwellScore * 2),
    isLive: false,
    parentId,
    children: [],
    minZoom: depth === 0 ? 0 : depth === 1 ? ZOOM_GALAXY : ZOOM_DETAIL,
    maxZoom: Infinity,
    depth,
  };
}

/* ── Build sub-nodes from click breakdown ── */

function buildSubNodes(
  parent: GalaxyNode,
  galaxyId: GalaxyId,
): GalaxyNode[] {
  if (parent.clickBreakdown.length === 0) return [];
  const maxClicks = Math.max(1, ...parent.clickBreakdown.map(c => c.count));

  return parent.clickBreakdown.slice(0, 8).map(cb => {
    const radius = computeRadius(cb.count, maxClicks) * 0.6;
    const child: GalaxyNode = {
      id: `${galaxyId}:${parent.id}:${cb.elementId}`,
      type: 'element',
      label: cb.elementId.replace(/-/g, ' '),
      galaxyId,
      wx: 0, wy: 0,
      dragOffsetX: 0, dragOffsetY: 0,
      views: cb.count,
      avgDwellMs: 0,
      clicks: cb.count,
      clickBreakdown: [],
      dropoffCount: 0,
      dropoffRate: 0,
      conversionRate: 0,
      deviceBreakdown: [],
      sparkline: undefined,
      radius,
      healthTier: 'healthy',
      glowRadius: radius * 2,
      isLive: false,
      parentId: parent.id,
      children: [],
      minZoom: ZOOM_DETAIL,
      maxZoom: Infinity,
      depth: 2,
    };
    return child;
  });
}

/* ── Transform FlowData → GalaxyCluster ── */

export function transformFlowData(
  data: FlowData,
  galaxyId: GalaxyId,
): GalaxyCluster {
  const center = galaxyId === 'landing' ? LANDING_CENTER : APP_CENTER;
  const label = galaxyId === 'landing' ? 'LANDING PAGE' : 'APP USAGE';

  const maxViews = Math.max(1, ...data.nodes.map(n => n.views));

  // Build galaxy nodes
  const allNodes: GalaxyNode[] = [];
  const centerNodes: GalaxyNode[] = [];
  const ringNodes: GalaxyNode[] = [];

  for (const fn of data.nodes) {
    const gn = makeGalaxyNode(fn, galaxyId, maxViews, 0, null);

    // Build children from click breakdown
    const subs = buildSubNodes(gn, galaxyId);
    gn.children = subs;

    if (fn.type === 'entry' || fn.type === 'conversion') {
      centerNodes.push(gn);
    } else {
      ringNodes.push(gn);
    }
    allNodes.push(gn, ...subs);
  }

  // Sort ring nodes by views desc for layout
  ringNodes.sort((a, b) => b.views - a.views);

  // Layout: center node(s) at ring 0, main pages at ring 1, overflow at ring 2
  if (centerNodes.length > 0) {
    layoutRing(centerNodes, 0, center.x, center.y);
    // If there's an entry AND conversion, offset them
    if (centerNodes.length >= 2) {
      centerNodes[0].wx = center.x - 80;
      centerNodes[1].wx = center.x + 80;
    }
  }

  const ring1 = ringNodes.slice(0, 6);
  const ring2 = ringNodes.slice(6);
  layoutRing(ring1, 1, center.x, center.y);
  if (ring2.length > 0) layoutRing(ring2, 2, center.x, center.y);

  // Layout sub-nodes for each page node
  for (const node of [...centerNodes, ...ringNodes]) {
    layoutSubNodes(node);
  }

  // Build edges
  const maxEdgeCount = Math.max(1, ...data.edges.map(e => e.count));
  const edges: GalaxyEdge[] = data.edges.map(e => ({
    id: `${galaxyId}:${e.source}->${e.target}`,
    sourceId: `${galaxyId}:${e.source}`,
    targetId: `${galaxyId}:${e.target}`,
    count: e.count,
    isConversionPath: e.isConversionPath,
    particleCount: Math.max(2, Math.round((e.count / maxEdgeCount) * 30)),
  }));

  return {
    id: galaxyId,
    label,
    centerX: center.x,
    centerY: center.y,
    nodes: allNodes,
    edges,
  };
}

/* ── Build full universe from both data sources ── */

export function buildUniverse(
  landingData: FlowData | null,
  appData: FlowData | null,
): UniverseData {
  const galaxies: GalaxyCluster[] = [];

  if (landingData && landingData.nodes.length > 0) {
    galaxies.push(transformFlowData(landingData, 'landing'));
  } else {
    // Empty placeholder galaxy
    galaxies.push({
      id: 'landing',
      label: 'LANDING PAGE',
      centerX: LANDING_CENTER.x,
      centerY: LANDING_CENTER.y,
      nodes: [],
      edges: [],
    });
  }

  if (appData && appData.nodes.length > 0) {
    galaxies.push(transformFlowData(appData, 'app'));
  } else {
    galaxies.push({
      id: 'app',
      label: 'APP USAGE',
      centerX: APP_CENTER.x,
      centerY: APP_CENTER.y,
      nodes: [],
      edges: [],
    });
  }

  // Bridge edges: landing conversion → app entry
  const bridgeEdges: GalaxyEdge[] = [];
  const landingConv = galaxies[0]?.nodes.find(n => n.type === 'conversion');
  const appEntry = galaxies[1]?.nodes.find(n => n.type === 'entry' || n.type === 'page');
  if (landingConv && appEntry) {
    bridgeEdges.push({
      id: 'bridge:landing->app',
      sourceId: landingConv.id,
      targetId: appEntry.id,
      count: landingConv.views,
      isConversionPath: true,
      particleCount: Math.min(20, Math.max(2, Math.round(landingConv.views / 10))),
    });
  }

  return { galaxies, bridgeEdges };
}

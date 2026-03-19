"use client";

// ---------------------------------------------------------------------------
// GalaxyEdges — connection lines between entity nodes in the Intel galaxy.
// Runs INSIDE a <Canvas> context (React Three Fiber component).
//
// Edges are NEVER visible by default. They only appear when a node is
// hovered or selected — and only at focus levels 2+ (not the overview).
// This keeps the overview clean and makes connections a discovery mechanic.
//
// Uses live node positions (updated per-frame by GalaxyNodes) so edge
// endpoints track the ambient drift animation.
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";
import type { PositionedNode } from "./galaxy-layout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_OPACITY = 0.12;
const EDGE_COLOR = "#ffffff";
const MAX_EDGES_LOW_END = 50;
const MAX_EDGES_STANDARD = 200;

const isLowEnd =
  typeof navigator !== "undefined" &&
  navigator.hardwareConcurrency <= 4;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GalaxyEdgesProps {
  edges: Array<{ sourceId: string; targetId: string; predicate: string }>;
  nodes: PositionedNode[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyEdges({ edges, nodes }: GalaxyEdgesProps) {
  const lineRef = useRef<THREE.BufferGeometry>(null);

  const selectedNodeId = useIntelStore((s) => s.selectedNodeId);
  const hoveredNodeId = useIntelStore((s) => s.hoveredNodeId);
  const focusLevel = useIntelStore((s) => s.focusLevel);
  const focusedClientId = useIntelStore((s) => s.focusedClientId);
  const focusedProjectId = useIntelStore((s) => s.focusedProjectId);

  const maxEdges = isLowEnd ? MAX_EDGES_LOW_END : MAX_EDGES_STANDARD;

  // Build position lookup from nodes
  const positionMap = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const node of nodes) {
      if (node.visible) {
        map.set(node.entityId, new THREE.Vector3(...node.position));
      }
    }
    return map;
  }, [nodes]);

  // Pre-allocate line buffer
  const linePositions = useMemo(
    () => new Float32Array(maxEdges * 6),
    [maxEdges]
  );

  useFrame(() => {
    if (!lineRef.current) return;

    // Level 1: no edges (clean overview)
    if (focusLevel === 1) {
      lineRef.current.setDrawRange(0, 0);
      return;
    }

    // At L2: always show focused client's edges + org→client line.
    // At L3: always show focused project's edges.
    // Hover/selection adds additional edges on top.
    const focusEntityId = focusLevel === 2 ? focusedClientId
      : focusLevel === 3 ? focusedProjectId
      : null;
    const activeNodeId = selectedNodeId || hoveredNodeId;

    if (!focusEntityId && !activeNodeId) {
      lineRef.current.setDrawRange(0, 0);
      return;
    }

    let lineIndex = 0;

    // ── Synthetic edges (not in API data) ────────────────────────────
    // These relationships exist structurally but aren't in the edge array.

    // Org center (0,0,0) → focused client
    if (focusLevel >= 2 && focusedClientId && lineIndex < maxEdges) {
      const clientPos = liveNodePositions.get(focusedClientId) ?? positionMap.get(focusedClientId);
      if (clientPos) {
        const base = lineIndex * 6;
        linePositions[base] = 0;
        linePositions[base + 1] = 0;
        linePositions[base + 2] = 0;
        const cx = "x" in clientPos ? clientPos.x : (clientPos as THREE.Vector3).x;
        const cy = "y" in clientPos ? clientPos.y : (clientPos as THREE.Vector3).y;
        const cz = "z" in clientPos ? clientPos.z : (clientPos as THREE.Vector3).z;
        linePositions[base + 3] = cx;
        linePositions[base + 4] = cy;
        linePositions[base + 5] = cz;
        lineIndex++;
      }
    }

    // Focused project → each task/team/financial node orbiting it
    if (focusLevel === 3 && focusedProjectId && lineIndex < maxEdges) {
      const projPos = liveNodePositions.get(focusedProjectId) ?? positionMap.get(focusedProjectId);
      if (projPos) {
        const px = "x" in projPos ? projPos.x : (projPos as THREE.Vector3).x;
        const py = "y" in projPos ? projPos.y : (projPos as THREE.Vector3).y;
        const pz = "z" in projPos ? projPos.z : (projPos as THREE.Vector3).z;

        for (const node of nodes) {
          if (lineIndex >= maxEdges) break;
          // Draw lines to tasks, team members, and financial entities
          if (node.nodeType === "task" || node.nodeType === "team" || node.nodeType === "financial") {
            if (!node.visible) continue;
            const nPos = liveNodePositions.get(node.entityId);
            const nx = nPos ? nPos.x : node.position[0];
            const ny = nPos ? nPos.y : node.position[1];
            const nz = nPos ? nPos.z : node.position[2];

            const base = lineIndex * 6;
            linePositions[base] = px;
            linePositions[base + 1] = py;
            linePositions[base + 2] = pz;
            linePositions[base + 3] = nx;
            linePositions[base + 4] = ny;
            linePositions[base + 5] = nz;
            lineIndex++;
          }
        }
      }
    }

    for (let i = 0; i < edges.length && lineIndex < maxEdges; i++) {
      const edge = edges[i];

      // Show edge if connected to the focused entity OR the hovered/selected node
      const isFocusEdge = focusEntityId && (focusEntityId === edge.sourceId || focusEntityId === edge.targetId);
      const isActiveEdge = activeNodeId && (activeNodeId === edge.sourceId || activeNodeId === edge.targetId);
      if (!isFocusEdge && !isActiveEdge) continue;

      // Use live positions (includes drift), fall back to static layout
      const liveSrc = liveNodePositions.get(edge.sourceId);
      const liveTgt = liveNodePositions.get(edge.targetId);
      const sourcePos = liveSrc ?? positionMap.get(edge.sourceId);
      const targetPos = liveTgt ?? positionMap.get(edge.targetId);

      if (!sourcePos || !targetPos) continue;

      const base = lineIndex * 6;
      const sx = "x" in sourcePos ? sourcePos.x : (sourcePos as THREE.Vector3).x;
      const sy = "y" in sourcePos ? sourcePos.y : (sourcePos as THREE.Vector3).y;
      const sz = "z" in sourcePos ? sourcePos.z : (sourcePos as THREE.Vector3).z;
      const tx = "x" in targetPos ? targetPos.x : (targetPos as THREE.Vector3).x;
      const ty = "y" in targetPos ? targetPos.y : (targetPos as THREE.Vector3).y;
      const tz = "z" in targetPos ? targetPos.z : (targetPos as THREE.Vector3).z;

      linePositions[base] = sx;
      linePositions[base + 1] = sy;
      linePositions[base + 2] = sz;
      linePositions[base + 3] = tx;
      linePositions[base + 4] = ty;
      linePositions[base + 5] = tz;

      lineIndex++;
    }

    const posAttr = lineRef.current.getAttribute("position") as THREE.BufferAttribute;
    if (posAttr) {
      posAttr.set(linePositions);
      posAttr.needsUpdate = true;
    }
    lineRef.current.setDrawRange(0, lineIndex * 2);
  });

  if (edges.length === 0) return null;

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={lineRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[linePositions, 3]}
          count={maxEdges * 2}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color={EDGE_COLOR}
        transparent
        opacity={EDGE_OPACITY}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}

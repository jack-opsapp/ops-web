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

    const activeNodeId = selectedNodeId || hoveredNodeId;

    // No active node: no edges
    if (!activeNodeId) {
      lineRef.current.setDrawRange(0, 0);
      return;
    }

    let lineIndex = 0;

    for (let i = 0; i < edges.length && lineIndex < maxEdges; i++) {
      const edge = edges[i];

      // Only show edges connected to the active (hovered/selected) node
      if (activeNodeId !== edge.sourceId && activeNodeId !== edge.targetId) continue;

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

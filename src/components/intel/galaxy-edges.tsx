"use client";

// ---------------------------------------------------------------------------
// GalaxyEdges — proximity-revealed connection lines between entity nodes.
//
// Edges are invisible by default. As the camera moves close to a region or a
// node is hovered/selected, edges connected to nearby nodes fade in. This is
// the radar-sweep metaphor — connections reveal on inspection, keeping the
// overview clean.
//
// Performance: only edges near the camera or the selected node are evaluated
// per frame. Distant edges are skipped entirely (no position buffer writes).
// The line geometry is pre-allocated at max capacity and draw range is adjusted
// each frame.
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PositionedEntity } from "./galaxy-layout";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Proximity threshold: edges fade in when the camera's XY projection is
// within this distance of either endpoint node. We project camera → XY
// because the camera sits at Z=20 by default — using raw 3D distance would
// mean all nodes are 20+ units away and no edges would ever reveal.
// Reduced from 6 → 3. With 335 entities, 6 was revealing almost all edges
// simultaneously. 3 reveals only the immediate neighborhood of the camera's
// focus point — about one cluster's worth of connections.
const REVEAL_DISTANCE = 3;

// Selected node: all its edges are visible regardless of camera distance.
// This provides full relationship context on click.

// Edge visual: ultra-thin, low opacity when revealed. The design spec says
// 0.08 default, 0.3 when revealed near camera.
const EDGE_OPACITY_MAX = 0.25;

// Line color: white with low opacity, not cluster-colored. This prevents
// visual confusion when edges cross cluster boundaries.
const EDGE_COLOR = "#ffffff";

// Max edges to process per frame on low-end devices
const MAX_EDGES_LOW_END = 50;
const MAX_EDGES_STANDARD = 200;

// ---------------------------------------------------------------------------
// Device detection
// ---------------------------------------------------------------------------
const isLowEnd =
  typeof navigator !== "undefined" &&
  navigator.hardwareConcurrency <= 4;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GalaxyEdgesProps {
  edges: Array<{ sourceId: string; targetId: string; predicate: string }>;
  positionedEntities: PositionedEntity[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyEdges({ edges, positionedEntities }: GalaxyEdgesProps) {
  const lineRef = useRef<THREE.BufferGeometry>(null);
  const { camera } = useThree();

  const selectedNodeId = useIntelStore((s) => s.selectedNodeId);
  const hoveredNodeId = useIntelStore((s) => s.hoveredNodeId);

  const maxEdges = isLowEnd ? MAX_EDGES_LOW_END : MAX_EDGES_STANDARD;

  // Build a position lookup from entity ID → world position
  const positionMap = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const pe of positionedEntities) {
      map.set(pe.entityId, new THREE.Vector3(...pe.position));
    }
    return map;
  }, [positionedEntities]);

  // Pre-allocate line buffer at max capacity.
  // Each edge needs 2 vertices × 3 floats = 6 floats.
  const linePositions = useMemo(
    () => new Float32Array(maxEdges * 6),
    [maxEdges]
  );

  // Temp vectors for distance calculations (avoids allocation per frame)
  const cameraXY = useMemo(() => new THREE.Vector2(), []);
  const nodeXY = useMemo(() => new THREE.Vector2(), []);

  useFrame(() => {
    if (!lineRef.current) return;

    const cameraPos = camera.position;
    const activeNodeId = selectedNodeId || hoveredNodeId;
    let lineIndex = 0;

    for (let i = 0; i < edges.length && lineIndex < maxEdges; i++) {
      const edge = edges[i];
      // Prefer live (drifted) positions from the nodes' per-frame update.
      // Fall back to static layout positions if live aren't available yet.
      const liveSrc = liveNodePositions.get(edge.sourceId);
      const liveTgt = liveNodePositions.get(edge.targetId);
      const sourcePos = liveSrc
        ? { x: liveSrc.x, y: liveSrc.y, z: liveSrc.z, distanceTo: (v: THREE.Vector3) => Math.sqrt((liveSrc.x - v.x) ** 2 + (liveSrc.y - v.y) ** 2 + (liveSrc.z - v.z) ** 2) }
        : positionMap.get(edge.sourceId);
      const targetPos = liveTgt
        ? { x: liveTgt.x, y: liveTgt.y, z: liveTgt.z, distanceTo: (v: THREE.Vector3) => Math.sqrt((liveTgt.x - v.x) ** 2 + (liveTgt.y - v.y) ** 2 + (liveTgt.z - v.z) ** 2) }
        : positionMap.get(edge.targetId);

      if (!sourcePos || !targetPos) continue;

      // Determine if this edge should be visible:
      // 1. Selected/hovered node: show all its edges
      // 2. Camera proximity: show edges where either endpoint is near camera
      const isActiveEdge =
        activeNodeId === edge.sourceId || activeNodeId === edge.targetId;

      if (!isActiveEdge) {
        // Camera proximity check — XY-projected distance from camera to EITHER
        // endpoint. We project to XY because the camera sits at Z=20 by default;
        // using raw 3D distance would make all nodes 20+ units away, preventing
        // any edge from revealing via proximity. XY distance accurately reflects
        // what the user is "looking at" regardless of zoom level on the Z axis.
        cameraXY.set(cameraPos.x, cameraPos.y);
        nodeXY.set(sourcePos.x as number, sourcePos.y as number);
        const distToSource = nodeXY.distanceTo(cameraXY);
        nodeXY.set(targetPos.x as number, targetPos.y as number);
        const distToTarget = nodeXY.distanceTo(cameraXY);

        if (Math.min(distToSource, distToTarget) > REVEAL_DISTANCE) continue;
      }

      // Write positions to buffer
      const base = lineIndex * 6;
      linePositions[base] = sourcePos.x;
      linePositions[base + 1] = sourcePos.y;
      linePositions[base + 2] = sourcePos.z;
      linePositions[base + 3] = targetPos.x;
      linePositions[base + 4] = targetPos.y;
      linePositions[base + 5] = targetPos.z;

      lineIndex++;
    }

    // Update the geometry buffer and draw range
    const posAttr = lineRef.current.getAttribute("position") as THREE.BufferAttribute;
    if (posAttr) {
      posAttr.set(linePositions);
      posAttr.needsUpdate = true;
    }
    // Draw range: only render the edges we wrote this frame
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
        opacity={EDGE_OPACITY_MAX}
        // Additive blending: edges where multiple connections overlap
        // brighten subtly — denser regions appear as soft webs of light.
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}

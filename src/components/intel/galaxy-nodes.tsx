"use client";

// ---------------------------------------------------------------------------
// GalaxyNodes — instanced point-sprite rendering for all entity nodes.
// Runs INSIDE a <Canvas> context (React Three Fiber component).
//
// One InstancedMesh per cluster (for color differentiation). Each node is a
// small sphere with emissive glow. The glow intensity maps to entity confidence.
// Nodes drift slowly on a sine wave to feel alive.
//
// Performance: InstancedMesh renders all nodes of a cluster in a single draw
// call, regardless of count. 500 client nodes = 1 draw call.
// ---------------------------------------------------------------------------

import { useRef, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { CLUSTER_COLORS, type PositionedEntity } from "./galaxy-layout";
import { useIntelStore } from "@/stores/intel-store";

// ---------------------------------------------------------------------------
// Reduced motion — read once at module level (SSR-safe)
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Node sphere radius. Small and uniform — these are points of light, not UI
// elements. 0.06 world units is approximately 3-4px on screen at default zoom.
const NODE_RADIUS = 0.06;
const NODE_SEGMENTS = 8; // Low poly is fine — nodes are tiny

// Ambient drift: slow sine oscillation to feel alive without being distracting.
// Amplitude 0.08 units, frequency varies per node (seeded by index).
const DRIFT_AMPLITUDE = 0.08;

// Hover brightness boost: 30% increase in emissive intensity
const HOVER_EMISSIVE_BOOST = 0.3;

// New entity starting opacity during activation
const NEW_ENTITY_DIM_OPACITY = 0.05;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GalaxyNodesProps {
  positionedEntities: PositionedEntity[];
  entities: Array<{ id: string; name: string; type: string; cluster: string }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyNodes({ positionedEntities, entities }: GalaxyNodesProps) {
  // Group positioned entities by cluster for instanced rendering
  const clusterGroups = useMemo(() => {
    // Build entity lookup map first: O(n) instead of O(n*m) with .find()
    const entityLookup = new Map<string, { name: string; type: string }>();
    for (const e of entities) {
      entityLookup.set(e.id, { name: e.name, type: e.type });
    }

    const groups = new Map<string, { positions: PositionedEntity[]; entityMap: Map<string, { name: string; type: string }> }>();

    for (const pe of positionedEntities) {
      if (!groups.has(pe.cluster)) {
        groups.set(pe.cluster, { positions: [], entityMap: new Map() });
      }
      const group = groups.get(pe.cluster)!;
      group.positions.push(pe);

      const entity = entityLookup.get(pe.entityId);
      if (entity) {
        group.entityMap.set(pe.entityId, entity);
      }
    }

    return groups;
  }, [positionedEntities, entities]);

  return (
    <>
      {Array.from(clusterGroups.entries()).map(([cluster, group]) => (
        <ClusterInstanceGroup
          key={cluster}
          cluster={cluster}
          color={CLUSTER_COLORS[cluster] || "#8E8E93"}
          positions={group.positions}
          entityMap={group.entityMap}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// ClusterInstanceGroup — one InstancedMesh per cluster
// ---------------------------------------------------------------------------

interface ClusterInstanceGroupProps {
  cluster: string;
  color: string;
  positions: PositionedEntity[];
  entityMap: Map<string, { name: string; type: string }>;
}

function ClusterInstanceGroup({ cluster, color, positions, entityMap }: ClusterInstanceGroupProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { camera } = useThree();

  // Store
  const visibleClusters = useIntelStore((s) => s.visibleClusters);
  const hoveredNodeId = useIntelStore((s) => s.hoveredNodeId);
  const selectedNodeId = useIntelStore((s) => s.selectedNodeId);
  const newEntityIds = useIntelStore((s) => s.newEntityIds);
  const activationPlaying = useIntelStore((s) => s.activationPlaying);
  const setHoveredNode = useIntelStore((s) => s.setHoveredNode);
  const selectNode = useIntelStore((s) => s.selectNode);
  const searchResults = useIntelStore((s) => s.searchResults);
  const searchQuery = useIntelStore((s) => s.searchQuery);

  const isVisible = visibleClusters.has(cluster);

  // Three.js color object (cached)
  const threeColor = useMemo(() => new THREE.Color(color), [color]);

  // Activation start time: captured when activationPlaying transitions to true.
  // All activation animation math uses (t - activationStartTime) for correct
  // relative timing, regardless of when the Canvas clock started.
  const activationStartTime = useRef<number | null>(null);

  // Pre-allocated working color to avoid GC pressure from Color.clone().
  // Without this, 200 nodes at 60fps = 12,000 Color allocations/sec per cluster.
  const workingColor = useMemo(() => new THREE.Color(), []);

  // Per-instance data: base position + drift phase (deterministic per entity)
  const instanceData = useMemo(() => {
    return positions.map((pe, idx) => ({
      entityId: pe.entityId,
      basePosition: new THREE.Vector3(...pe.position),
      confidence: pe.confidence,
      // Drift phase: stagger each node's sine wave so they don't move in lockstep.
      // Using index * golden ratio gives maximally spread phases.
      driftPhase: idx * 2.399, // golden angle in radians
      // Drift speed: slight variation per node (0.15-0.35 rad/s)
      driftSpeed: 0.15 + (idx % 7) * 0.03,
    }));
  }, [positions]);

  // Touch device detection: suppress hover behavior on mobile.
  // Spec: "Mobile: No hover tier. Tap = Tier 2 directly."
  const isTouchDeviceRef = useRef(
    typeof window !== "undefined" && "ontouchstart" in window
  );

  // Raycasting for hover/click: we need per-instance hit detection
  // R3F's built-in raycasting works with InstancedMesh and reports instanceId.
  // On touch devices: pointerMove still fires, but we skip hover to avoid
  // showing labels on tap-drag. The click handler handles Tier 2 directly.
  const handlePointerMove = useCallback(
    (e: THREE.Event & { instanceId?: number }) => {
      if (isTouchDeviceRef.current) return; // No hover tier on touch
      if (e.instanceId !== undefined && e.instanceId < instanceData.length) {
        e.stopPropagation?.();
        setHoveredNode(instanceData[e.instanceId].entityId);
      }
    },
    [instanceData, setHoveredNode]
  );

  const handlePointerOut = useCallback(() => {
    if (isTouchDeviceRef.current) return;
    setHoveredNode(null);
  }, [setHoveredNode]);

  const handleClick = useCallback(
    (e: THREE.Event & { instanceId?: number }) => {
      if (e.instanceId !== undefined && e.instanceId < instanceData.length) {
        e.stopPropagation?.();
        selectNode(instanceData[e.instanceId].entityId);
      }
    },
    [instanceData, selectNode]
  );

  // ---------------------------------------------------------------------------
  // Per-frame update: position drift + opacity/visibility
  // ---------------------------------------------------------------------------
  useFrame((state) => {
    if (!meshRef.current || !isVisible) return;

    const t = state.clock.elapsedTime;

    // Capture activation start time on first frame where activationPlaying is true
    if (activationPlaying && activationStartTime.current === null) {
      activationStartTime.current = t;
    }
    if (!activationPlaying) {
      activationStartTime.current = null;
    }

    // Activation elapsed: time since activation started (not since Canvas mounted).
    // Without this, activation math would use absolute clock time and produce
    // incorrect results if the Canvas has been running for any duration before data loads.
    const activationElapsed = activationStartTime.current !== null
      ? t - activationStartTime.current
      : 0;

    const isNewIdSet = new Set(newEntityIds);

    for (let i = 0; i < instanceData.length; i++) {
      const data = instanceData[i];
      const isNew = isNewIdSet.has(data.entityId);
      const isHovered = data.entityId === hoveredNodeId;
      const isSelected = data.entityId === selectedNodeId;
      const isSearchHit = searchQuery && searchResults.includes(data.entityId);

      // Position: base + ambient drift (sine wave on Y axis)
      // Drift is disabled during reduced motion
      const driftY = prefersReducedMotion
        ? 0
        : Math.sin(t * data.driftSpeed + data.driftPhase) * DRIFT_AMPLITUDE;

      dummy.position.set(
        data.basePosition.x,
        data.basePosition.y + driftY,
        data.basePosition.z
      );

      // Scale: uniform small size. Slightly larger on hover for feedback.
      // During activation, new nodes pulse: scale 1.0 → 1.15 → 1.0
      let scale = 1.0;
      if (isHovered || isSelected) scale = 1.3;
      if (isSearchHit) scale = 1.2;
      if (activationPlaying && isNew) {
        // Pulse using activation-relative time. 3Hz frequency, damped over 2.5s.
        // The damping factor (1 - elapsed * 0.4) decays the pulse to zero by ~2.5s.
        const pulseT = (activationElapsed * 3 + data.driftPhase) % (Math.PI * 2);
        const damping = Math.max(0, 1 - activationElapsed * 0.4);
        scale = 1.0 + Math.sin(pulseT) * 0.15 * damping;
      }
      dummy.scale.setScalar(scale);

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Per-instance color: base cluster color with emissive variation.
      // Hovered/selected nodes burn brighter. New nodes during activation
      // start dim and brighten over time.
      const emissiveIntensity = (() => {
        // Base: confidence maps to 0.3-0.7 emissive
        let base = 0.3 + data.confidence * 0.4;

        if (isHovered || isSelected) base += HOVER_EMISSIVE_BOOST;
        if (isSearchHit) base += 0.15;

        // During activation: new nodes start very dim, existing nodes dim slightly.
        // Uses activationElapsed (relative to start) not absolute clock time.
        if (activationPlaying) {
          if (isNew) {
            // Brighten from 0.05 to full over ~0.8s (Beat 1 duration).
            // 1.2 factor: reaches 1.0 at t=0.83s
            base = Math.min(base, Math.max(NEW_ENTITY_DIM_OPACITY, activationElapsed * 1.2));
          } else {
            // Existing nodes dim to 30% during activation
            base *= 0.3;
          }
        }

        return Math.min(1.0, base);
      })();

      // Reuse pre-allocated working color (avoids 12K allocations/sec GC pressure)
      workingColor.copy(threeColor).multiplyScalar(emissiveIntensity);
      meshRef.current.setColorAt(i, workingColor);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  if (!isVisible || positions.length === 0) return null;

  // Hovered node label — rendered as HTML overlay via drei <Html>
  const hoveredData = hoveredNodeId
    ? instanceData.find(d => d.entityId === hoveredNodeId)
    : null;
  const hoveredEntityInfo = hoveredNodeId ? entityMap.get(hoveredNodeId) : null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, positions.length]}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        frustumCulled={false}
      >
        <sphereGeometry args={[NODE_RADIUS, NODE_SEGMENTS, NODE_SEGMENTS]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          // Additive blending: overlapping nodes create soft glow accumulation,
          // mimicking how light from multiple sources combines in vacuum.
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Hover label — borderless text with dark halo for legibility */}
      {hoveredData && hoveredEntityInfo && (
        <Html
          position={[
            hoveredData.basePosition.x,
            hoveredData.basePosition.y + 0.25,
            hoveredData.basePosition.z,
          ]}
          center
          distanceFactor={15}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="text-center whitespace-nowrap"
            style={{
              // Dark halo: radial gradient from semi-transparent dark to transparent.
              // Ensures text is legible against any cluster color or edge tangle.
              background: "radial-gradient(ellipse, rgba(10,10,10,0.7) 0%, transparent 70%)",
              padding: "8px 16px",
            }}
          >
            <div className="font-mohave text-xs text-white leading-tight">
              {hoveredEntityInfo.name}
            </div>
            <div className="font-kosugi text-[9px] uppercase tracking-wider text-[#999] mt-0.5">
              {hoveredEntityInfo.type}
            </div>
          </div>
        </Html>
      )}
    </>
  );
}

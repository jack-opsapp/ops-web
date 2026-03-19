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

import { useRef, useMemo, useCallback, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { CLUSTER_COLORS, type PositionedEntity } from "./galaxy-layout";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";

// ---------------------------------------------------------------------------
// Glow sprite texture — generated once, shared across all clusters.
// Creates a soft radial gradient: bright center fading to transparent edges.
// The falloff follows inverse-square-ish curve: intensity = 1 / (1 + r^2 * k)
// This produces the "point of light in vacuum" aesthetic.
// ---------------------------------------------------------------------------
function createGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;

  // Radial gradient with steep inverse-square falloff. The bright core is
  // only the inner ~5% of the sprite — the rest is a barely-perceptible halo.
  // This makes the visible "point" tiny while the clickable area (plane) is large.
  // Color is white — cluster color is applied per-instance via vertex colors.
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");     // Pinpoint core
  gradient.addColorStop(0.04, "rgba(255, 255, 255, 0.7)");  // Still bright
  gradient.addColorStop(0.08, "rgba(255, 255, 255, 0.25)"); // Rapid falloff
  gradient.addColorStop(0.15, "rgba(255, 255, 255, 0.06)"); // Very faint halo
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.015)");// Barely visible
  gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");   // Transparent edge

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

let _glowTexture: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture {
  if (!_glowTexture) _glowTexture = createGlowTexture();
  return _glowTexture;
}

// ---------------------------------------------------------------------------
// Reduced motion — read once at module level (SSR-safe)
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Node size: these are POINTS OF LIGHT, not spheres. Using a sprite-based
// approach with a soft radial gradient texture for glow. The plane is sized
// large enough for a comfortable click target (~0.5 world units), but the
// bright core of the glow texture is tiny — the visual "point" is only the
// inner ~10% of the sprite. The rest is a near-invisible halo.
const NODE_SIZE = 0.5;

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

  // Pre-built Set of new entity IDs — updated only when newEntityIds changes,
  // NOT rebuilt every frame. Without this: 420 Set constructions/sec at 60fps.
  const newEntityIdSetRef = useRef(new Set<string>());
  useEffect(() => {
    newEntityIdSetRef.current = new Set(newEntityIds);
  }, [newEntityIds]);

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
    (e: { instanceId?: number; stopPropagation?: () => void }) => {
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
    (e: { instanceId?: number; stopPropagation?: () => void }) => {
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

    // Billboard: make all sprites face the camera. Extract camera quaternion
    // once per frame and apply to every instance.
    const cameraQuaternion = state.camera.quaternion;

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

    for (let i = 0; i < instanceData.length; i++) {
      const data = instanceData[i];
      const isNew = newEntityIdSetRef.current.has(data.entityId);
      const isHovered = data.entityId === hoveredNodeId;
      const isSelected = data.entityId === selectedNodeId;
      const isSearchHit = searchQuery && searchResults.includes(data.entityId);

      // Position: base + ambient drift (sine wave on Y axis)
      // Drift is disabled during reduced motion
      const driftY = prefersReducedMotion
        ? 0
        : Math.sin(t * data.driftSpeed + data.driftPhase) * DRIFT_AMPLITUDE;

      const px = data.basePosition.x;
      const py = data.basePosition.y + driftY;
      const pz = data.basePosition.z;
      dummy.position.set(px, py, pz);

      // Write live position for edge renderer to read
      liveNodePositions.set(data.entityId, { x: px, y: py, z: pz });

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

      // Billboard: rotate each sprite to face the camera
      dummy.quaternion.copy(cameraQuaternion);

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
        {/* PlaneGeometry instead of SphereGeometry — nodes are flat sprites
            that always face the camera (billboard). The glow texture creates
            the illusion of a point of light, not a 3D sphere. */}
        <planeGeometry args={[NODE_SIZE, NODE_SIZE]} />
        <meshBasicMaterial
          map={getGlowTexture()}
          color={color}
          transparent
          opacity={0.9}
          // Additive blending: overlapping glow halos accumulate brightness,
          // mimicking how light from multiple sources combines in vacuum.
          // Nearby nodes create soft nebula-like brightening.
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          // Side: DoubleSide so the sprite is visible from behind during 3D rotation
          side={THREE.DoubleSide}
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
            className="text-left whitespace-nowrap"
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

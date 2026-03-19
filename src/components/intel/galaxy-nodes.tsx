"use client";

// ---------------------------------------------------------------------------
// GalaxyNodes — instanced point-sprite rendering for the Intel galaxy.
// Runs INSIDE a <Canvas> context (React Three Fiber component).
//
// Accepts PositionedNode[] from the hierarchical layout. Groups nodes by
// color for instanced rendering (one draw call per color group). Handles:
// - Per-node dimming (20% brightness for unfocused siblings)
// - Focus-on-click (client click → focusClient, project click → focusProject)
// - Hover labels with sublabels (address, dates, role)
// - Ambient drift animation
// - Activation sequence (new entity ignition)
// ---------------------------------------------------------------------------

import { useRef, useMemo, useCallback, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { PositionedNode } from "./galaxy-layout";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";

// ---------------------------------------------------------------------------
// Glow sprite texture — generated once, shared across all nodes.
// Tight pinpoint core with steep inverse-square-ish falloff.
// The visible "point" is only the inner ~5% — the rest is barely-perceptible halo.
// ---------------------------------------------------------------------------
function createGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
  gradient.addColorStop(0.04, "rgba(255, 255, 255, 0.7)");
  gradient.addColorStop(0.08, "rgba(255, 255, 255, 0.25)");
  gradient.addColorStop(0.15, "rgba(255, 255, 255, 0.06)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.015)");
  gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");

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
// Reduced motion
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Plane size for glow sprites. Large enough for comfortable click targets.
// The visual "point" is much smaller (inner 5% of the glow texture).
const NODE_SIZE = 0.5;
const DRIFT_AMPLITUDE = 0.08;
const HOVER_EMISSIVE_BOOST = 0.3;
const DIM_FACTOR = 0.2; // Dimmed nodes render at 20% brightness

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GalaxyNodesProps {
  nodes: PositionedNode[];
  onNodeClick?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyNodes({ nodes, onNodeClick }: GalaxyNodesProps) {
  // Group nodes by color for instanced rendering (one InstancedMesh per color)
  const colorGroups = useMemo(() => {
    const groups = new Map<string, PositionedNode[]>();
    for (const node of nodes) {
      if (!node.visible) continue;
      const key = node.color;
      const group = groups.get(key) ?? [];
      group.push(node);
      groups.set(key, group);
    }
    return groups;
  }, [nodes]);

  return (
    <>
      {Array.from(colorGroups.entries()).map(([color, group]) => (
        <ColorInstanceGroup key={color} color={color} nodes={group} onNodeClick={onNodeClick} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// ColorInstanceGroup — one InstancedMesh per color
// ---------------------------------------------------------------------------

interface ColorInstanceGroupProps {
  color: string;
  nodes: PositionedNode[];
  onNodeClick?: () => void;
}

function ColorInstanceGroup({ color, nodes, onNodeClick }: ColorInstanceGroupProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Store selectors
  const hoveredNodeId = useIntelStore((s) => s.hoveredNodeId);
  const selectedNodeId = useIntelStore((s) => s.selectedNodeId);
  const focusLevel = useIntelStore((s) => s.focusLevel);
  const newEntityIds = useIntelStore((s) => s.newEntityIds);
  const activationPlaying = useIntelStore((s) => s.activationPlaying);
  const setHoveredNode = useIntelStore((s) => s.setHoveredNode);
  const selectNode = useIntelStore((s) => s.selectNode);
  const focusClient = useIntelStore((s) => s.focusClient);
  const focusProject = useIntelStore((s) => s.focusProject);
  const searchQuery = useIntelStore((s) => s.searchQuery);
  const searchResults = useIntelStore((s) => s.searchResults);

  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const workingColor = useMemo(() => new THREE.Color(), []);

  // Pre-built Set of new entity IDs
  const newEntityIdSetRef = useRef(new Set<string>());
  useEffect(() => {
    newEntityIdSetRef.current = new Set(newEntityIds);
  }, [newEntityIds]);

  // Activation start time
  const activationStartTime = useRef<number | null>(null);

  // Per-instance data
  const instanceData = useMemo(() => {
    return nodes.map((node, idx) => ({
      entityId: node.entityId,
      nodeType: node.nodeType,
      label: node.label,
      sublabel: node.sublabel,
      dimmed: node.dimmed,
      basePosition: new THREE.Vector3(...node.position),
      driftPhase: idx * 2.399,
      driftSpeed: 0.15 + (idx % 7) * 0.03,
    }));
  }, [nodes]);

  // Touch device detection
  const isTouchDeviceRef = useRef(
    typeof window !== "undefined" && "ontouchstart" in window
  );

  // Pointer handlers
  const handlePointerMove = useCallback(
    (e: { instanceId?: number; stopPropagation?: () => void }) => {
      if (isTouchDeviceRef.current) return;
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
        // Signal to the DOM handler that R3F handled this click —
        // prevents the wrapper div from calling dismissSelection()
        onNodeClick?.();

        const node = instanceData[e.instanceId];
        const pos = {
          x: node.basePosition.x,
          y: node.basePosition.y,
          z: node.basePosition.z,
        };

        // Focus-on-click: client at L1 → zoom in, project at L2 → zoom in
        if (node.nodeType === "client" && focusLevel === 1) {
          focusClient(node.entityId, pos);
        } else if (node.nodeType === "project" && focusLevel === 2) {
          focusProject(node.entityId, pos);
        } else {
          // All other clicks → select (show info panel)
          selectNode(node.entityId);
        }
      }
    },
    [instanceData, focusLevel, focusClient, focusProject, selectNode, onNodeClick]
  );

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------
  useFrame((state) => {
    if (!meshRef.current) return;

    const cameraQuaternion = state.camera.quaternion;
    const t = state.clock.elapsedTime;

    // Activation timing
    if (activationPlaying && activationStartTime.current === null) {
      activationStartTime.current = t;
    }
    if (!activationPlaying) activationStartTime.current = null;
    const activationElapsed = activationStartTime.current !== null
      ? t - activationStartTime.current : 0;

    for (let i = 0; i < instanceData.length; i++) {
      const data = instanceData[i];
      const isNew = newEntityIdSetRef.current.has(data.entityId);
      const isHovered = data.entityId === hoveredNodeId;
      const isSelected = data.entityId === selectedNodeId;
      const isSearchHit = searchQuery && searchResults.includes(data.entityId);

      // Position: base + ambient drift
      const driftY = prefersReducedMotion
        ? 0
        : Math.sin(t * data.driftSpeed + data.driftPhase) * DRIFT_AMPLITUDE;

      const px = data.basePosition.x;
      const py = data.basePosition.y + driftY;
      const pz = data.basePosition.z;
      dummy.position.set(px, py, pz);

      // Write live position for edge renderer
      liveNodePositions.set(data.entityId, { x: px, y: py, z: pz });

      // Scale
      let scale = 1.0;
      if (isHovered || isSelected) scale = 1.3;
      if (isSearchHit) scale = 1.2;
      if (activationPlaying && isNew) {
        const pulseT = (activationElapsed * 3 + data.driftPhase) % (Math.PI * 2);
        const damping = Math.max(0, 1 - activationElapsed * 0.4);
        scale = 1.0 + Math.sin(pulseT) * 0.15 * damping;
      }
      dummy.scale.setScalar(scale);

      // Billboard
      dummy.quaternion.copy(cameraQuaternion);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Color: base with emissive variation + dimming
      let intensity = 0.5;
      if (isHovered || isSelected) intensity += HOVER_EMISSIVE_BOOST;
      if (isSearchHit) intensity += 0.15;
      if (data.dimmed) intensity *= DIM_FACTOR;
      if (activationPlaying && isNew) {
        intensity = Math.min(intensity, Math.max(0.05, activationElapsed * 1.2));
      }
      intensity = Math.min(1.0, intensity);

      workingColor.copy(threeColor).multiplyScalar(intensity);
      meshRef.current.setColorAt(i, workingColor);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  if (nodes.length === 0) return null;

  // Hovered node label
  const hoveredData = hoveredNodeId
    ? instanceData.find(d => d.entityId === hoveredNodeId)
    : null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, nodes.length]}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        frustumCulled={false}
      >
        <planeGeometry args={[NODE_SIZE, NODE_SIZE]} />
        <meshBasicMaterial
          map={getGlowTexture()}
          color={color}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {/* Hover label with dark halo */}
      {hoveredData && (
        <Html
          position={[
            hoveredData.basePosition.x,
            hoveredData.basePosition.y + 0.35,
            hoveredData.basePosition.z,
          ]}
          center
          distanceFactor={15}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="text-left whitespace-nowrap"
            style={{
              background: "radial-gradient(ellipse, rgba(10,10,10,0.7) 0%, transparent 70%)",
              padding: "8px 16px",
            }}
          >
            <div className="font-mohave text-xs text-white leading-tight">
              {hoveredData.label}
            </div>
            {hoveredData.sublabel && (
              <div className="font-mohave text-[10px] text-[#999] leading-tight mt-0.5">
                {hoveredData.sublabel}
              </div>
            )}
            <div className="font-kosugi text-[8px] uppercase tracking-wider text-[#666] mt-0.5">
              {hoveredData.nodeType}
            </div>
          </div>
        </Html>
      )}
    </>
  );
}

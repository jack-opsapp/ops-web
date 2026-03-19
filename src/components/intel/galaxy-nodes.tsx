"use client";

// ---------------------------------------------------------------------------
// GalaxyNodes — point-sprite nodes for the Intel galaxy.
//
// Two-layer approach:
//   1. InstancedMesh per color group — handles VISUAL rendering (glow sprites,
//      colors, dimming, drift animation). No event handlers.
//   2. Individual invisible sphere meshes — handles ALL interaction (click,
//      hover). Each node gets its own <mesh> with guaranteed raycasting.
//
// InstancedMesh raycasting is unreliable with billboard PlaneGeometry due to
// bounding sphere caching, quaternion transforms, and R3F event timing issues.
// Individual meshes are the simplest approach that always works.
// ---------------------------------------------------------------------------

import { useRef, useMemo, useCallback, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { PositionedNode } from "./galaxy-layout";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";

// ---------------------------------------------------------------------------
// Glow sprite texture
// ---------------------------------------------------------------------------
function createGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;

  // Sharp pinpoint core (1-2px on screen) with wide soft glow halo.
  // The core is only the inner 2% of the sprite. The rest is a barely-
  // perceptible halo that creates the "point of light" effect when
  // multiple nodes' halos overlap and additively blend.
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");     // Sharp core
  gradient.addColorStop(0.02, "rgba(255, 255, 255, 0.9)");  // Still bright
  gradient.addColorStop(0.04, "rgba(255, 255, 255, 0.3)");  // Steep drop
  gradient.addColorStop(0.08, "rgba(255, 255, 255, 0.08)"); // Faint halo
  gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.02)");  // Near-invisible
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.005)"); // Barely there
  gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");   // Gone

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
// Constants
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Sprite plane: 0.35 gives a small glow halo. The visible "point" is
// only the inner 2% (~7px on screen at default zoom). The rest is halo.
const NODE_SIZE = 0.35;
const HIT_RADIUS = 0.3;

// Orbital speed: radians per second. Very slow — ambient, not distracting.
// The motion should be barely perceptible until you watch for a few seconds.
const ORBIT_SPEED_BASE = 0.012; // ~0.7° per second — one revolution in ~524s (~8.7 min)
const HOVER_EMISSIVE_BOOST = 0.3;
const DIM_FACTOR = 0.2;

// Shared geometry + material for invisible click targets (created once)
const hitGeometry = typeof window !== "undefined" ? new THREE.SphereGeometry(HIT_RADIUS, 6, 6) : null;
const hitMaterial = typeof window !== "undefined" ? new THREE.MeshBasicMaterial({ visible: false }) : null;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface GalaxyNodesProps {
  nodes: PositionedNode[];
  onNodeClick?: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function GalaxyNodes({ nodes, onNodeClick }: GalaxyNodesProps) {
  const visibleNodes = useMemo(() => nodes.filter(n => n.visible), [nodes]);

  // Group by color for instanced visual rendering
  const colorGroups = useMemo(() => {
    const groups = new Map<string, PositionedNode[]>();
    for (const node of visibleNodes) {
      const group = groups.get(node.color) ?? [];
      group.push(node);
      groups.set(node.color, group);
    }
    return groups;
  }, [visibleNodes]);

  return (
    <>
      {/* Visual layer: InstancedMesh per color (no event handlers) */}
      {Array.from(colorGroups.entries()).map(([color, group]) => (
        <GlowInstanceGroup key={color} color={color} nodes={group} />
      ))}

      {/* Interaction layer: individual invisible meshes (guaranteed raycasting) */}
      <ClickTargets nodes={visibleNodes} onNodeClick={onNodeClick} />
    </>
  );
}

// ---------------------------------------------------------------------------
// GlowInstanceGroup — visual-only instanced rendering
// ---------------------------------------------------------------------------
function GlowInstanceGroup({ color, nodes }: { color: string; nodes: PositionedNode[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const workingColor = useMemo(() => new THREE.Color(), []);

  const hoveredNodeId = useIntelStore((s) => s.hoveredNodeId);
  const selectedNodeId = useIntelStore((s) => s.selectedNodeId);
  const searchQuery = useIntelStore((s) => s.searchQuery);
  const searchResults = useIntelStore((s) => s.searchResults);

  const instanceData = useMemo(() => {
    return nodes.map((node, idx) => {
      const dx = node.position[0] - node.orbitCenter[0];
      const dy = node.position[1] - node.orbitCenter[1];
      const initialAngle = Math.atan2(dy, dx);

      return {
        entityId: node.entityId,
        nodeType: node.nodeType,
        dimmed: node.dimmed,
        orbitCenter: new THREE.Vector3(...node.orbitCenter),
        orbitRadius: node.orbitRadius,
        baseZ: node.position[2],
        initialAngle,
        orbitSpeed: ORBIT_SPEED_BASE * (0.7 + (idx % 7) * 0.1),
      };
    });
  }, [nodes]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const camQ = state.camera.quaternion;

    for (let i = 0; i < instanceData.length; i++) {
      const d = instanceData[i];
      const isHovered = d.entityId === hoveredNodeId;
      const isSelected = d.entityId === selectedNodeId;
      const isSearchHit = searchQuery && searchResults.includes(d.entityId);

      // Orbital motion: rotate the node around its orbit center.
      // The angle advances by orbitSpeed * t from the initial layout angle.
      // This creates a slow, continuous revolution — not a bounce.
      const angle = prefersReducedMotion ? d.initialAngle : d.initialAngle + t * d.orbitSpeed;
      const px = d.orbitCenter.x + d.orbitRadius * Math.cos(angle);
      const py = d.orbitCenter.y + d.orbitRadius * Math.sin(angle);
      const pz = d.baseZ;

      dummy.position.set(px, py, pz);
      liveNodePositions.set(d.entityId, { x: px, y: py, z: pz });

      let scale = 1.0;
      if (isHovered || isSelected) scale = 1.3;
      if (isSearchHit) scale = 1.2;
      dummy.scale.setScalar(scale);

      // Billboard
      dummy.quaternion.copy(camQ);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Color + dimming + distance-based fade for child nodes.
      // Projects/tasks/team/financial fade in based on camera distance —
      // invisible when far, fully visible when close. Clients always visible.
      let intensity = 0.8;

      // Distance-based fade: non-client nodes fade in as camera approaches.
      // Fade range: invisible beyond 14 units, fully visible within 8 units.
      if (d.nodeType !== "client" && d.nodeType !== "organization") {
        const camDist = state.camera.position.distanceTo(
          new THREE.Vector3(px, py, pz)
        );
        const FADE_FAR = 14;  // fully invisible beyond this
        const FADE_NEAR = 8;  // fully visible within this
        const fadeFactor = 1 - Math.max(0, Math.min(1, (camDist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
        intensity *= fadeFactor;
      }

      if (isHovered || isSelected) intensity += HOVER_EMISSIVE_BOOST;
      if (isSearchHit) intensity += 0.15;
      if (d.dimmed) intensity *= DIM_FACTOR;
      intensity = Math.min(1.0, intensity);

      workingColor.copy(threeColor).multiplyScalar(intensity);
      meshRef.current.setColorAt(i, workingColor);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  if (nodes.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, nodes.length]}
      frustumCulled={false}
      // NO event handlers — interaction handled by ClickTargets
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
  );
}

// ---------------------------------------------------------------------------
// ClickTargets — individual invisible meshes for guaranteed raycasting
// ---------------------------------------------------------------------------
function ClickTargets({ nodes, onNodeClick }: { nodes: PositionedNode[]; onNodeClick?: () => void }) {
  const focusLevel = useIntelStore((s) => s.focusLevel);
  const focusClient = useIntelStore((s) => s.focusClient);
  const focusProject = useIntelStore((s) => s.focusProject);
  const selectNode = useIntelStore((s) => s.selectNode);
  const setHoveredNode = useIntelStore((s) => s.setHoveredNode);
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());

  const isTouchDevice = useRef(typeof window !== "undefined" && "ontouchstart" in window);

  // Sync click target positions with live orbital positions every frame
  useFrame(() => {
    for (const [entityId, mesh] of meshRefs.current) {
      const live = liveNodePositions.get(entityId);
      if (live) {
        mesh.position.set(live.x, live.y, live.z);
      }
    }
  });

  if (!hitGeometry || !hitMaterial) return null;

  return (
    <group>
      {nodes.map((node) => (
        <mesh
          key={node.entityId}
          ref={(ref) => {
            if (ref) meshRefs.current.set(node.entityId, ref);
            else meshRefs.current.delete(node.entityId);
          }}
          position={node.position}
          geometry={hitGeometry}
          material={hitMaterial}
          onClick={(e) => {
            e.stopPropagation();
            onNodeClick?.();

            const state = useIntelStore.getState();
            // Use live orbital position (not static layout position)
            const live = liveNodePositions.get(node.entityId);
            const pos = live
              ? { x: live.x, y: live.y, z: live.z }
              : { x: node.position[0], y: node.position[1], z: node.position[2] };

            if (node.nodeType === "client") {
              if (focusLevel === 1) {
                focusClient(node.entityId, pos);
              } else if (focusLevel === 2 && node.entityId !== state.focusedClientId) {
                focusClient(node.entityId, pos);
              }
            } else if (node.nodeType === "project") {
              if (focusLevel === 1) {
                // L1: clicking a project focuses its parent client.
                // Find the client this project orbits by checking orbitCenter.
                const parentClient = nodes.find(
                  n => n.nodeType === "client" &&
                  Math.abs(n.position[0] - node.orbitCenter[0]) < 0.01 &&
                  Math.abs(n.position[1] - node.orbitCenter[1]) < 0.01
                );
                if (parentClient) {
                  const parentLive = liveNodePositions.get(parentClient.entityId);
                  const parentPos = parentLive
                    ? { x: parentLive.x, y: parentLive.y, z: parentLive.z }
                    : { x: parentClient.position[0], y: parentClient.position[1], z: parentClient.position[2] };
                  focusClient(parentClient.entityId, parentPos);
                }
              } else if (focusLevel === 2) {
                focusProject(node.entityId, pos);
              }
            } else {
              selectNode(node.entityId);
            }
          }}
          onPointerOver={(e) => {
            if (isTouchDevice.current) return;
            e.stopPropagation();
            setHoveredNode(node.entityId);
          }}
          onPointerOut={() => {
            if (isTouchDevice.current) return;
            setHoveredNode(null);
          }}
        />
      ))}

      {/* Hover label */}
      <HoverLabel nodes={nodes} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// HoverLabel — shows label near the hovered node
// ---------------------------------------------------------------------------
function HoverLabel({ nodes }: { nodes: PositionedNode[] }) {
  const hoveredNodeId = useIntelStore((s) => s.hoveredNodeId);
  const hoveredNode = hoveredNodeId ? nodes.find(n => n.entityId === hoveredNodeId) : null;

  if (!hoveredNode) return null;

  // Use LIVE orbital position, not the static layout position.
  // Without this, the label appears where the node started (its layout position),
  // not where it currently is after orbital motion — potentially on the opposite side.
  const live = hoveredNodeId ? liveNodePositions.get(hoveredNodeId) : null;
  const lx = live?.x ?? hoveredNode.position[0];
  const ly = live?.y ?? hoveredNode.position[1];
  const lz = live?.z ?? hoveredNode.position[2];

  return (
    <Html
      position={[lx, ly + 0.35, lz]}
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
          {hoveredNode.label}
        </div>
        {hoveredNode.sublabel && (
          <div className="font-mohave text-[10px] text-[#999] leading-tight mt-0.5">
            {hoveredNode.sublabel}
          </div>
        )}
        <div className="font-kosugi text-[8px] uppercase tracking-wider text-[#666] mt-0.5">
          {hoveredNode.nodeType}
        </div>
      </div>
    </Html>
  );
}

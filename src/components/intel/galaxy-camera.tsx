"use client";

// ---------------------------------------------------------------------------
// GalaxyCamera — camera animation + zoom-level detection.
// Runs INSIDE a <Canvas> context (React Three Fiber component).
//
// Two responsibilities:
// 1. Smooth fly-to animation when cameraTarget is set in the store.
// 2. Zoom-level detection: when the user scrolls close enough to a node,
//    auto-focus it (drill down). When they scroll far enough out, auto-
//    navigate back (drill up). This makes scroll THE primary navigation.
// ---------------------------------------------------------------------------

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";
import type { PositionedNode } from "./galaxy-layout";

const LERP_SPEED = 4;
const CONVERGENCE_THRESHOLD = 0.05;

// Zoom thresholds for auto-level transitions.
// "Zoom in" = camera gets closer to its target (distance decreases).
// "Zoom out" = camera gets further from its target (distance increases).
const ZOOM_IN_L1_TO_L2 = 12;  // At L1, closer than 12 → focus nearest client
const ZOOM_IN_L2_TO_L3 = 5;   // At L2, closer than 5 → focus nearest project
const ZOOM_OUT_L2_TO_L1 = 16;  // At L2, further than 16 → back to L1
const ZOOM_OUT_L3_TO_L2 = 9;   // At L3, further than 9 → back to L2

// Cooldown: ignore zoom triggers for 1s after the last level transition
// to prevent oscillation during fly-to animations.
const COOLDOWN_MS = 1000;

interface GalaxyCameraProps {
  controlsRef: React.RefObject<{ target: THREE.Vector3; update: () => void } | null>;
  nodes: PositionedNode[];
}

export function GalaxyCamera({ controlsRef, nodes }: GalaxyCameraProps) {
  const { camera } = useThree();
  const cameraTarget = useIntelStore((s) => s.cameraTarget);
  const cameraDistance = useIntelStore((s) => s.cameraDistance);
  const clearCameraTarget = useIntelStore((s) => s.clearCameraTarget);

  const targetCamPos = useRef(new THREE.Vector3());
  const targetLookAt = useRef(new THREE.Vector3());
  const isAnimating = useRef(false);
  const lastTransitionTime = useRef(0);
  const tempVec = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    // ── 1. Fly-to animation ───────────────────────────────────────────
    if (cameraTarget) {
      if (!isAnimating.current) {
        targetCamPos.current.set(cameraTarget.x, cameraTarget.y, cameraTarget.z + cameraDistance);
        targetLookAt.current.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
        isAnimating.current = true;
        lastTransitionTime.current = Date.now();
      }

      const lerpFactor = 1 - Math.exp(-LERP_SPEED * delta);
      camera.position.lerp(targetCamPos.current, lerpFactor);

      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLookAt.current, lerpFactor);
        controlsRef.current.update();
      }

      const dist = camera.position.distanceTo(targetCamPos.current);
      if (dist < CONVERGENCE_THRESHOLD) {
        camera.position.copy(targetCamPos.current);
        if (controlsRef.current) {
          controlsRef.current.target.copy(targetLookAt.current);
          controlsRef.current.update();
        }
        isAnimating.current = false;
        clearCameraTarget();
      }
      return; // Skip zoom detection during animation
    }

    isAnimating.current = false;

    // ── 2. Zoom-level detection ───────────────────────────────────────
    // Skip if in cooldown (prevents oscillation after fly-to)
    if (Date.now() - lastTransitionTime.current < COOLDOWN_MS) return;

    const store = useIntelStore.getState();
    const controlsTarget = controlsRef.current?.target;
    if (!controlsTarget) return;

    // Camera distance from its orbit target (what the user is looking at)
    const camDist = camera.position.distanceTo(controlsTarget);

    // ── L1: zoom in → find nearest client and focus ──────────────────
    if (store.focusLevel === 1 && camDist < ZOOM_IN_L1_TO_L2) {
      const nearest = findNearestNode(controlsTarget, nodes, "client");
      if (nearest) {
        lastTransitionTime.current = Date.now();
        store.focusClient(nearest.entityId, {
          x: nearest.position[0],
          y: nearest.position[1],
          z: nearest.position[2],
        });
      }
    }

    // ── L2: zoom in → find nearest project and focus ─────────────────
    if (store.focusLevel === 2 && camDist < ZOOM_IN_L2_TO_L3) {
      const nearest = findNearestNode(controlsTarget, nodes, "project");
      if (nearest) {
        lastTransitionTime.current = Date.now();
        store.focusProject(nearest.entityId, {
          x: nearest.position[0],
          y: nearest.position[1],
          z: nearest.position[2],
        });
      }
    }

    // ── L2: zoom out → back to L1 ───────────────────────────────────
    if (store.focusLevel === 2 && camDist > ZOOM_OUT_L2_TO_L1) {
      lastTransitionTime.current = Date.now();
      store.focusBack();
    }

    // ── L3: zoom out → back to L2 ───────────────────────────────────
    if (store.focusLevel === 3 && camDist > ZOOM_OUT_L3_TO_L2) {
      lastTransitionTime.current = Date.now();
      store.focusBack();
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Find the node of a given type closest to a 3D point
// ---------------------------------------------------------------------------
function findNearestNode(
  point: THREE.Vector3,
  nodes: PositionedNode[],
  nodeType: string
): PositionedNode | null {
  let best: PositionedNode | null = null;
  let bestDist = Infinity;

  for (const node of nodes) {
    if (node.nodeType !== nodeType || !node.visible || node.dimmed) continue;
    const dx = node.position[0] - point.x;
    const dy = node.position[1] - point.y;
    const dz = node.position[2] - point.z;
    const dist = dx * dx + dy * dy + dz * dz; // squared distance is fine for comparison
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }

  return best;
}

"use client";

// ---------------------------------------------------------------------------
// GalaxyCamera — smooth fly-to camera animation controller.
// Runs INSIDE a <Canvas> context (React Three Fiber component).
//
// When the store's `cameraTarget` is set (by focusClient/focusProject/focusBack),
// this component lerps both the camera position AND the OrbitControls target
// toward the focus point. Without updating OrbitControls.target, orbit rotation
// would still center on the old point — middle-mouse drag would feel broken.
//
// Lerp speed: exponential decay at rate 4 ≈ 95% convergence in ~800ms at 60fps.
// ---------------------------------------------------------------------------

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useIntelStore } from "@/stores/intel-store";

const LERP_SPEED = 4;
const CONVERGENCE_THRESHOLD = 0.05;

interface GalaxyCameraProps {
  controlsRef: React.RefObject<{ target: THREE.Vector3; update: () => void } | null>;
}

export function GalaxyCamera({ controlsRef }: GalaxyCameraProps) {
  const { camera } = useThree();
  const cameraTarget = useIntelStore((s) => s.cameraTarget);
  const cameraDistance = useIntelStore((s) => s.cameraDistance);
  const clearCameraTarget = useIntelStore((s) => s.clearCameraTarget);

  const targetCamPos = useRef(new THREE.Vector3());
  const targetLookAt = useRef(new THREE.Vector3());
  const isAnimating = useRef(false);

  useFrame((_, delta) => {
    if (!cameraTarget) {
      isAnimating.current = false;
      return;
    }

    if (!isAnimating.current) {
      // Camera position: focus point + offset on Z axis for distance
      targetCamPos.current.set(
        cameraTarget.x,
        cameraTarget.y,
        cameraTarget.z + cameraDistance
      );
      // OrbitControls target: the focus point itself (orbit centers here)
      targetLookAt.current.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
      isAnimating.current = true;
    }

    // Exponential lerp: fast start, smooth deceleration
    const lerpFactor = 1 - Math.exp(-LERP_SPEED * delta);

    // Animate camera position
    camera.position.lerp(targetCamPos.current, lerpFactor);

    // Animate OrbitControls target in sync
    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetLookAt.current, lerpFactor);
      controlsRef.current.update();
    }

    // Check convergence
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
  });

  return null;
}

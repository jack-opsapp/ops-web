"use client";

// ---------------------------------------------------------------------------
// GalaxyCenterNode — the gravitational center of the Intel galaxy.
// Represents the user's own company. Sits at origin [0, 0, 0].
// Slightly brighter than other nodes. On hover or close zoom, shows company
// name label with dark-halo legibility treatment.
// ---------------------------------------------------------------------------

import { useRef, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENTER_RADIUS = 0.09;
const CENTER_COLOR = "#597794";
const LABEL_DISTANCE_THRESHOLD = 12;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GalaxyCenterNodeProps {
  companyName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyCenterNode({ companyName }: GalaxyCenterNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  const threeColor = useMemo(() => new THREE.Color(CENTER_COLOR), []);

  // Label visibility: controlled by React state so it triggers re-render.
  // Updated from useFrame only when the value CHANGES to avoid per-frame renders.
  const [labelVisible, setLabelVisible] = useState(false);
  const prevVisibleRef = useRef(false);
  const isHovered = useRef(false);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Gentle breathing pulse
    if (!prefersReducedMotion) {
      const t = state.clock.elapsedTime;
      const breathe = Math.sin(t * Math.PI * 0.5) * 0.1;
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      const intensity = 0.6 + breathe + (isHovered.current ? 0.3 : 0);
      mat.color.copy(threeColor).multiplyScalar(intensity);
    }

    // Semantic zoom: show label when camera is close enough or hovered.
    // Only update React state when visibility transitions to avoid per-frame re-renders.
    const dist = camera.position.length();
    const shouldShow = dist < LABEL_DISTANCE_THRESHOLD || isHovered.current;
    if (shouldShow !== prevVisibleRef.current) {
      prevVisibleRef.current = shouldShow;
      setLabelVisible(shouldShow);
    }
  });

  return (
    <>
      <mesh
        ref={meshRef}
        position={[0, 0, 0]}
        onPointerOver={() => { isHovered.current = true; }}
        onPointerOut={() => { isHovered.current = false; }}
      >
        <sphereGeometry args={[CENTER_RADIUS, 16, 16]} />
        <meshBasicMaterial
          color={CENTER_COLOR}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Company name label — shows on hover or close zoom */}
      {labelVisible && (
        <Html
          position={[0, 0.3, 0]}
          center
          distanceFactor={15}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="text-left whitespace-nowrap"
            style={{
              background: "radial-gradient(ellipse, rgba(10,10,10,0.7) 0%, transparent 70%)",
              padding: "8px 16px",
              opacity: 0.9,
            }}
          >
            <div className="font-mohave text-xs text-white leading-tight">
              {companyName}
            </div>
            <div className="font-kosugi text-[9px] uppercase tracking-wider text-[#597794] mt-0.5">
              your network
            </div>
          </div>
        </Html>
      )}
    </>
  );
}

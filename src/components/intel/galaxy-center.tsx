"use client";

// ---------------------------------------------------------------------------
// GalaxyCenterNode — the gravitational center of the Intel galaxy.
// Represents the user's own company. Sits at origin [0, 0, 0].
// Slightly brighter than other nodes. On hover or close zoom, shows company
// name label with dark-halo legibility treatment.
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
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

// Slightly larger than regular nodes (0.06) to establish hierarchy
// without being ostentatiously big. The center earns its prominence
// through position and brightness, not size.
const CENTER_RADIUS = 0.09;

// Accent color — the center uses the brand accent since it represents "you"
const CENTER_COLOR = "#597794";

// Label visibility threshold: show company name when camera is within
// this distance (world units). Matches the semantic-zoom philosophy —
// detail emerges with proximity.
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

  // Track whether label should show (camera distance or hover)
  const isLabelVisible = useRef(false);
  const isHovered = useRef(false);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Gentle breathing pulse: the center node slowly pulses in emissive
    // intensity, suggesting it's alive — the heartbeat of the network.
    // Sine wave: period ~4 seconds, amplitude ±0.1 emissive units.
    if (!prefersReducedMotion) {
      const t = state.clock.elapsedTime;
      // Breathing rate: 0.25 Hz = 4-second period. Amplitude 0.1.
      // Added to base emissive of 0.6 → oscillates between 0.5 and 0.7.
      const breathe = Math.sin(t * Math.PI * 0.5) * 0.1;
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      const intensity = 0.6 + breathe + (isHovered.current ? 0.3 : 0);
      mat.color.copy(threeColor).multiplyScalar(intensity);
    }

    // Semantic zoom: show label when camera is close enough
    const dist = camera.position.length(); // Distance from origin
    isLabelVisible.current = dist < LABEL_DISTANCE_THRESHOLD || isHovered.current;
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
      <Html
        position={[0, 0.3, 0]}
        center
        distanceFactor={15}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="text-center whitespace-nowrap transition-opacity duration-300"
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
    </>
  );
}

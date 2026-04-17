"use client";

// ---------------------------------------------------------------------------
// GalaxyCenterNode — the gravitational center of the Intel galaxy.
// Represents the user's own company. Sits at origin [0, 0, 0].
// Rendered as a glow sprite (same approach as entity nodes) — slightly
// brighter and larger. Label is ALWAYS visible (per spec: "the company name
// appears as a label").
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Glow texture for the center node — slightly larger, tighter core
// ---------------------------------------------------------------------------
function createCenterGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
  gradient.addColorStop(0.05, "rgba(255, 255, 255, 0.6)");
  gradient.addColorStop(0.12, "rgba(255, 255, 255, 0.15)");
  gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.03)");
  gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

let _centerGlowTexture: THREE.Texture | null = null;
function getCenterGlowTexture(): THREE.Texture {
  if (!_centerGlowTexture) _centerGlowTexture = createCenterGlowTexture();
  return _centerGlowTexture;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENTER_SIZE = 0.7; // Slightly larger than entity nodes (0.5)
const CENTER_COLOR = "#6F94B0";

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
  const threeColor = useMemo(() => new THREE.Color(CENTER_COLOR), []);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Billboard: always face the camera
    meshRef.current.quaternion.copy(state.camera.quaternion);

    // Gentle breathing pulse on the color intensity
    if (!prefersReducedMotion) {
      const t = state.clock.elapsedTime;
      const breathe = Math.sin(t * Math.PI * 0.5) * 0.08;
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      const intensity = 0.7 + breathe;
      mat.color.copy(threeColor).multiplyScalar(intensity);
    }
  });

  return (
    <>
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <planeGeometry args={[CENTER_SIZE, CENTER_SIZE]} />
        <meshBasicMaterial
          map={getCenterGlowTexture()}
          color={CENTER_COLOR}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Company name label — always visible */}
      <Html
        position={[0, 0.5, 0]}
        center
        distanceFactor={15}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="text-left whitespace-nowrap"
          style={{
            background: "radial-gradient(ellipse, var(--surface-glass) 0%, transparent 70%)",
            padding: "8px 16px",
            opacity: 0.9,
          }}
        >
          <div className="font-mohave text-xs text-white leading-tight">
            {companyName}
          </div>
          <div className="font-mono text-micro uppercase tracking-wider text-[#6F94B0] mt-0.5">
            your network
          </div>
        </div>
      </Html>
    </>
  );
}

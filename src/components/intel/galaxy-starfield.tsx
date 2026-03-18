"use client";

// ---------------------------------------------------------------------------
// GalaxyStarfield — ambient background particle field for the Intel Galaxy.
// Runs INSIDE a <Canvas> context (React Three Fiber component).
// Fills the void so sparse galaxies never feel empty.
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Reduced motion — read once at module level (never changes mid-session).
// Components that depend on this SSR-safe guard must check `typeof window`.
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Adaptive star count — keeps frame budget under control on low-end devices.
// Low-end threshold: ≤4 hardware threads (typical on older/low-power devices).
// ---------------------------------------------------------------------------
function getAdaptiveStarCount(): number {
  if (
    typeof navigator !== "undefined" &&
    navigator.hardwareConcurrency <= 4
  ) {
    return 200; // Low-end: fewer stars, lighter GPU load
  }
  return 800; // Standard: enough density to feel atmospheric
}

// ---------------------------------------------------------------------------
// GalaxyStarfield
// ---------------------------------------------------------------------------

export function GalaxyStarfield() {
  // pointsRef is typed as THREE.Points — useRef<THREE.Points> avoids TS errors
  // when accessing rotation inside useFrame.
  const pointsRef = useRef<THREE.Points>(null);

  const count = useMemo(() => getAdaptiveStarCount(), []);

  // ── Position buffer ──────────────────────────────────────────────────────
  // Generated once with useMemo — no allocation pressure per frame.
  // Technique: spherical coordinates via rejection-free parameterization.
  //   theta: azimuthal angle in [0, 2π)
  //   phi:   polar angle via arccos(2u-1) where u∈[0,1] — maps uniform random
  //           to a uniform distribution on the sphere surface (without this,
  //           naive theta/phi sampling clusters stars near the poles).
  //   r:     cube-root of uniform random → uniform distribution in sphere VOLUME
  //           (without cbrt, more stars cluster near center than edges).
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const SPHERE_RADIUS = 40; // World units — large enough to surround the galaxy

    for (let i = 0; i < count; i++) {
      // Uniform azimuthal angle
      const theta = Math.random() * 2 * Math.PI;

      // arccos(2u-1) maps uniform [0,1] → uniform distribution on sphere surface.
      // Without this, naive phi = random * π would cluster particles at the poles.
      const phi = Math.acos(2 * Math.random() - 1);

      // cbrt(u) maps uniform [0,1] → uniform volume distribution inside sphere.
      // Without cbrt, most points would cluster near the center (r² weighting).
      const r = SPHERE_RADIUS * Math.cbrt(Math.random());

      // Spherical → Cartesian
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    return pos;
  }, [count]);

  // ── Ambient rotation ─────────────────────────────────────────────────────
  // Rotate the entire starfield very slowly around Y to suggest the galaxy
  // is part of a living system — not a static backdrop.
  // Rate: 0.0001 rad/frame ≈ 0.006°/frame ≈ 1 full revolution in ~17 minutes.
  // Paused entirely when prefers-reduced-motion is set.
  useFrame(() => {
    if (prefersReducedMotion) return;
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.0001;
    }
  });

  return (
    <Points
      ref={pointsRef}
      positions={positions}
      // frustumCulled=false prevents Three.js from hiding the Points object
      // when its bounding sphere center drifts off-screen during rotation.
      frustumCulled={false}
    >
      <PointMaterial
        // Very small size: stars are suggestions of depth, not features.
        // 0.03 sits between the spec range of 0.02–0.04.
        size={0.03}
        // sizeAttenuation=true makes far stars appear smaller than near stars,
        // reinforcing the sense of depth in 3D space.
        sizeAttenuation={true}
        color="#ffffff"
        // Low opacity: stars should feel ambient, not dominant.
        // The value 0.2 is the midpoint of the spec range (0.1–0.3).
        // Individual variation would require per-vertex colors — keeping uniform
        // opacity keeps this component a single draw call.
        opacity={0.2}
        transparent={true}
        // Additive blending: overlapping stars brighten instead of covering
        // each other, creating soft nebula-like glow where stars cluster.
        blending={THREE.AdditiveBlending}
        // depthWrite=false prevents stars from occluding the galaxy nodes
        // (which also use additive blending). Without this, z-buffer writes
        // from the star field would cause z-fighting with node sprites.
        depthWrite={false}
      />
    </Points>
  );
}

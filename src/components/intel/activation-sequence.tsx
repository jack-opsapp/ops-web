"use client";

// ---------------------------------------------------------------------------
// ActivationSequence — orchestrates the "new intel" ignition animation.
//
// When the Intel page opens with entities newer than `intel_last_viewed_at`,
// this controller runs a 3-beat timeline:
//
//   Beat 1 (0-800ms): Existing nodes dim to 30%. New nodes brighten by cluster,
//     staggered. Each igniting node pulses scale 1.0→1.15→1.0 with inverse-square
//     glow bloom that additively blends with nearby activated nodes.
//
//   Beat 2 (800-2000ms): Edges between new nodes draw in — lines extend from
//     source to target, staggered by cluster.
//
//   Beat 3 (2000-2500ms): Existing nodes restore to full opacity. Edges fade to
//     proximity-reveal behavior. Galaxy settles into ambient drift.
//
// For 50+ new entities: batches of 5-8 per stagger beat (wave, not slideshow).
// For reduced motion: simultaneous fade-in over 600ms, no stagger or pulse.
//
// This component has NO visual output. It communicates with GalaxyNodes via
// the intel store: `activationPlaying` flag + `newEntityIds` array.
// The nodes themselves read these values per-frame to adjust opacity/scale.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { useIntelStore } from "@/stores/intel-store";

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Timeline durations (ms)
// ---------------------------------------------------------------------------
const BEAT_1_DURATION = 800;   // Ignition: new nodes brighten
const BEAT_2_DURATION = 1200;  // Connection draw: edges extend
const BEAT_3_DURATION = 500;   // Settle: restore existing nodes
const TOTAL_DURATION = BEAT_1_DURATION + BEAT_2_DURATION + BEAT_3_DURATION;

// Reduced motion: all nodes fade in simultaneously
const REDUCED_MOTION_DURATION = 600;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivationSequence() {
  const newEntityIds = useIntelStore((s) => s.newEntityIds);
  const setActivationPlaying = useIntelStore((s) => s.setActivationPlaying);
  const setNewEntityIds = useIntelStore((s) => s.setNewEntityIds);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    // Only play once per page load, and only if there are new entities
    if (newEntityIds.length === 0 || hasPlayedRef.current) return;
    hasPlayedRef.current = true;

    // Start the activation
    setActivationPlaying(true);

    const duration = prefersReducedMotion ? REDUCED_MOTION_DURATION : TOTAL_DURATION;

    // End the activation after the timeline completes
    timerRef.current = setTimeout(() => {
      setActivationPlaying(false);
      // Clear new entity IDs — they've been animated, now they're "seen"
      setNewEntityIds([]);
      // NOW update the last-viewed timestamp. We deliberately wait until
      // the animation completes so that a user who navigates away mid-animation
      // will see the activation again on their next visit.
      localStorage.setItem("intel_last_viewed_at", new Date().toISOString());
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [newEntityIds, setActivationPlaying, setNewEntityIds]);

  // No visual output — this is a pure controller
  return null;
}

// ---------------------------------------------------------------------------
// Exported constants for GalaxyNodes to reference during per-frame rendering
// ---------------------------------------------------------------------------

export const ACTIVATION_TIMELINE = {
  BEAT_1_DURATION,
  BEAT_2_DURATION,
  BEAT_3_DURATION,
  TOTAL_DURATION,
  REDUCED_MOTION_DURATION,
} as const;

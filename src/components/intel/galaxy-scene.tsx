"use client";

// ---------------------------------------------------------------------------
// GalaxyScene — the main Intel galaxy visualization.
//
// Full-bleed React Three Fiber Canvas that assembles all galaxy sub-components:
// starfield, nodes, center, edges, and post-processing. DOM overlay HUD
// elements (search, stats, zoom, legend, gate prompt, node info) float on top.
//
// This component is lazy-loaded via next/dynamic in the Intel page.
// Three.js (~150KB gzip) is not in the critical render path.
// ---------------------------------------------------------------------------

import { Suspense, useMemo, useEffect, useRef, useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { GalaxyStarfield } from "./galaxy-starfield";
import { GalaxyNodes } from "./galaxy-nodes";
import { GalaxyCenterNode } from "./galaxy-center";
import { GalaxyEdges } from "./galaxy-edges";
import { computeGalaxyLayout, type PositionedEntity } from "./galaxy-layout";
import { SearchPill } from "./hud/search-pill";
import { StatsRibbon } from "./hud/stats-ribbon";
import { ZoomControls } from "./hud/zoom-controls";
import { ClusterLegend } from "./hud/cluster-legend";
import { PhaseCGatePrompt } from "./hud/phase-c-gate-prompt";
import { NodeInfo } from "./node-info";
import { RedactedText } from "./redacted-text";
import { ActivationSequence } from "./activation-sequence";

import { useIntelGraph } from "@/lib/hooks/use-intel-graph";
import { useIntelStore } from "@/stores/intel-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Device + motion detection
// ---------------------------------------------------------------------------
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isLowEnd =
  typeof navigator !== "undefined" &&
  (navigator.hardwareConcurrency <= 4 ||
    ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? Infinity) <= 4);

const isTouchDevice =
  typeof window !== "undefined" && "ontouchstart" in window;

// ---------------------------------------------------------------------------
// GalaxyScene
// ---------------------------------------------------------------------------

export function GalaxyScene() {
  const { data, isLoading } = useIntelGraph();
  const { company } = useAuthStore();
  const { t } = useDictionary("intel");
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);

  // IntersectionObserver: pause the animation loop when the canvas is off-screen.
  // This prevents GPU work when the user navigated away but the component is
  // still mounted (e.g., tab switching within the dashboard).
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const is3DUnlocked = useIntelStore((s) => s.is3DUnlocked);
  const set3DUnlocked = useIntelStore((s) => s.set3DUnlocked);
  const setShowGatePrompt = useIntelStore((s) => s.setShowGatePrompt);
  const dismissSelection = useIntelStore((s) => s.dismissSelection);
  const setNewEntityIds = useIntelStore((s) => s.setNewEntityIds);

  // Determine Phase C gate status from API response
  useEffect(() => {
    if (data?.phaseCEnabled) {
      set3DUnlocked(true);
    }
  }, [data?.phaseCEnabled, set3DUnlocked]);

  // Detect new entities for activation animation
  useEffect(() => {
    if (!data?.entities) return;
    const lastViewed = localStorage.getItem("intel_last_viewed_at");
    if (!lastViewed) {
      // First visit — all entities are "new"
      setNewEntityIds(data.entities.map(e => e.id));
    } else {
      const lastViewedDate = new Date(lastViewed);
      const newIds = data.entities
        .filter(e => new Date(e.createdAt) > lastViewedDate)
        .map(e => e.id);
      if (newIds.length > 0) setNewEntityIds(newIds);
    }
    // NOTE: localStorage timestamp is NOT updated here. It's updated by
    // ActivationSequence after the animation completes. If we update it
    // immediately, a user who navigates away before the animation finishes
    // would lose the "new" state on their next visit.
  }, [data?.entities, setNewEntityIds]);

  // Compute galaxy layout from entities
  const layout = useMemo<PositionedEntity[]>(() => {
    if (!data?.entities || data.entities.length === 0) return [];
    return computeGalaxyLayout({
      entities: data.entities.map(e => ({
        id: e.id,
        cluster: e.cluster,
        type: e.type,
        confidence: e.confidence,
        properties: e.properties,
      })),
    });
  }, [data?.entities]);

  // Detect rotation attempts when 3D is locked.
  // OrbitControls' onStart fires on ALL interactions (pan, zoom, rotate),
  // so we can't use it. Instead, detect right-click drag or middle-click drag
  // (the gestures that map to rotation in OrbitControls' default config).
  // On desktop: left-click drag without modifier = rotate. But since we set
  // enableRotate=false, OrbitControls remaps left-drag to pan. So the user
  // can't actually "attempt" rotation via OrbitControls. Instead, we show
  // the gate prompt once on first visit (if not already shown this session).
  const gatePromptShownRef = useRef(false);
  useEffect(() => {
    if (!is3DUnlocked && !gatePromptShownRef.current && data?.entities && data.entities.length > 0) {
      // Show gate prompt once after data loads, with a delay so the galaxy
      // renders first and the user sees what they're missing
      const timer = setTimeout(() => {
        if (!gatePromptShownRef.current) {
          gatePromptShownRef.current = true;
          setShowGatePrompt(true);
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [is3DUnlocked, data?.entities, setShowGatePrompt]);

  // Click on empty space dismisses selection.
  // Node clicks are handled by Three.js raycasting inside the Canvas (not DOM
  // events), so they don't propagate to this handler. We only need to check
  // that the click target is the <canvas> element itself (not a HUD overlay).
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "CANVAS") {
        dismissSelection();
      }
    },
    [dismissSelection]
  );

  const companyName = company?.name || "Your Company";

  return (
    <div ref={containerRef} className="w-full h-full relative" onClick={handleCanvasClick}>
      <Canvas
        camera={{
          position: [0, 0, 20],
          fov: 60,
          near: 0.1,
          far: 100,
        }}
        dpr={isLowEnd ? [1, 1] : [1, 2]}
        gl={{ antialias: !isLowEnd, alpha: false }}
        style={{ background: "#0A0A0A" }}
        // Frame loop: "demand" for reduced motion or when not visible.
        // "always" for continuous animation (ambient drift, breathing).
        frameloop={prefersReducedMotion || !isVisible ? "demand" : "always"}
      >
        <Suspense fallback={null}>
          {/* Ambient light — very subtle, just enough so nodes aren't pure black */}
          <ambientLight intensity={0.2} />

          {/* OrbitControls: pan + zoom always, rotation only when Phase C unlocked */}
          <OrbitControls
            ref={controlsRef}
            enableRotate={is3DUnlocked}
            enableZoom={true}
            enablePan={true}
            // Zoom limits: don't let user fly infinitely far or clip through
            minDistance={3}
            maxDistance={50}
            // Smooth damping for all camera moves
            enableDamping={!prefersReducedMotion}
            dampingFactor={0.05}
            // Touch: pinch to zoom, two-finger pan.
            // One-finger drag = rotate (if unlocked) or pan (if locked).
            touches={{
              ONE: is3DUnlocked ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN,
              TWO: THREE.TOUCH.DOLLY_PAN,
            }}
            // NOTE: onStart fires on ALL interactions (pan, zoom, rotate).
            // We detect rotation attempts via a separate pointer handler below
            // instead of using onStart, which would spam the gate prompt on
            // every pan/zoom gesture.
          />

          {/* Background: ambient star field */}
          <GalaxyStarfield />

          {/* Center: self/company node */}
          <GalaxyCenterNode companyName={companyName} />

          {/* Entity nodes */}
          {layout.length > 0 && data?.entities && (
            <GalaxyNodes
              positionedEntities={layout}
              entities={data.entities.map(e => ({
                id: e.id,
                name: e.name,
                type: e.type,
                cluster: e.cluster,
              }))}
            />
          )}

          {/* Proximity-revealed edges */}
          {layout.length > 0 && data?.edges && (
            <GalaxyEdges
              edges={data.edges}
              positionedEntities={layout}
            />
          )}

          {/* Post-processing: subtle bloom for node glow */}
          {!isLowEnd && !prefersReducedMotion && (
            <EffectComposer>
              <Bloom
                // luminanceThreshold: only bloom pixels brighter than 60%.
                // This catches the emissive node glow without blooming
                // the starfield or edge lines.
                luminanceThreshold={0.6}
                // intensity: subtle, not sci-fi movie. The bloom should feel
                // like light diffraction, not a filter.
                intensity={0.4}
                // mipmapBlur: higher quality bloom via mipmap chain.
                // Cheaper than the default multi-pass approach.
                mipmapBlur
                luminanceSmoothing={0.2}
              />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-kosugi text-[10px] uppercase tracking-wider text-[#999] animate-pulse">
            [ LOADING INTEL ]
          </span>
        </div>
      )}

      {/* Activation animation controller — no visual output */}
      <ActivationSequence />

      {/* ── HUD Overlays ─────────────────────────────────────────────── */}

      {/* Top-left: Search */}
      {!isLoading && data?.entities && (
        <div className="absolute top-4 left-4 z-10">
          <SearchPill entities={data.entities} />
        </div>
      )}

      {/* Top-right: Stats */}
      {!isLoading && data?.stats && (
        <div className="absolute top-4 right-4 z-10">
          <StatsRibbon
            entityCount={data.stats.entityCount}
            edgeCount={data.stats.edgeCount}
            profileCount={data.stats.profileCount}
            lastScanAt={data.stats.lastScanAt}
          />
        </div>
      )}

      {/* Bottom-left: Cluster legend */}
      {!isLoading && (
        <div className="absolute bottom-4 left-4 z-10">
          <ClusterLegend />
        </div>
      )}

      {/* Bottom-right: Zoom controls */}
      {!isLoading && (
        <div className="absolute bottom-4 right-4 z-10">
          <ZoomControls
            onZoomIn={() => {
              if (controlsRef.current) {
                // Dolly in by reducing distance. The camera moves 20% closer.
                const controls = controlsRef.current as unknown as { dollyIn: (scale: number) => void; update: () => void };
                if (typeof controls.dollyIn === 'function') {
                  controls.dollyIn(1.2);
                  controls.update();
                }
              }
            }}
            onZoomOut={() => {
              if (controlsRef.current) {
                const controls = controlsRef.current as unknown as { dollyOut: (scale: number) => void; update: () => void };
                if (typeof controls.dollyOut === 'function') {
                  controls.dollyOut(1.2);
                  controls.update();
                }
              }
            }}
            onReset={() => {
              controlsRef.current?.reset();
            }}
          />
        </div>
      )}

      {/* Center: Phase C gate prompt */}
      <PhaseCGatePrompt
        onRequestAccess={() => {
          // Open the FeatureAccessModal — dispatch via a custom event
          // that the Intel page listens for, or directly set state.
          // For now, navigate to settings where the request flow exists.
          window.location.href = "/settings";
        }}
      />

      {/* Right: Node info panel (Tier 2 + Tier 3) */}
      {data?.entities && (
        <NodeInfo entities={data.entities} />
      )}

      {/* Empty state: no data at all */}
      {!isLoading && data?.entities && data.entities.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div
            className="pointer-events-auto text-left max-w-[260px] px-6 py-5 space-y-3"
            style={{
              background: "rgba(10, 10, 10, 0.80)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "3px",
            }}
          >
            <div className="font-kosugi text-[10px] uppercase tracking-wider text-[#597794]">
              [ INTEL ]
            </div>
            <div className="font-mohave text-sm text-white leading-relaxed">
              <RedactedText>{t("empty.noData")}</RedactedText>
            </div>
            <a
              href="/settings"
              className="inline-block font-kosugi text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-[2px] transition-colors"
              style={{
                background: "rgba(89, 119, 148, 0.15)",
                border: "1px solid rgba(89, 119, 148, 0.3)",
                color: "#597794",
              }}
            >
              {t("empty.connectEmail")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

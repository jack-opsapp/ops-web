"use client";

// ---------------------------------------------------------------------------
// GalaxyScene — the main Intel galaxy visualization.
//
// Full-bleed React Three Fiber Canvas with hierarchical zoom:
//   Level 1: Clients orbit organization center
//   Level 2: Click client → projects orbit it
//   Level 3: Click project → tasks/team/financial orbit it
//
// DOM overlay HUD elements float on top of the Canvas.
// Lazy-loaded via next/dynamic — Three.js not in the critical path.
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
import { GalaxyCamera } from "./galaxy-camera";
import { computeHierarchicalLayout, type PositionedNode } from "./galaxy-layout";
import { SearchPill } from "./hud/search-pill";
import { StatsRibbon } from "./hud/stats-ribbon";
import { ZoomControls } from "./hud/zoom-controls";
import { ClusterLegend } from "./hud/cluster-legend";
import { BackButton } from "./hud/back-button";
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

  // IntersectionObserver: pause animation loop when off-screen
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Store selectors
  const is3DUnlocked = useIntelStore((s) => s.is3DUnlocked);
  const set3DUnlocked = useIntelStore((s) => s.set3DUnlocked);
  const setShowGatePrompt = useIntelStore((s) => s.setShowGatePrompt);
  const dismissSelection = useIntelStore((s) => s.dismissSelection);
  const setNewEntityIds = useIntelStore((s) => s.setNewEntityIds);
  const focusLevel = useIntelStore((s) => s.focusLevel);
  const focusedClientId = useIntelStore((s) => s.focusedClientId);
  const focusedProjectId = useIntelStore((s) => s.focusedProjectId);

  // Phase C gate
  useEffect(() => {
    if (data?.phaseCEnabled) set3DUnlocked(true);
  }, [data?.phaseCEnabled, set3DUnlocked]);

  // Detect new entities for activation animation
  useEffect(() => {
    if (!data?.entities) return;
    const lastViewed = localStorage.getItem("intel_last_viewed_at");
    if (!lastViewed) {
      setNewEntityIds(data.entities.map(e => e.id));
    } else {
      const lastViewedDate = new Date(lastViewed);
      const newIds = data.entities
        .filter(e => new Date(e.createdAt) > lastViewedDate)
        .map(e => e.id);
      if (newIds.length > 0) setNewEntityIds(newIds);
    }
  }, [data?.entities, setNewEntityIds]);

  // ── Compute hierarchical layout ──────────────────────────────────────
  const layout = useMemo<PositionedNode[]>(() => {
    if (!data?.clientsWithStatus) return [];
    return computeHierarchicalLayout({
      clients: data.clientsWithStatus,
      projects: data.entities
        .filter(e => e.type === "project")
        .map(e => ({
          id: e.id,
          clientId: (e.properties.clientId as string) ?? "",
          title: e.name,
          status: (e.properties.status as string) ?? "RFQ",
          address: (e.properties.address as string) ?? null,
        })),
      tasks: data.tasks ?? [],
      teamMembers: data.teamMembers ?? [],
      financialEntities: data.entities
        .filter(e => e.type === "invoice" || e.type === "estimate")
        .map(e => ({
          id: e.id,
          projectId: (e.properties.projectId as string) ?? null,
          name: e.name,
          type: e.type as "invoice" | "estimate",
          total: (e.properties.total as number) ?? null,
          status: (e.properties.status as string) ?? null,
        })),
      focusLevel,
      focusedClientId,
      focusedProjectId,
    });
  }, [data, focusLevel, focusedClientId, focusedProjectId]);

  // ── Unified Escape handler ───────────────────────────────────────────
  // Priority: dismiss selection first, then navigate back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const state = useIntelStore.getState();
        if (state.selectedNodeId || state.expandedNodeId) {
          state.dismissSelection();
        } else if (state.focusLevel > 1) {
          state.focusBack();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Phase C gate prompt — show once after data loads if not unlocked
  const gatePromptShownRef = useRef(false);
  useEffect(() => {
    if (!is3DUnlocked && !gatePromptShownRef.current && data?.entities && data.entities.length > 0) {
      const timer = setTimeout(() => {
        if (!gatePromptShownRef.current) {
          gatePromptShownRef.current = true;
          setShowGatePrompt(true);
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [is3DUnlocked, data?.entities, setShowGatePrompt]);

  // Click on empty space (canvas) dismisses selection.
  // R3F click handlers set this ref to true when they handle a node click.
  // The DOM handler checks it to avoid immediately undoing the R3F action.
  // Without this, clicking a node would: 1) focus it via R3F, then 2) dismiss
  // it via DOM bubbling — making all clicks appear broken.
  const r3fHandledClickRef = useRef(false);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "CANVAS") {
        // If R3F already handled this click (on a node), skip dismissal
        if (r3fHandledClickRef.current) {
          r3fHandledClickRef.current = false;
          return;
        }
        dismissSelection();
      }
    },
    [dismissSelection]
  );

  const companyName = company?.name || "Your Company";

  // Projects need client_id linkage — build from entities that have it
  const projectClientMap = useMemo(() => {
    if (!data?.entities) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const e of data.entities) {
      if (e.type === "project" && e.properties.clientId) {
        // The entities array stores clients with the "person" type but in "client" cluster.
        // Projects reference clients via edges. We need to find client_id.
        // It's stored in the edge (owns_project) sourceId.
      }
    }
    // Use edges to map project → client
    for (const edge of data.edges ?? []) {
      if (edge.predicate === "owns_project") {
        map.set(edge.targetId, edge.sourceId); // project → client
      }
    }
    return map;
  }, [data?.entities, data?.edges]);

  // Enrich projects with clientId for the layout
  const enrichedLayout = useMemo<PositionedNode[]>(() => {
    if (!data?.clientsWithStatus) return [];

    // Build projects array with proper clientId from edges
    const projects = data.entities
      .filter(e => e.type === "project")
      .map(e => ({
        id: e.id,
        clientId: projectClientMap.get(e.id) ?? "",
        title: e.name,
        status: (e.properties.status as string) ?? "RFQ",
        address: (e.properties.address as string) ?? null,
      }));

    return computeHierarchicalLayout({
      clients: data.clientsWithStatus,
      projects,
      tasks: data.tasks ?? [],
      teamMembers: data.teamMembers ?? [],
      financialEntities: data.entities
        .filter(e => e.type === "invoice" || e.type === "estimate")
        .map(e => ({
          id: e.id,
          projectId: (e.properties.projectId as string) ?? null,
          name: e.name,
          type: e.type as "invoice" | "estimate",
          total: (e.properties.total as number) ?? null,
          status: (e.properties.status as string) ?? null,
        })),
      focusLevel,
      focusedClientId,
      focusedProjectId,
    });
  }, [data, focusLevel, focusedClientId, focusedProjectId, projectClientMap]);

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
        frameloop={prefersReducedMotion || !isVisible ? "demand" : "always"}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.2} />

          <OrbitControls
            ref={controlsRef}
            enableRotate={true}
            enableZoom={true}
            enablePan={true}
            minDistance={3}
            maxDistance={50}
            enableDamping={!prefersReducedMotion}
            dampingFactor={0.05}
            mouseButtons={{
              LEFT: THREE.MOUSE.PAN,
              MIDDLE: THREE.MOUSE.ROTATE,
              RIGHT: THREE.MOUSE.PAN,
            }}
            touches={{
              ONE: THREE.TOUCH.PAN,
              TWO: THREE.TOUCH.DOLLY_PAN,
            }}
            zoomToCursor={true}
            zoomSpeed={1.2}
          />

          {/* Camera fly-to animation controller */}
          <GalaxyCamera controlsRef={controlsRef as React.RefObject<{ target: THREE.Vector3; update: () => void } | null>} />

          {/* Background star field */}
          <GalaxyStarfield />

          {/* Center: organization node */}
          <GalaxyCenterNode companyName={companyName} />

          {/* Entity nodes (hierarchical) */}
          {enrichedLayout.length > 0 && (
            <GalaxyNodes nodes={enrichedLayout} onNodeClick={() => { r3fHandledClickRef.current = true; }} />
          )}

          {/* Edges (hover/click only, L2+) */}
          {enrichedLayout.length > 0 && data?.edges && (
            <GalaxyEdges
              edges={data.edges}
              nodes={enrichedLayout}
            />
          )}

          {/* Post-processing: subtle bloom */}
          {!isLowEnd && !prefersReducedMotion && (
            <EffectComposer>
              <Bloom
                luminanceThreshold={0.6}
                intensity={0.4}
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

      {/* Activation animation controller */}
      <ActivationSequence />

      {/* ── HUD Overlays ──────────────────────────────────────────────── */}

      {/* Top-left: Search */}
      {!isLoading && data?.entities && (
        <div className="absolute top-4 left-4 z-10">
          <SearchPill entities={data.entities} />
        </div>
      )}

      {/* Top-left: Back button (below search, only at L2+) */}
      <div className="absolute top-14 left-4 z-10">
        <BackButton />
      </div>

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
                const controls = controlsRef.current as unknown as { dollyIn: (s: number) => void; update: () => void };
                if (typeof controls.dollyIn === "function") {
                  controls.dollyIn(1.2);
                  controls.update();
                }
              }
            }}
            onZoomOut={() => {
              if (controlsRef.current) {
                const controls = controlsRef.current as unknown as { dollyOut: (s: number) => void; update: () => void };
                if (typeof controls.dollyOut === "function") {
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
          window.location.href = "/settings";
        }}
      />

      {/* Right: Node info panel (Tier 2 + Tier 3) */}
      {data?.entities && (
        <NodeInfo entities={data.entities} />
      )}

      {/* Empty state: no data at all */}
      {!isLoading && data?.entities && data.entities.length === 0 && !data.clientsWithStatus?.length && (
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

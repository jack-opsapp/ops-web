"use client";

/**
 * GalaxyThreadDensityHalos — Inbox v2 overlay for the Intel galaxy.
 *
 * Renders a translucent ring around each CLIENT node with:
 *   - radius   = f(thread_count)   → logarithmic scale, capped
 *   - color    = f(recency)        → fresh (ops-accent) → cold (muted)
 *   - opacity  = f(thread_count)   → more threads = brighter
 *
 * Data source: public.get_inbox_density_per_client(company_id) RPC (Phase 6).
 *
 * Design choices:
 *   - RingGeometry (inner/outer radius) rather than additive bloom sprites:
 *     keeps the galaxy scene readable and avoids competing with the node
 *     glows. A thin ring is a halo — a bloom would look like a second node.
 *   - Billboarded to the camera every frame so the ring stays a circle
 *     regardless of camera angle.
 *   - Zero interaction — pointer events pass through to the node hit-targets.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { PositionedNode } from "./galaxy-layout";

// ─── Data ────────────────────────────────────────────────────────────────────

interface DensityRow {
  clientId: string;
  threadCount: number;
  lastMessageAt: Date;
}

async function fetchDensity(companyId: string): Promise<DensityRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("get_inbox_density_per_client", {
    p_company_id: companyId,
  });
  if (error) {
    console.error("[intel] density rpc failed:", error);
    return [];
  }
  return ((data ?? []) as Array<{
    client_id: string;
    thread_count: number;
    last_message_at: string;
  }>).map((row) => ({
    clientId: row.client_id,
    threadCount: row.thread_count,
    lastMessageAt: new Date(row.last_message_at),
  }));
}

// ─── Color temperature ───────────────────────────────────────────────────────

const COLOR_FRESH = new THREE.Color("#6F94B0");  // <= 24h
const COLOR_WARM = new THREE.Color("#9DB582");    // <= 7d
const COLOR_TEPID = new THREE.Color("#C4A868");   // <= 30d
const COLOR_COLD = new THREE.Color("#6A6A6A");    // > 30d

function colorForRecency(lastMessageAt: Date): THREE.Color {
  const ms = Date.now() - lastMessageAt.getTime();
  if (ms <= 86_400_000) return COLOR_FRESH;
  if (ms <= 7 * 86_400_000) return COLOR_WARM;
  if (ms <= 30 * 86_400_000) return COLOR_TEPID;
  return COLOR_COLD;
}

// ─── Radius scaling ──────────────────────────────────────────────────────────

const MIN_THREADS_FOR_HALO = 1;
const MIN_RING_RADIUS = 0.18;   // just slightly larger than node sprite (0.35/2 ≈ 0.175)
const MAX_RING_RADIUS = 0.95;   // cap so dense clients don't dominate
const RING_THICKNESS = 0.022;   // outer - inner

/**
 * Log-scale radius. Single thread = min radius, 25+ threads approaches max.
 * The log mapping is deliberate: activity differences matter more at low
 * counts (1 vs 3 threads is meaningful) and flatten at high counts (20 vs
 * 50 threads both feel "loud").
 */
function radiusForThreads(count: number): number {
  const clamped = Math.max(MIN_THREADS_FOR_HALO, count);
  const t = Math.min(1, Math.log(clamped + 1) / Math.log(26));
  return MIN_RING_RADIUS + t * (MAX_RING_RADIUS - MIN_RING_RADIUS);
}

function opacityForThreads(count: number): number {
  const clamped = Math.max(MIN_THREADS_FOR_HALO, count);
  const t = Math.min(1, Math.log(clamped + 1) / Math.log(26));
  return 0.28 + t * 0.32; // 0.28 → 0.60
}

// ─── Component ───────────────────────────────────────────────────────────────

interface GalaxyThreadDensityHalosProps {
  nodes: PositionedNode[];
}

export function GalaxyThreadDensityHalos({ nodes }: GalaxyThreadDensityHalosProps) {
  const { company } = useAuthStore();

  const { data: rows } = useQuery({
    queryKey: ["intel", "inbox-density", company?.id ?? ""],
    queryFn: () => fetchDensity(company!.id),
    enabled: !!company?.id,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const densityByClient = useMemo(() => {
    const m = new Map<string, DensityRow>();
    for (const r of rows ?? []) m.set(r.clientId, r);
    return m;
  }, [rows]);

  const ringData = useMemo(() => {
    return nodes
      .filter((n) => n.visible && n.nodeType === "client")
      .map((n) => {
        const density = densityByClient.get(n.entityId);
        if (!density) return null;
        return {
          entityId: n.entityId,
          position: n.position,
          radius: radiusForThreads(density.threadCount),
          color: colorForRecency(density.lastMessageAt),
          opacity: opacityForThreads(density.threadCount),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [nodes, densityByClient]);

  if (ringData.length === 0) return null;

  return (
    <group>
      {ringData.map((r) => (
        <ThreadDensityRing
          key={r.entityId}
          position={r.position}
          radius={r.radius}
          color={r.color}
          opacity={r.opacity}
        />
      ))}
    </group>
  );
}

// ─── Single ring ─────────────────────────────────────────────────────────────

interface ThreadDensityRingProps {
  position: [number, number, number];
  radius: number;
  color: THREE.Color;
  opacity: number;
}

function ThreadDensityRing({
  position,
  radius,
  color,
  opacity,
}: ThreadDensityRingProps) {
  const ref = useRef<THREE.Mesh>(null);

  // Billboard to camera — the ring reads as a circle from every angle.
  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.lookAt(camera.position);
  });

  return (
    <mesh ref={ref} position={position} raycast={() => null}>
      <ringGeometry
        args={[radius - RING_THICKNESS, radius, 48]}
      />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/* ── src/app/admin/_components/flow-galaxy/flow-galaxy-canvas.tsx ── */

'use client';

import { useRef, useEffect, useCallback } from 'react';
import type {
  GalaxyCamera, UniverseData, AmbientStar, GalaxyNode,
  FlowParticle, OrbitParticle, DropoffParticle, TraceState,
  ContextMenuState,
} from './types';
import {
  CAMERA_LERP, MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM,
  STAR_COUNT, NODE_HIT_RADIUS, NODE_POSITIONS_KEY,
  ACCENT, AMBER, HEALTH_COLORS,
  worldToScreen, screenToWorld, zoomOpacity, healthToColor,
  ZOOM_UNIVERSE, ZOOM_GALAXY, ZOOM_DETAIL,
} from './types';

/* ── Star generation ── */

function generateStars(count: number): AmbientStar[] {
  const stars: AmbientStar[] = [];
  // 4 clusters + scattered
  const clusters = [
    { x: -800, y: 0 },   // landing galaxy area
    { x: 800, y: 0 },    // app galaxy area
    { x: 0, y: -400 },   // above
    { x: 0, y: 400 },    // below
  ];

  for (let i = 0; i < count; i++) {
    const clusterIndex = i < count * 0.6
      ? Math.floor(Math.random() * clusters.length)
      : -1; // scattered

    let x: number, y: number;
    if (clusterIndex >= 0) {
      const c = clusters[clusterIndex];
      x = c.x + (Math.random() - 0.5) * 800;
      y = c.y + (Math.random() - 0.5) * 600;
    } else {
      x = (Math.random() - 0.5) * 3200;
      y = (Math.random() - 0.5) * 2000;
    }

    stars.push({
      x, y,
      size: 0.5 + Math.random() * 1.5,
      baseAlpha: 0.05 + Math.random() * 0.12,
      phaseOffset: Math.random() * Math.PI * 2,
      clusterIndex,
    });
  }
  return stars;
}

/* ── Props ── */

interface FlowGalaxyCanvasProps {
  universe: UniverseData | null;
  loading: boolean;
  error: string | null;
  onNodeClick: (nodeId: string, screenX: number, screenY: number) => void;
  onNodeRightClick: (nodeId: string, screenX: number, screenY: number) => void;
  onEmptyClick: () => void;
  selectedNodeId: string | null;
  trace: TraceState | null;
  cameraRef: React.MutableRefObject<GalaxyCamera>;
  onNodeDragEnd?: (nodeId: string, dx: number, dy: number) => void;
}

export function FlowGalaxyCanvas({
  universe,
  loading,
  error,
  onNodeClick,
  onNodeRightClick,
  onEmptyClick,
  selectedNodeId,
  trace,
  cameraRef,
  onNodeDragEnd,
}: FlowGalaxyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const prevTimestampRef = useRef<number>(0);
  const starsRef = useRef<AmbientStar[]>(generateStars(STAR_COUNT));
  const reducedMotionRef = useRef(false);

  // Mouse
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const hoveredNodeRef = useRef<string | null>(null);

  // Drag state
  const dragRef = useRef<{
    active: boolean;
    nodeId: string | null;
    startWx: number;
    startWy: number;
    startMouseX: number;
    startMouseY: number;
    isPan: boolean;
    panStartCamX: number;
    panStartCamY: number;
    moved: boolean;
  }>({
    active: false, nodeId: null,
    startWx: 0, startWy: 0, startMouseX: 0, startMouseY: 0,
    isPan: false, panStartCamX: 0, panStartCamY: 0, moved: false,
  });

  // Particles
  const flowParticlesRef = useRef<FlowParticle[]>([]);
  const orbitParticlesRef = useRef<OrbitParticle[]>([]);
  const dropoffParticlesRef = useRef<DropoffParticle[]>([]);
  const particlesInitializedRef = useRef(false);

  /* ── Resize handler ── */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  /* ── Initialize particles from universe data ── */
  const initParticles = useCallback((uni: UniverseData) => {
    if (particlesInitializedRef.current) return;
    particlesInitializedRef.current = true;

    const allEdges = [
      ...uni.galaxies.flatMap(g => g.edges),
      ...uni.bridgeEdges,
    ];
    const allNodes = uni.galaxies.flatMap(g => g.nodes);

    // Flow particles
    const flowP: FlowParticle[] = [];
    for (const edge of allEdges) {
      for (let i = 0; i < edge.particleCount; i++) {
        const sourceNode = allNodes.find(n => n.id === edge.sourceId);
        const color = sourceNode ? healthToColor(sourceNode.healthTier) : ACCENT;
        flowP.push({
          edgeId: edge.id,
          progress: Math.random(),
          speed: 0.003 + Math.random() * 0.003,
          lateralOffset: (Math.random() - 0.5) * 16,
          color,
          size: 1.0 + Math.random() * 0.5,
          alpha: 0,
        });
      }
    }
    flowParticlesRef.current = flowP;

    // Orbit particles
    const orbitP: OrbitParticle[] = [];
    for (const node of allNodes) {
      if (node.depth > 0) continue;
      const dwellScore = Math.min(1, node.avgDwellMs / 10000);
      const count = Math.round(dwellScore * 8);
      for (let i = 0; i < count; i++) {
        orbitP.push({
          nodeId: node.id,
          angle: Math.random() * Math.PI * 2,
          orbitRadius: node.radius + 6 + Math.random() * 6,
          speed: 0.01 + Math.random() * 0.02,
          alpha: 0.2 + Math.random() * 0.15,
        });
      }
    }
    orbitParticlesRef.current = orbitP;

    // Dropoff particles
    const dropP: DropoffParticle[] = [];
    for (const node of allNodes) {
      if (node.depth > 0) continue;
      const count = Math.round(node.dropoffRate * 6);
      for (let i = 0; i < count; i++) {
        dropP.push({
          nodeId: node.id,
          angle: Math.random() * Math.PI * 2,
          distance: Math.random() * 40,
          maxDistance: 30 + Math.random() * 30,
          speed: 0.3 + Math.random() * 0.3,
          alpha: 0.4,
        });
      }
    }
    dropoffParticlesRef.current = dropP;
  }, []);

  /* ── Find node at screen position ── */
  const findNodeAtScreen = useCallback((
    sx: number, sy: number, uni: UniverseData, cam: GalaxyCamera, cx: number, cy: number,
  ): GalaxyNode | null => {
    const allNodes = uni.galaxies.flatMap(g => g.nodes);
    let closest: GalaxyNode | null = null;
    let closestDist = Infinity;

    for (const node of allNodes) {
      const opacity = zoomOpacity(cam.zoom, node.minZoom, node.maxZoom);
      if (opacity < 0.1) continue;

      const nsx = cx + (node.wx + node.dragOffsetX - cam.x) * cam.zoom;
      const nsy = cy + (node.wy + node.dragOffsetY - cam.y) * cam.zoom;
      const hitR = Math.max(NODE_HIT_RADIUS, node.radius * cam.zoom);
      const dist = Math.sqrt((sx - nsx) ** 2 + (sy - nsy) ** 2);

      if (dist < hitR && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }
    return closest;
  }, []);

  /* ── Main animation loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedMotionRef.current = reduced;

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    function draw(timestamp: number) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;
      const dt = Math.min((timestamp - prevTimestampRef.current) / 1000, 0.1);
      prevTimestampRef.current = timestamp;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const cam = cameraRef.current;
      const reduced = reducedMotionRef.current;

      // ── Lerp camera ──
      if (!reduced) {
        cam.x += (cam.targetX - cam.x) * CAMERA_LERP;
        cam.y += (cam.targetY - cam.y) * CAMERA_LERP;
        cam.zoom += (cam.targetZoom - cam.zoom) * CAMERA_LERP;
      } else {
        cam.x = cam.targetX;
        cam.y = cam.targetY;
        cam.zoom = cam.targetZoom;
      }

      // ── Draw ambient stars ──
      const stars = starsRef.current;
      const t = timestamp / 1000;
      for (const star of stars) {
        const parallax = 0.3;
        const sx = cx + (star.x - cam.x * parallax) * cam.zoom;
        const sy = cy + (star.y - cam.y * parallax) * cam.zoom;

        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;

        const twinkle = reduced ? 0 : 0.04 * Math.sin(t * 0.5 + star.phaseOffset);
        const alpha = star.baseAlpha + twinkle;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(sx, sy, star.size * cam.zoom, star.size * cam.zoom);
      }

      // ── Draw universe data ──
      if (universe && !loading) {
        if (!particlesInitializedRef.current) {
          initParticles(universe);
        }

        const allNodes = universe.galaxies.flatMap(g => g.nodes);
        const allEdges = [
          ...universe.galaxies.flatMap(g => g.edges),
          ...universe.bridgeEdges,
        ];

        // ── Update & draw flow particles ──
        if (!reduced) {
          for (const p of flowParticlesRef.current) {
            p.progress += p.speed;
            if (p.progress > 1) {
              p.progress -= 1;
              p.speed = 0.003 + Math.random() * 0.003;
              p.lateralOffset = (Math.random() - 0.5) * 16;
            }

            const edge = allEdges.find(e => e.id === p.edgeId);
            if (!edge) continue;
            const srcNode = allNodes.find(n => n.id === edge.sourceId);
            const tgtNode = allNodes.find(n => n.id === edge.targetId);
            if (!srcNode || !tgtNode) continue;

            // Check visibility: edge visible if either endpoint is visible
            const srcOpacity = zoomOpacity(cam.zoom, srcNode.minZoom, srcNode.maxZoom);
            const tgtOpacity = zoomOpacity(cam.zoom, tgtNode.minZoom, tgtNode.maxZoom);
            const edgeOpacity = Math.max(srcOpacity, tgtOpacity);
            if (edgeOpacity < 0.05) continue;

            // Trace mode dimming
            let traceDim = 1;
            if (trace?.active && !trace.highlightedEdgeIds.has(edge.id)) {
              traceDim = 0.05;
            }

            const wx = srcNode.wx + srcNode.dragOffsetX + (tgtNode.wx + tgtNode.dragOffsetX - srcNode.wx - srcNode.dragOffsetX) * p.progress;
            const wy = srcNode.wy + srcNode.dragOffsetY + (tgtNode.wy + tgtNode.dragOffsetY - srcNode.wy - srcNode.dragOffsetY) * p.progress;

            // Lateral offset perpendicular to edge direction
            const edx = tgtNode.wx - srcNode.wx;
            const edy = tgtNode.wy - srcNode.wy;
            const elen = Math.sqrt(edx * edx + edy * edy) || 1;
            const pxOff = (-edy / elen) * p.lateralOffset;
            const pyOff = (edx / elen) * p.lateralOffset;

            const { sx, sy } = worldToScreen(wx + pxOff, wy + pyOff, cam, cx, cy);
            p.alpha = (0.15 + 0.25 * Math.sin(p.progress * Math.PI)) * edgeOpacity * traceDim;

            if (sx > -10 && sx < w + 10 && sy > -10 && sy < h + 10) {
              ctx.beginPath();
              ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${p.alpha})`;
              ctx.fill();
            }
          }
        }

        // ── Update & draw orbit particles ──
        if (!reduced) {
          for (const p of orbitParticlesRef.current) {
            p.angle += p.speed;
            const node = allNodes.find(n => n.id === p.nodeId);
            if (!node) continue;
            const opacity = zoomOpacity(cam.zoom, node.minZoom, node.maxZoom);
            if (opacity < 0.05) continue;

            const owx = node.wx + node.dragOffsetX + Math.cos(p.angle) * p.orbitRadius;
            const owy = node.wy + node.dragOffsetY + Math.sin(p.angle) * p.orbitRadius;
            const { sx, sy } = worldToScreen(owx, owy, cam, cx, cy);
            const col = healthToColor(node.healthTier);

            ctx.beginPath();
            ctx.arc(sx, sy, 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${p.alpha * opacity})`;
            ctx.fill();
          }
        }

        // ── Update & draw dropoff particles ──
        if (!reduced) {
          for (const p of dropoffParticlesRef.current) {
            p.distance += p.speed * dt * 60;
            if (p.distance > p.maxDistance) {
              p.distance = 0;
              p.angle = Math.random() * Math.PI * 2;
            }
            p.alpha = 0.4 * (1 - p.distance / p.maxDistance);

            const node = allNodes.find(n => n.id === p.nodeId);
            if (!node) continue;
            const opacity = zoomOpacity(cam.zoom, node.minZoom, node.maxZoom);
            if (opacity < 0.05) continue;

            const dwx = node.wx + node.dragOffsetX + Math.cos(p.angle) * p.distance;
            const dwy = node.wy + node.dragOffsetY + Math.sin(p.angle) * p.distance;
            const { sx, sy } = worldToScreen(dwx, dwy, cam, cx, cy);

            ctx.beginPath();
            ctx.arc(sx, sy, 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(147,65,55,${p.alpha * opacity})`;
            ctx.fill();
          }
        }

        // ── Draw galaxy labels (universe zoom level) ──
        if (cam.zoom < ZOOM_UNIVERSE + 0.1) {
          const labelAlpha = Math.max(0, 1 - (cam.zoom - 0.15) / 0.2);
          for (const galaxy of universe.galaxies) {
            const { sx, sy } = worldToScreen(galaxy.centerX, galaxy.centerY - 60, cam, cx, cy);
            ctx.fillStyle = `rgba(229,229,229,${labelAlpha * 0.6})`;
            ctx.font = '14px Mohave, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(galaxy.label, sx, sy);

            // Galaxy glow
            const gsx = cx + (galaxy.centerX - cam.x) * cam.zoom;
            const gsy = cy + (galaxy.centerY - cam.y) * cam.zoom;
            const glowR = 120 * cam.zoom;
            const g = ctx.createRadialGradient(gsx, gsy, 0, gsx, gsy, glowR);
            g.addColorStop(0, `rgba(89,119,148,${0.08 * labelAlpha})`);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.fillRect(gsx - glowR, gsy - glowR, glowR * 2, glowR * 2);
          }
        }

        // ── Draw nodes ──
        // Sort by depth so parents draw first (depth 0 → 1 → 2)
        const sortedNodes = [...allNodes].sort((a, b) => a.depth - b.depth);
        hoveredNodeRef.current = null;

        for (const node of sortedNodes) {
          const opacity = zoomOpacity(cam.zoom, node.minZoom, node.maxZoom);
          if (opacity < 0.01) continue;

          const nwx = node.wx + node.dragOffsetX;
          const nwy = node.wy + node.dragOffsetY;
          const { sx, sy } = worldToScreen(nwx, nwy, cam, cx, cy);
          const screenR = node.radius * cam.zoom;

          // Cull off-screen
          if (sx < -screenR * 3 || sx > w + screenR * 3 || sy < -screenR * 3 || sy > h + screenR * 3) continue;

          // Trace dimming
          let traceDim = 1;
          if (trace?.active && !trace.highlightedNodeIds.has(node.id)) {
            traceDim = 0.15;
          }

          const col = healthToColor(node.healthTier);
          const finalAlpha = opacity * traceDim;

          // Glow
          const glowR = node.glowRadius * cam.zoom;
          const glow = ctx.createRadialGradient(sx, sy, screenR * 0.5, sx, sy, glowR);
          glow.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${0.12 * finalAlpha})`);
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);

          // Live pulse ring
          if (node.isLive && !reduced) {
            const pulseR = screenR + 5 + Math.sin(t * 2.5) * 3;
            ctx.beginPath();
            ctx.arc(sx, sy, pulseR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${(0.15 + 0.1 * Math.sin(t * 2.5)) * finalAlpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // Selected ring
          if (selectedNodeId === node.id) {
            ctx.beginPath();
            ctx.arc(sx, sy, screenR + 4, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${0.6 * finalAlpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Trace source ring
          if (trace?.active && trace.sourceNodeId === node.id) {
            ctx.beginPath();
            ctx.arc(sx, sy, screenR + 6, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(229,229,229,${0.7})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }

          // Node body (circle)
          ctx.beginPath();
          ctx.arc(sx, sy, screenR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${0.75 * finalAlpha})`;
          ctx.fill();

          // Square accent
          const half = screenR * 0.85;
          ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${0.3 * finalAlpha})`;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);

          // Hit detection for hover
          const mx = mouseRef.current.x;
          const my = mouseRef.current.y;
          const hitR = Math.max(NODE_HIT_RADIUS, screenR);
          const dist = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
          if (dist < hitR) {
            hoveredNodeRef.current = node.id;
            // Hover highlight
            ctx.beginPath();
            ctx.arc(sx, sy, screenR + 2, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(229,229,229,${0.25 * finalAlpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // ── Labels ──
          const fontSize = Math.max(8, Math.min(12, screenR * 0.45));
          ctx.fillStyle = `rgba(229,229,229,${finalAlpha})`;
          ctx.font = `${fontSize}px Mohave, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label, sx, sy + screenR + fontSize + 4);

          // Level 2+: primary metric
          if (cam.zoom >= ZOOM_GALAXY && node.depth === 0) {
            const metricText = node.views >= 1000
              ? `${(node.views / 1000).toFixed(1)}k views`
              : `${node.views} views`;
            ctx.fillStyle = `rgba(107,107,107,${finalAlpha})`;
            ctx.font = `${Math.max(7, fontSize * 0.8)}px Kosugi, sans-serif`;
            ctx.fillText(metricText, sx, sy + screenR + fontSize + 16);
          }

          // Level 3+: secondary metric
          if (cam.zoom >= ZOOM_DETAIL && node.depth === 0) {
            const dwellText = node.avgDwellMs >= 1000
              ? `${(node.avgDwellMs / 1000).toFixed(1)}s dwell`
              : `${node.avgDwellMs}ms dwell`;
            ctx.fillStyle = `rgba(107,107,107,${finalAlpha * 0.7})`;
            ctx.font = `${Math.max(6, fontSize * 0.7)}px Kosugi, sans-serif`;
            ctx.fillText(dwellText, sx, sy + screenR + fontSize + 27);
          }

          // ── Trace inline metrics ──
          if (trace?.active && trace.nodeMetrics.has(node.id)) {
            const tm = trace.nodeMetrics.get(node.id)!;
            const badgeX = Math.round(sx + screenR + 10);
            const badgeY = Math.round(sy - screenR - 4);

            // Background pill
            ctx.fillStyle = 'rgba(10,10,10,0.85)';
            const pillW = 110;
            const pillH = 52;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, pillW, pillH, 3);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.10)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // Metrics text — use Mohave for legibility
            ctx.textAlign = 'left';
            ctx.font = '11px Mohave, sans-serif';
            ctx.fillStyle = '#E5E5E5';
            ctx.fillText(`${tm.reached} / ${Math.round(tm.reachedPct)}%`, badgeX + 8, badgeY + 15);
            ctx.fillStyle = 'rgba(89,119,148,1)';
            ctx.fillText(`${tm.converted} / ${Math.round(tm.convertedPct)}%`, badgeX + 8, badgeY + 29);
            ctx.fillStyle = 'rgba(147,65,55,1)';
            ctx.fillText(`${tm.droppedOff} / ${Math.round(tm.droppedOffPct)}%`, badgeX + 8, badgeY + 43);
            ctx.textAlign = 'center';
          }
        }

        // ── Trace edge labels ──
        if (trace?.active) {
          for (const [edgeId, label] of trace.edgeLabels) {
            const edge = allEdges.find(e => e.id === edgeId);
            if (!edge) continue;
            const src = allNodes.find(n => n.id === edge.sourceId);
            const tgt = allNodes.find(n => n.id === edge.targetId);
            if (!src || !tgt) continue;

            const midWx = (src.wx + src.dragOffsetX + tgt.wx + tgt.dragOffsetX) / 2;
            const midWy = (src.wy + src.dragOffsetY + tgt.wy + tgt.dragOffsetY) / 2 - 8;
            const { sx: rawSx, sy: rawSy } = worldToScreen(midWx, midWy, cam, cx, cy);
            const lsx = Math.round(rawSx);
            const lsy = Math.round(rawSy);

            const labelText = `${label.count} — ${Math.round(label.pct)}%`;
            ctx.font = '11px Mohave, sans-serif';
            const labelW = ctx.measureText(labelText).width + 12;
            const labelH = 18;

            // Background pill
            ctx.fillStyle = 'rgba(10,10,10,0.80)';
            ctx.beginPath();
            ctx.roundRect(lsx - labelW / 2, lsy - labelH / 2, labelW, labelH, 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            ctx.fillStyle = 'rgba(229,229,229,0.85)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, lsx, lsy);
            ctx.textBaseline = 'alphabetic';
          }
        }
      }

      // ── Loading state ──
      if (loading) {
        const pulse = reduced ? 0.6 : 0.4 + 0.2 * Math.sin(t * 2);
        ctx.fillStyle = `rgba(107,107,107,${pulse})`;
        ctx.font = '14px Mohave, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('RECONSTRUCTING SESSIONS...', cx, cy);
      }

      // ── Error state ──
      if (error) {
        ctx.fillStyle = 'rgba(147,50,26,0.9)';
        ctx.font = '14px Mohave, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FAILED TO LOAD FLOW DATA', cx, cy - 10);
        ctx.fillStyle = 'rgba(107,107,107,0.8)';
        ctx.font = '12px Kosugi, sans-serif';
        ctx.fillText(error, cx, cy + 12);
      }

      // ── Empty state ──
      if (universe && !loading && !error) {
        const totalNodes = universe.galaxies.reduce((s, g) => s + g.nodes.length, 0);
        if (totalNodes === 0) {
          ctx.fillStyle = 'rgba(107,107,107,0.6)';
          ctx.font = '14px Mohave, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('No analytics data', cx, cy - 8);
          ctx.font = '11px Kosugi, sans-serif';
          ctx.fillText('Sessions will appear here as users visit your site and app', cx, cy + 12);
        }
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, [universe, loading, error, selectedNodeId, trace, resize, initParticles]);

  /* ── Mouse event handlers ── */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseRef.current = { x, y };

    // Dragging
    const drag = dragRef.current;
    if (drag.active) {
      drag.moved = true;
      if (drag.isPan) {
        const cam = cameraRef.current;
        const dx = (x - drag.startMouseX) / cam.zoom;
        const dy = (y - drag.startMouseY) / cam.zoom;
        cam.targetX = drag.panStartCamX - dx;
        cam.targetY = drag.panStartCamY - dy;
      } else if (drag.nodeId && universe) {
        const cam = cameraRef.current;
        const allNodes = universe.galaxies.flatMap(g => g.nodes);
        const node = allNodes.find(n => n.id === drag.nodeId);
        if (node) {
          const dpr = window.devicePixelRatio || 1;
          const cw = (canvasRef.current?.width ?? 0) / dpr;
          const ch = (canvasRef.current?.height ?? 0) / dpr;
          const { wx, wy } = screenToWorld(x, y, cam, cw / 2, ch / 2);
          node.dragOffsetX = wx - node.wx;
          node.dragOffsetY = wy - node.wy;
        }
      }
    }

    // Set cursor
    if (container) {
      container.style.cursor = drag.active
        ? (drag.isPan ? 'grabbing' : 'grabbing')
        : hoveredNodeRef.current ? 'pointer' : 'grab';
    }
  }, [universe]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cam = cameraRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cw = (canvasRef.current?.width ?? 0) / dpr;
    const ch = (canvasRef.current?.height ?? 0) / dpr;

    // Check if we hit a node
    const hitNode = universe ? findNodeAtScreen(x, y, universe, cam, cw / 2, ch / 2) : null;

    const drag = dragRef.current;
    drag.active = true;
    drag.moved = false;
    drag.startMouseX = x;
    drag.startMouseY = y;

    if (hitNode) {
      drag.isPan = false;
      drag.nodeId = hitNode.id;
      drag.startWx = hitNode.wx + hitNode.dragOffsetX;
      drag.startWy = hitNode.wy + hitNode.dragOffsetY;
    } else {
      drag.isPan = true;
      drag.nodeId = null;
      drag.panStartCamX = cam.targetX;
      drag.panStartCamY = cam.targetY;
    }
  }, [universe, findNodeAtScreen]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    const wasDrag = drag.active && drag.moved;
    const wasNode = drag.nodeId;

    drag.active = false;
    drag.nodeId = null;

    if (!wasDrag) {
      // It was a click, not a drag
      if (wasNode) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          onNodeClick(wasNode, e.clientX - rect.left, e.clientY - rect.top);
        }
      } else {
        onEmptyClick();
      }
    } else if (wasNode && universe && onNodeDragEnd) {
      // Persist drag position
      const allNodes = universe.galaxies.flatMap(g => g.nodes);
      const node = allNodes.find(n => n.id === wasNode);
      if (node) {
        onNodeDragEnd(wasNode, node.dragOffsetX, node.dragOffsetY);
      }
    }
  }, [onNodeClick, onEmptyClick, universe, onNodeDragEnd]);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -9999, y: -9999 };
    dragRef.current.active = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dpr = window.devicePixelRatio || 1;
    const cw = (canvasRef.current?.width ?? 0) / dpr;
    const ch = (canvasRef.current?.height ?? 0) / dpr;
    const cx = cw / 2;
    const cy = ch / 2;

    // Zoom toward cursor
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.targetZoom * zoomFactor));

    // Adjust camera to keep point under cursor stable
    const { wx, wy } = screenToWorld(mx, my, cam, cx, cy);
    cam.targetZoom = newZoom;
    cam.targetX = wx - (mx - cx) / newZoom;
    cam.targetY = wy - (my - cy) / newZoom;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!universe) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cam = cameraRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cw = (canvasRef.current?.width ?? 0) / dpr;
    const ch = (canvasRef.current?.height ?? 0) / dpr;

    const hitNode = findNodeAtScreen(x, y, universe, cam, cw / 2, ch / 2);
    if (hitNode) {
      onNodeRightClick(hitNode.id, x, y);
    }
  }, [universe, findNodeAtScreen, onNodeRightClick]);

  /* ── Public method: navigate camera ── */
  // Exposed via imperative handle if needed, for now controlled via props

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ minHeight: 400 }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className="block w-full h-full"
      />
    </div>
  );
}

/* ── Camera navigation helpers (call from parent) ── */
export function navigateToGalaxy(
  cameraRef: React.MutableRefObject<GalaxyCamera>,
  galaxyId: 'landing' | 'app' | 'all',
) {
  const cam = cameraRef.current;
  if (galaxyId === 'landing') {
    cam.targetX = -1200;
    cam.targetY = 0;
    cam.targetZoom = 0.45;
  } else if (galaxyId === 'app') {
    cam.targetX = 1200;
    cam.targetY = 0;
    cam.targetZoom = 0.45;
  } else {
    cam.targetX = 0;
    cam.targetY = 0;
    cam.targetZoom = DEFAULT_ZOOM;
  }
}

export function navigateToNode(
  cameraRef: React.MutableRefObject<GalaxyCamera>,
  node: GalaxyNode,
) {
  const cam = cameraRef.current;
  cam.targetX = node.wx + node.dragOffsetX;
  cam.targetY = node.wy + node.dragOffsetY;
  // Zoom to appropriate level based on depth
  if (node.depth === 0) cam.targetZoom = 1.2;
  else if (node.depth === 1) cam.targetZoom = 2.0;
  else cam.targetZoom = 3.0;
}

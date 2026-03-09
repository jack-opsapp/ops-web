"use client";

/**
 * FilterFunnelCanvas — Canvas 2D horizontal filter pipeline visualization
 *
 * Shows how emails flow through filter stages (left-to-right) with a galaxy aesthetic
 * matching SetupStarfield. Nodes are square with glow, flow vectors show email
 * throughput thinning as filters strip emails, particles drift along active vectors,
 * and ambient stars provide background atmosphere.
 *
 * Supports drill-down zoom into individual filter categories to see sub-items,
 * hover tooltips via DOM overlay, and prefers-reduced-motion static rendering.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { GmailSyncFilters } from "@/lib/types/pipeline";

// ─── Local Types ─────────────────────────────────────────────────────────────

interface ScannedEmail {
  id: string;
  fromEmail: string;
  domain: string;
  subject: string;
  from: string;
  date: string;
  wouldImport: boolean;
  reason?: string;
  labels?: string[];
}

interface FilterFunnelCanvasProps {
  filters: GmailSyncFilters;
  scannedEmails: ScannedEmail[];
  preFilteredCount: number;
  onToggleCategory: (category: string, enabled: boolean) => void;
  onDrillDown: (category: string) => void;
  drilledCategory: string | null;
  onZoomOut: () => void;
  onToggleSubItem: (
    category: string,
    value: string,
    enabled: boolean
  ) => void;
  className?: string;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface PipelineNode {
  id: string;
  label: string;
  shortLabel: string;
  count: number;
  removed: number;
  enabled: boolean;
  color: RGB;
  x: number;
  y: number;
  isSource: boolean;
  isResult: boolean;
  detail: string;
}

interface SubNode {
  id: string;
  label: string;
  count: number;
  parentId: string;
  x: number;
  y: number;
  enabled: boolean;
}

interface BackgroundStar {
  x: number;
  y: number;
  size: number;
  alpha: number;
  vx: number;
  vy: number;
  phase: number;
}

interface FlowParticle {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
  size: number;
}

interface OrbitParticle {
  nodeIdx: number;
  angle: number;
  radius: number;
  speed: number;
  size: number;
  alpha: number;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  name: string;
  removed: number;
  remaining: number;
  detail: string;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT: RGB = { r: 89, g: 119, b: 148 }; // #597794 — source/result blue
const AMBER: RGB = { r: 196, g: 168, b: 104 }; // #C4A868 — active filter
const GREEN: RGB = { r: 157, g: 181, b: 130 }; // #9DB582 — result
const DIM: RGB = { r: 80, g: 80, b: 80 }; // disabled/inactive

const NODE_SIZE = 5; // half-size of square node (smaller)
const NODE_HIT_RADIUS = 22;
const STAR_COUNT = 150;
const CAMERA_LERP = 0.06;
const CANVAS_HEIGHT = 240;
const SUB_NODE_SIZE = 4;
const SUB_NODE_HIT_RADIUS = 16;
const VECTOR_WIDTH = 1; // constant thin vector width

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rgba(c: RGB, a: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function createBackgroundStars(w: number, h: number): BackgroundStar[] {
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 1.5 + 0.3,
      alpha: Math.random() * 0.5 + 0.15,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.1,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}

/** Create flow particles — density proportional to remaining email count at each stage.
 *  totalSource is the total emails, nodeCounts[i] is the count after node i. */
function createFlowParticles(nodeCount: number, nodeCounts?: number[], totalSource?: number): FlowParticle[] {
  const particles: FlowParticle[] = [];
  const total = totalSource ?? 300;
  for (let i = 0; i < nodeCount - 1; i++) {
    // Particle density proportional to how many emails remain after this node
    const remaining = nodeCounts ? (nodeCounts[i + 1] ?? total) : total;
    const ratio = Math.max(0.1, remaining / Math.max(total, 1));
    const count = Math.max(1, Math.round(ratio * 8));
    for (let j = 0; j < count; j++) {
      particles.push({
        fromIdx: i,
        toIdx: i + 1,
        progress: Math.random(),
        speed: 0.12 + Math.random() * 0.18,
        size: 0.8 + Math.random() * 0.8,
      });
    }
  }
  return particles;
}

function createOrbitParticles(nodeCount: number): OrbitParticle[] {
  const particles: OrbitParticle[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const count = 2 + Math.floor(Math.random() * 2); // 2-3 per node
    for (let j = 0; j < count; j++) {
      particles.push({
        nodeIdx: i,
        angle: Math.random() * Math.PI * 2,
        radius: 14 + Math.random() * 10,
        speed: 0.6 + Math.random() * 0.8,
        size: 0.8 + Math.random() * 0.7,
        alpha: 0.3 + Math.random() * 0.4,
      });
    }
  }
  return particles;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FilterFunnelCanvas({
  filters,
  scannedEmails,
  preFilteredCount,
  onToggleCategory,
  onDrillDown,
  drilledCategory,
  onZoomOut,
  onToggleSubItem,
  className,
}: FilterFunnelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);

  // Mutable refs for animation state (no re-renders)
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const hoveredNodeIdxRef = useRef<number>(-1);
  const hoveredSubNodeIdxRef = useRef<number>(-1);
  const starsRef = useRef<BackgroundStar[]>([]);
  const flowParticlesRef = useRef<FlowParticle[]>([]);
  const orbitParticlesRef = useRef<OrbitParticle[]>([]);
  const cameraRef = useRef<CameraState>({
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
  });
  const reducedMotionRef = useRef(false);
  const prevDrilledRef = useRef<string | null>(null);
  const otherNodeAlphaRef = useRef(1);
  const subNodeAlphaRef = useRef(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // DOM state for tooltip overlay
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    name: "",
    removed: 0,
    remaining: 0,
    detail: "",
  });

  // ─── Compute pipeline nodes ──────────────────────────────────────────

  const { nodes, totalSource } = useMemo(() => {
    const total = scannedEmails.length + preFilteredCount;

    // Stage 1: Source
    const sourceNode: PipelineNode = {
      id: "source",
      label: "Source",
      shortLabel: "Source",
      count: total,
      removed: 0,
      enabled: true,
      color: ACCENT,
      x: 0,
      y: 0,
      isSource: true,
      isResult: false,
      detail: `${total} total emails scanned`,
    };

    // Stage 2: Preset Blocklist
    const presetEnabled = filters.usePresetBlocklist;
    const presetRemoved = presetEnabled ? preFilteredCount : 0;
    const afterPreset = total - presetRemoved;
    const presetNode: PipelineNode = {
      id: "preset",
      label: "Preset Blocklist",
      shortLabel: "Blocklist",
      count: afterPreset,
      removed: presetRemoved,
      enabled: presetEnabled,
      color: presetEnabled ? AMBER : DIM,
      x: 0,
      y: 0,
      isSource: false,
      isResult: false,
      detail: presetEnabled
        ? `${presetRemoved} removed by preset blocklist`
        : "Preset blocklist disabled",
    };

    // Work only with scannedEmails (post-preset) for remaining filters
    // Track which emails are caught by each filter cumulatively
    const domainSet = new Set(
      filters.excludeDomains.map((d) => d.toLowerCase())
    );
    const addressSet = new Set(
      filters.excludeAddresses.map((a) => a.toLowerCase())
    );
    const keywords = filters.excludeSubjectKeywords.map((k) => k.toLowerCase());

    const caughtByDomain = new Set<string>();
    const caughtByAddress = new Set<string>();
    const caughtByKeyword = new Set<string>();

    for (const email of scannedEmails) {
      if (domainSet.has(email.domain.toLowerCase())) {
        caughtByDomain.add(email.id);
      }
    }

    for (const email of scannedEmails) {
      if (caughtByDomain.has(email.id)) continue;
      if (addressSet.has(email.fromEmail.toLowerCase())) {
        caughtByAddress.add(email.id);
      }
    }

    for (const email of scannedEmails) {
      if (caughtByDomain.has(email.id) || caughtByAddress.has(email.id))
        continue;
      const subjectLower = email.subject.toLowerCase();
      if (keywords.some((kw) => subjectLower.includes(kw))) {
        caughtByKeyword.add(email.id);
      }
    }

    // Stage 3: AI Blocked Domains
    const domainsEnabled = filters.excludeDomains.length > 0;
    const domainsRemoved = domainsEnabled ? caughtByDomain.size : 0;
    const afterDomains = afterPreset - domainsRemoved;
    const domainsNode: PipelineNode = {
      id: "domains",
      label: "AI Blocked Domains",
      shortLabel: "Domains",
      count: afterDomains,
      removed: domainsRemoved,
      enabled: domainsEnabled,
      color: domainsEnabled ? AMBER : DIM,
      x: 0,
      y: 0,
      isSource: false,
      isResult: false,
      detail: domainsEnabled
        ? `${filters.excludeDomains.length} domains blocked (${domainsRemoved} emails)`
        : "No domain filters active",
    };

    // Stage 4: AI Blocked Addresses
    const addressesEnabled = filters.excludeAddresses.length > 0;
    const addressesRemoved = addressesEnabled ? caughtByAddress.size : 0;
    const afterAddresses = afterDomains - addressesRemoved;
    const addressesNode: PipelineNode = {
      id: "addresses",
      label: "AI Blocked Addresses",
      shortLabel: "Addresses",
      count: afterAddresses,
      removed: addressesRemoved,
      enabled: addressesEnabled,
      color: addressesEnabled ? AMBER : DIM,
      x: 0,
      y: 0,
      isSource: false,
      isResult: false,
      detail: addressesEnabled
        ? `${filters.excludeAddresses.length} addresses blocked (${addressesRemoved} emails)`
        : "No address filters active",
    };

    // Stage 5: Subject Keywords
    const keywordsEnabled = filters.excludeSubjectKeywords.length > 0;
    const keywordsRemoved = keywordsEnabled ? caughtByKeyword.size : 0;
    const afterKeywords = afterAddresses - keywordsRemoved;
    const keywordsNode: PipelineNode = {
      id: "keywords",
      label: "Subject Keywords",
      shortLabel: "Keywords",
      count: afterKeywords,
      removed: keywordsRemoved,
      enabled: keywordsEnabled,
      color: keywordsEnabled ? AMBER : DIM,
      x: 0,
      y: 0,
      isSource: false,
      isResult: false,
      detail: keywordsEnabled
        ? `${filters.excludeSubjectKeywords.length} keywords blocking (${keywordsRemoved} emails)`
        : "No keyword filters active",
    };

    // Stage 6: Result
    const resultNode: PipelineNode = {
      id: "result",
      label: "Result",
      shortLabel: "Result",
      count: afterKeywords,
      removed: 0,
      enabled: true,
      color: GREEN,
      x: 0,
      y: 0,
      isSource: false,
      isResult: true,
      detail: `${afterKeywords} emails will be imported`,
    };

    const allNodes = [
      sourceNode,
      presetNode,
      domainsNode,
      addressesNode,
      keywordsNode,
      resultNode,
    ];

    return { nodes: allNodes, totalSource: total };
  }, [filters, scannedEmails, preFilteredCount]);

  // ─── Compute sub-nodes for drilled category ────────────────────────

  const subNodes = useMemo((): SubNode[] => {
    if (!drilledCategory) return [];

    if (drilledCategory === "domains") {
      // Count how many emails each domain blocks
      const domainCounts = new Map<string, number>();
      for (const d of filters.excludeDomains) {
        domainCounts.set(d.toLowerCase(), 0);
      }
      for (const email of scannedEmails) {
        const key = email.domain.toLowerCase();
        if (domainCounts.has(key)) {
          domainCounts.set(key, (domainCounts.get(key) ?? 0) + 1);
        }
      }
      return filters.excludeDomains.map((d, i) => ({
        id: d,
        label: d,
        count: domainCounts.get(d.toLowerCase()) ?? 0,
        parentId: "domains",
        x: 0,
        y: 0,
        enabled: true,
      }));
    }

    if (drilledCategory === "addresses") {
      // Addresses not caught by domain filter
      const domainSet = new Set(
        filters.excludeDomains.map((d) => d.toLowerCase())
      );
      const addressCounts = new Map<string, number>();
      for (const a of filters.excludeAddresses) {
        addressCounts.set(a.toLowerCase(), 0);
      }
      for (const email of scannedEmails) {
        if (domainSet.has(email.domain.toLowerCase())) continue;
        const key = email.fromEmail.toLowerCase();
        if (addressCounts.has(key)) {
          addressCounts.set(key, (addressCounts.get(key) ?? 0) + 1);
        }
      }
      return filters.excludeAddresses.map((a, i) => ({
        id: a,
        label: a,
        count: addressCounts.get(a.toLowerCase()) ?? 0,
        parentId: "addresses",
        x: 0,
        y: 0,
        enabled: true,
      }));
    }

    if (drilledCategory === "keywords") {
      const domainSet = new Set(
        filters.excludeDomains.map((d) => d.toLowerCase())
      );
      const addressSet = new Set(
        filters.excludeAddresses.map((a) => a.toLowerCase())
      );
      const keywordCounts = new Map<string, number>();
      for (const k of filters.excludeSubjectKeywords) {
        keywordCounts.set(k.toLowerCase(), 0);
      }
      for (const email of scannedEmails) {
        if (domainSet.has(email.domain.toLowerCase())) continue;
        if (addressSet.has(email.fromEmail.toLowerCase())) continue;
        const subjectLower = email.subject.toLowerCase();
        for (const kw of filters.excludeSubjectKeywords) {
          if (subjectLower.includes(kw.toLowerCase())) {
            keywordCounts.set(
              kw.toLowerCase(),
              (keywordCounts.get(kw.toLowerCase()) ?? 0) + 1
            );
            break; // Only count once per email
          }
        }
      }
      return filters.excludeSubjectKeywords.map((k, i) => ({
        id: k,
        label: k,
        count: keywordCounts.get(k.toLowerCase()) ?? 0,
        parentId: "keywords",
        x: 0,
        y: 0,
        enabled: true,
      }));
    }

    return [];
  }, [drilledCategory, filters, scannedEmails]);

  // ─── Canvas resize ───────────────────────────────────────────────────

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
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvasSizeRef.current = { w: rect.width, h: rect.height };

    // Re-initialize stars for new dimensions
    if (starsRef.current.length === 0 || Math.abs(starsRef.current[0].x) < 1) {
      starsRef.current = createBackgroundStars(rect.width, rect.height);
    }
  }, []);

  // ─── Node position layout ──────────────────────────────────────────

  // Organic Y offsets for each node — gives a natural, non-linear feel
  const nodeYOffsets = useMemo(() => [0, -18, 12, -8, 20, -14], []);

  const computeNodePositions = useCallback(
    (
      pipelineNodes: PipelineNode[],
      w: number,
      h: number
    ): PipelineNode[] => {
      const paddingX = 44;
      const usableW = w - paddingX * 2;
      const step = usableW / (pipelineNodes.length - 1);
      const centerY = h * 0.45;

      return pipelineNodes.map((node, i) => ({
        ...node,
        x: paddingX + step * i,
        y: centerY + (nodeYOffsets[i] ?? 0),
      }));
    },
    [nodeYOffsets]
  );

  const computeSubNodePositions = useCallback(
    (
      subs: SubNode[],
      parentNode: PipelineNode,
      w: number,
      h: number
    ): SubNode[] => {
      if (subs.length === 0) return [];

      // Vertical stack below parent
      const maxVisible = Math.min(subs.length, 12);
      const spacing = 28;
      const totalHeight = (maxVisible - 1) * spacing;
      const startY = parentNode.y - totalHeight / 2;

      // Offset to the right of parent
      const startX = parentNode.x + 60;

      return subs.slice(0, maxVisible).map((sub, i) => ({
        ...sub,
        x: startX,
        y: startY + i * spacing,
      }));
    },
    []
  );

  // ─── Setup ─────────────────────────────────────────────────────────

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    resize();
    const ro = new ResizeObserver(resize);
    if (containerRef.current) ro.observe(containerRef.current);

    const { w, h } = canvasSizeRef.current;
    starsRef.current = createBackgroundStars(w || 800, h || CANVAS_HEIGHT);
    const nodeCounts = nodes.map((n) => n.count);
    flowParticlesRef.current = createFlowParticles(nodes.length, nodeCounts, totalSource);
    orbitParticlesRef.current = createOrbitParticles(nodes.length);

    return () => ro.disconnect();
  }, [resize, nodes, totalSource]);

  // ─── Drill-down camera targeting ──────────────────────────────────

  useEffect(() => {
    const { w, h } = canvasSizeRef.current;
    const positioned = computeNodePositions(nodes, w || 800, h || CANVAS_HEIGHT);

    if (drilledCategory) {
      const target = positioned.find((n) => n.id === drilledCategory);
      if (target) {
        cameraRef.current.targetX = target.x - (w || 800) / 2;
        cameraRef.current.targetY = target.y - (h || CANVAS_HEIGHT) / 2;
        cameraRef.current.targetZoom = 2.2;
        subNodeAlphaRef.current = 0;
      }
    } else {
      cameraRef.current.targetX = 0;
      cameraRef.current.targetY = 0;
      cameraRef.current.targetZoom = 1;
    }
    prevDrilledRef.current = drilledCategory;
  }, [drilledCategory, nodes, computeNodePositions]);

  // ─── Animation loop ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
      lastTime = now;

      const { w, h } = canvasSizeRef.current;
      if (w === 0 || h === 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const isReduced = reducedMotionRef.current;
      const cam = cameraRef.current;

      // Lerp camera
      if (!isReduced) {
        cam.x = lerpNum(cam.x, cam.targetX, CAMERA_LERP);
        cam.y = lerpNum(cam.y, cam.targetY, CAMERA_LERP);
        cam.zoom = lerpNum(cam.zoom, cam.targetZoom, CAMERA_LERP);
      } else {
        cam.x = cam.targetX;
        cam.y = cam.targetY;
        cam.zoom = cam.targetZoom;
      }

      // Fade other nodes when drilled
      const isDrilled = drilledCategory !== null;
      const targetOtherAlpha = isDrilled ? 0.1 : 1;
      const targetSubAlpha = isDrilled ? 1 : 0;
      if (!isReduced) {
        otherNodeAlphaRef.current = lerpNum(
          otherNodeAlphaRef.current,
          targetOtherAlpha,
          0.08
        );
        subNodeAlphaRef.current = lerpNum(
          subNodeAlphaRef.current,
          targetSubAlpha,
          0.08
        );
      } else {
        otherNodeAlphaRef.current = targetOtherAlpha;
        subNodeAlphaRef.current = targetSubAlpha;
      }

      // Compute node positions
      const positioned = computeNodePositions(nodes, w, h);

      // Transform coordinates with camera
      const transform = (px: number, py: number) => {
        const sx = (px - cam.x) * cam.zoom - (cam.zoom - 1) * w / 2;
        const sy = (py - cam.y) * cam.zoom - (cam.zoom - 1) * h / 2;
        return { sx, sy };
      };

      // ─── Clear ─────────────────────────────────────────────────────

      ctx.clearRect(0, 0, w, h);

      // ─── 1. Background stars ───────────────────────────────────────

      const stars = starsRef.current;
      for (const star of stars) {
        if (!isReduced) {
          star.x += star.vx * dt * 30;
          star.y += star.vy * dt * 30;
          star.phase += dt * 0.5;

          // Wrap
          if (star.x < -5) star.x = w + 5;
          if (star.x > w + 5) star.x = -5;
          if (star.y < -5) star.y = h + 5;
          if (star.y > h + 5) star.y = -5;
        }

        const flicker = isReduced
          ? star.alpha
          : star.alpha * (0.7 + 0.3 * Math.sin(star.phase));
        ctx.fillStyle = `rgba(255, 255, 255, ${flicker})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // ─── 2. Flow vectors ──────────────────────────────────────────

      for (let i = 0; i < positioned.length - 1; i++) {
        const from = positioned[i];
        const to = positioned[i + 1];
        const { sx: fx, sy: fy } = transform(from.x, from.y);
        const { sx: tx, sy: ty } = transform(to.x, to.y);

        const nextNode = positioned[i + 1];
        const isDisabled = !nextNode.enabled;

        // Node alpha for this flow line
        const nodeAlpha =
          isDrilled && nextNode.id !== drilledCategory && from.id !== drilledCategory
            ? otherNodeAlphaRef.current
            : 1;

        ctx.save();
        ctx.lineWidth = VECTOR_WIDTH;
        if (isDisabled) {
          ctx.strokeStyle = rgba(DIM, 0.15 * nodeAlpha);
          ctx.setLineDash([4, 4]);
        } else {
          ctx.strokeStyle = rgba(ACCENT, 0.25 * nodeAlpha);
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(fx + NODE_SIZE, fy);
        ctx.lineTo(tx - NODE_SIZE, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // ─── 3. Flow particles ────────────────────────────────────────

      if (!isReduced) {
        const flowParticles = flowParticlesRef.current;
        for (const p of flowParticles) {
          if (p.fromIdx >= positioned.length || p.toIdx >= positioned.length) continue;
          const from = positioned[p.fromIdx];
          const to = positioned[p.toIdx];
          const nextNode = to;

          // Skip particles on disabled flows
          if (!nextNode.enabled && !nextNode.isResult && !nextNode.isSource) continue;

          // Node alpha
          const nodeAlpha =
            isDrilled &&
            nextNode.id !== drilledCategory &&
            from.id !== drilledCategory
              ? otherNodeAlphaRef.current
              : 1;

          // Update progress
          p.progress += p.speed * dt;
          if (p.progress > 1) p.progress -= 1;

          const { sx: fx, sy: fy } = transform(from.x, from.y);
          const { sx: tx, sy: ty } = transform(to.x, to.y);

          const px = lerpNum(fx + NODE_SIZE, tx - NODE_SIZE, p.progress);
          const py = lerpNum(fy, ty, p.progress);
          const alpha =
            Math.sin(p.progress * Math.PI) * 0.8 * nodeAlpha;

          const flowColor = nextNode.isResult ? GREEN : nextNode.color;
          ctx.fillStyle = rgba(flowColor, alpha);
          ctx.beginPath();
          ctx.arc(px, py, p.size * cam.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ─── 4. Nodes ─────────────────────────────────────────────────

      // Hit detection
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      let newHoveredIdx = -1;

      for (let i = 0; i < positioned.length; i++) {
        const node = positioned[i];
        const { sx, sy } = transform(node.x, node.y);

        // Alpha for this node
        const nodeAlpha =
          isDrilled && node.id !== drilledCategory
            ? otherNodeAlphaRef.current
            : 1;

        // Hit test
        const dx = mx - sx;
        const dy = my - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < NODE_HIT_RADIUS * cam.zoom && nodeAlpha > 0.3) {
          newHoveredIdx = i;
        }

        // Hovered brightening
        const isHovered = hoveredNodeIdxRef.current === i;
        const glowBlur = isHovered ? 24 : 16;
        const glowAlpha = isHovered ? 0.8 : 0.6;
        const fillAlpha = isHovered ? 1 : 0.9;

        ctx.save();
        ctx.shadowColor = rgba(node.color, glowAlpha * nodeAlpha);
        ctx.shadowBlur = glowBlur * cam.zoom;
        ctx.fillStyle = rgba(node.color, fillAlpha * nodeAlpha);
        const size = NODE_SIZE * cam.zoom;
        ctx.fillRect(sx - size, sy - size, size * 2, size * 2);
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      hoveredNodeIdxRef.current = newHoveredIdx;

      // ─── 5. Labels below nodes ────────────────────────────────────

      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (let i = 0; i < positioned.length; i++) {
        const node = positioned[i];
        const { sx, sy } = transform(node.x, node.y);

        const nodeAlpha =
          isDrilled && node.id !== drilledCategory
            ? otherNodeAlphaRef.current
            : 1;

        // Count label
        const countText = node.isSource
          ? `${node.count}`
          : node.isResult
            ? `${node.count}`
            : node.removed > 0
              ? `-${node.removed}`
              : "0";

        const fontSize = Math.max(9, 11 * cam.zoom);
        ctx.font = `600 ${fontSize}px "Mohave", sans-serif`;
        ctx.fillStyle = rgba(node.color, 0.9 * nodeAlpha);
        ctx.fillText(countText, sx, sy + NODE_SIZE * cam.zoom + 6);

        // Name label
        const nameSize = Math.max(7, 9 * cam.zoom);
        ctx.font = `400 ${nameSize}px "Mohave", sans-serif`;
        ctx.fillStyle = `rgba(180, 180, 180, ${0.7 * nodeAlpha})`;
        ctx.fillText(node.shortLabel, sx, sy + NODE_SIZE * cam.zoom + 6 + fontSize + 2);
      }

      // ─── 6. Orbit particles around active nodes ──────────────────

      if (!isReduced) {
        const orbits = orbitParticlesRef.current;
        for (const op of orbits) {
          if (op.nodeIdx >= positioned.length) continue;
          const node = positioned[op.nodeIdx];

          // Skip orbit particles on disabled nodes
          if (!node.enabled && !node.isSource && !node.isResult) continue;

          const nodeAlpha =
            isDrilled && node.id !== drilledCategory
              ? otherNodeAlphaRef.current
              : 1;

          op.angle += op.speed * dt;

          const { sx, sy } = transform(node.x, node.y);
          const ox = sx + Math.cos(op.angle) * op.radius * cam.zoom;
          const oy = sy + Math.sin(op.angle) * op.radius * cam.zoom;

          ctx.fillStyle = rgba(node.color, op.alpha * nodeAlpha);
          ctx.beginPath();
          ctx.arc(ox, oy, op.size * cam.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ─── 7. Sub-nodes (drill-down) ───────────────────────────────

      if (isDrilled && subNodeAlphaRef.current > 0.01) {
        const parentNode = positioned.find((n) => n.id === drilledCategory);
        if (parentNode) {
          const positionedSubs = computeSubNodePositions(
            subNodes,
            parentNode,
            w,
            h
          );

          let newHoveredSubIdx = -1;

          // Vectors from parent to each sub-node
          for (const sub of positionedSubs) {
            const { sx: psx, sy: psy } = transform(parentNode.x, parentNode.y);
            const { sx: ssx, sy: ssy } = transform(sub.x, sub.y);

            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = rgba(AMBER, 0.25 * subNodeAlphaRef.current);
            ctx.beginPath();
            ctx.moveTo(psx + NODE_SIZE * cam.zoom, psy);
            ctx.lineTo(ssx - SUB_NODE_SIZE * cam.zoom, ssy);
            ctx.stroke();
            ctx.restore();
          }

          // Sub-node squares
          for (let i = 0; i < positionedSubs.length; i++) {
            const sub = positionedSubs[i];
            const { sx, sy } = transform(sub.x, sub.y);

            // Hit test
            const dx = mx - sx;
            const dy = my - sy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < SUB_NODE_HIT_RADIUS * cam.zoom) {
              newHoveredSubIdx = i;
            }

            const isSubHovered = hoveredSubNodeIdxRef.current === i;
            const subGlowBlur = isSubHovered ? 18 : 10;
            const subGlowAlpha = isSubHovered ? 0.7 : 0.5;
            const subFillAlpha = isSubHovered ? 1 : 0.85;

            ctx.save();
            ctx.shadowColor = rgba(
              AMBER,
              subGlowAlpha * subNodeAlphaRef.current
            );
            ctx.shadowBlur = subGlowBlur * cam.zoom;
            ctx.fillStyle = rgba(
              AMBER,
              subFillAlpha * subNodeAlphaRef.current
            );
            const size = SUB_NODE_SIZE * cam.zoom;
            ctx.fillRect(sx - size, sy - size, size * 2, size * 2);
            ctx.shadowBlur = 0;
            ctx.restore();

            // Sub-node label
            const subFontSize = Math.max(7, 8 * cam.zoom);
            ctx.font = `400 ${subFontSize}px "Mohave", sans-serif`;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            // Truncate long labels
            let displayLabel = sub.label;
            if (displayLabel.length > 24) {
              displayLabel = displayLabel.slice(0, 22) + "...";
            }

            ctx.fillStyle = `rgba(200, 200, 200, ${0.8 * subNodeAlphaRef.current})`;
            ctx.fillText(
              displayLabel,
              sx + SUB_NODE_SIZE * cam.zoom + 6,
              sy
            );

            // Count badge
            ctx.fillStyle = rgba(
              AMBER,
              0.7 * subNodeAlphaRef.current
            );
            const countWidth = ctx.measureText(`-${sub.count}`).width;
            ctx.fillText(
              `-${sub.count}`,
              sx + SUB_NODE_SIZE * cam.zoom + 6 + ctx.measureText(displayLabel + "  ").width,
              sy
            );

            // Reset text alignment
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
          }

          hoveredSubNodeIdxRef.current = newHoveredSubIdx;
        }
      }

      // ─── Tooltip state update (DOM) ───────────────────────────────

      if (hoveredNodeIdxRef.current >= 0 && !isDrilled) {
        const node = positioned[hoveredNodeIdxRef.current];
        const { sx, sy } = transform(node.x, node.y);
        setTooltip({
          visible: true,
          x: sx,
          y: sy - NODE_SIZE * cam.zoom - 12,
          name: node.label,
          removed: node.removed,
          remaining: node.count,
          detail: node.detail,
        });
      } else if (isDrilled && hoveredSubNodeIdxRef.current >= 0) {
        const parentNode = positioned.find((n) => n.id === drilledCategory);
        if (parentNode) {
          const positionedSubs = computeSubNodePositions(
            subNodes,
            parentNode,
            w,
            h
          );
          if (hoveredSubNodeIdxRef.current < positionedSubs.length) {
            const sub = positionedSubs[hoveredSubNodeIdxRef.current];
            const { sx, sy } = transform(sub.x, sub.y);
            setTooltip({
              visible: true,
              x: sx,
              y: sy - SUB_NODE_SIZE * cam.zoom - 12,
              name: sub.label,
              removed: sub.count,
              remaining: 0,
              detail: `Blocks ${sub.count} email${sub.count !== 1 ? "s" : ""}`,
            });
          }
        }
      } else {
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }

      // ─── Cursor style ─────────────────────────────────────────────

      if (canvas) {
        const isOverClickable =
          (hoveredNodeIdxRef.current >= 0 &&
            !positioned[hoveredNodeIdxRef.current].isSource &&
            !positioned[hoveredNodeIdxRef.current].isResult) ||
          hoveredSubNodeIdxRef.current >= 0;
        canvas.style.cursor = isOverClickable ? "pointer" : "default";
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [
    nodes,
    totalSource,
    drilledCategory,
    subNodes,
    computeNodePositions,
    computeSubNodePositions,
  ]);

  // ─── Mouse handlers ────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -9999, y: -9999 };
    hoveredNodeIdxRef.current = -1;
    hoveredSubNodeIdxRef.current = -1;
    setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { w, h } = canvasSizeRef.current;
      const positioned = computeNodePositions(nodes, w, h);
      const cam = cameraRef.current;

      // Check sub-node click first
      if (drilledCategory && hoveredSubNodeIdxRef.current >= 0) {
        if (hoveredSubNodeIdxRef.current < subNodes.length) {
          const sub = subNodes[hoveredSubNodeIdxRef.current];
          onToggleSubItem(drilledCategory, sub.id, !sub.enabled);
          return;
        }
      }

      // Check main node click
      if (hoveredNodeIdxRef.current >= 0) {
        const node = positioned[hoveredNodeIdxRef.current];
        if (!node.isSource && !node.isResult) {
          onDrillDown(node.id);
          return;
        }
      }

      // Clicking background while drilled → zoom out
      if (drilledCategory && hoveredNodeIdxRef.current < 0 && hoveredSubNodeIdxRef.current < 0) {
        onZoomOut();
      }
    },
    [
      nodes,
      drilledCategory,
      subNodes,
      computeNodePositions,
      onDrillDown,
      onZoomOut,
      onToggleSubItem,
    ]
  );

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ""}`}
      style={{ height: CANVAS_HEIGHT, width: "100%" }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          display: "block",
          width: "100%",
          height: CANVAS_HEIGHT,
        }}
      />

      {/* Tooltip DOM overlay */}
      {tooltip.visible && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div
            className="rounded-md px-3 py-2 shadow-lg"
            style={{
              background: "rgba(20, 20, 25, 0.92)",
              border: "1px solid rgba(89, 119, 148, 0.3)",
              backdropFilter: "blur(8px)",
              maxWidth: 220,
            }}
          >
            <div
              className="text-xs font-semibold"
              style={{
                color: "rgba(220, 220, 225, 0.95)",
                fontFamily: '"Mohave", sans-serif',
              }}
            >
              {tooltip.name}
            </div>
            {tooltip.removed > 0 && (
              <div
                className="mt-0.5 text-xs"
                style={{
                  color: "rgba(196, 168, 104, 0.85)",
                  fontFamily: '"Mohave", sans-serif',
                }}
              >
                -{tooltip.removed} removed
              </div>
            )}
            {tooltip.remaining > 0 && (
              <div
                className="mt-0.5 text-xs"
                style={{
                  color: "rgba(157, 181, 130, 0.85)",
                  fontFamily: '"Mohave", sans-serif',
                }}
              >
                {tooltip.remaining} remaining
              </div>
            )}
            <div
              className="mt-1 text-xs"
              style={{
                color: "rgba(160, 160, 170, 0.7)",
                fontFamily: '"Mohave", sans-serif',
              }}
            >
              {tooltip.detail}
            </div>
          </div>
        </div>
      )}

      {/* Zoom out hint when drilled */}
      {drilledCategory && (
        <div
          className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs"
          style={{
            color: "rgba(150, 150, 160, 0.5)",
            fontFamily: '"Mohave", sans-serif',
          }}
        >
          click background to zoom out
        </div>
      )}
    </div>
  );
}

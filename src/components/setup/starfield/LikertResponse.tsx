"use client";

/**
 * LikertResponse — Spectrum Line with Emanating Field
 *
 * Exact animation from ops-site LikertRadialGauge.
 * Horizontal baseline with 5 interactive nodes.
 * ~72 thin vertical field lines emanate from the baseline,
 * following the user's mouse with Gaussian falloff.
 * Colors shift red → grey → green across the spectrum.
 * Click locks the field to the selected node with concentrated opacity.
 *
 * Pure Canvas 2D API — no animation libraries.
 */

import { useRef, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LikertResponseProps {
  minLabel: string;
  maxLabel: string;
  value: number | null; // 1-5
  onSelect: (value: number) => void;
}

interface FieldLine {
  normX: number;
  jitterX: number;
  phaseOffset: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SPECTRUM = [
  { r: 170, g: 65, b: 65 }, // 1 — muted red
  { r: 160, g: 90, b: 80 }, // 2 — softer red
  { r: 160, g: 160, b: 160 }, // 3 — warm grey
  { r: 80, g: 150, b: 100 }, // 4 — soft green
  { r: 60, g: 160, b: 90 }, // 5 — muted green
];

const FIELD_LINE_COUNT = 72;
const HIT_RADIUS = 32;
const SELECT_DELAY_MS = 500;
const LERP_FACTOR = 0.06;
const FIELD_MAX_HEIGHT = 100;
const FIELD_MIN_HEIGHT = 3;
const GAUSSIAN_SIGMA = 0.08;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSpectrumColor(normX: number): { r: number; g: number; b: number } {
  const t = Math.max(0, Math.min(1, normX)) * (SPECTRUM.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = SPECTRUM[Math.min(i, SPECTRUM.length - 1)];
  const b = SPECTRUM[Math.min(i + 1, SPECTRUM.length - 1)];
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
  };
}

function getLayout(w: number, h: number) {
  const baselineY = h * 0.45;
  const lineStartX = w * 0.1;
  const lineEndX = w * 0.9;
  const lineWidth = lineEndX - lineStartX;

  const nodes: { x: number; y: number; normX: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const normX = i / 4;
    nodes.push({ x: lineStartX + normX * lineWidth, y: baselineY, normX });
  }

  return { baselineY, lineStartX, lineEndX, lineWidth, nodes };
}

function getHoveredIndex(
  mx: number,
  my: number,
  nodes: { x: number; y: number }[]
): number {
  let closest = -1;
  let closestDist = HIT_RADIUS;
  for (let i = 0; i < nodes.length; i++) {
    const dx = mx - nodes[i].x;
    const dy = my - nodes[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  }
  return closest;
}

function gaussian(x: number, mu: number, sigma: number): number {
  const d = x - mu;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

function generateFieldLines(): FieldLine[] {
  const lines: FieldLine[] = [];
  for (let i = 0; i < FIELD_LINE_COUNT; i++) {
    lines.push({
      normX: i / (FIELD_LINE_COUNT - 1),
      jitterX: (Math.random() - 0.5) * 0.004,
      phaseOffset: Math.random() * Math.PI * 2,
    });
  }
  return lines;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LikertResponse({
  minLabel,
  maxLabel,
  value,
  onSelect,
}: LikertResponseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const hoveredRef = useRef<number>(-1);
  const selectedRef = useRef<number>(-1);
  const onSelectRef = useRef(onSelect);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeRef = useRef(0);

  // Smooth mouse X (normalized 0-1), -1 when off canvas
  const smoothMouseXRef = useRef<number>(-1);
  // Hover intensity (0→1 fade in/out when mouse enters/leaves)
  const hoverIntensityRef = useRef<number>(0);
  // Selection animation: lerped center position
  const selectionCenterRef = useRef<number>(-1);
  // Selection animation progress: 0→1
  const selectionProgressRef = useRef<number>(0);
  // Selection phase: 'idle' | 'shrinking' | 'expanding'
  const selPhaseRef = useRef<"idle" | "shrinking" | "expanding">("idle");
  // Pending selection index (set during shrink, applied when shrink completes)
  const selPendingRef = useRef<number>(-1);
  // Field line data (generated once)
  const fieldLinesRef = useRef<FieldLine[] | null>(null);

  onSelectRef.current = onSelect;

  // Apply saved value on mount
  if (
    value !== null &&
    value >= 1 &&
    value <= 5 &&
    selectedRef.current < 0
  ) {
    selectedRef.current = value - 1;
    selPhaseRef.current = "expanding";
    selectionProgressRef.current = 1;
  }

  if (!fieldLinesRef.current) {
    fieldLinesRef.current = generateFieldLines();
  }

  // ─── DPI-aware resize ──────────────────────────────────────────────────

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
  }, []);

  // ─── Main effect ──────────────────────────────────────────────────────

  useEffect(() => {
    resize();

    const container = containerRef.current!;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    }

    const mousePos = { x: -9999, y: -9999 };

    // ── Selection logic ──

    const selectNode = (
      idx: number,
      nodes: { x: number; y: number; normX: number }[],
      centerX: number
    ) => {
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);

      if (selectedRef.current >= 0 && selectedRef.current !== idx) {
        // Re-selection: shrink first, then expand at new position
        selPendingRef.current = idx;
        selPhaseRef.current = "shrinking";
      } else if (selectedRef.current === idx) {
        // Same node re-clicked — re-fire callback
        selectTimerRef.current = setTimeout(() => {
          onSelectRef.current(idx + 1);
        }, SELECT_DELAY_MS);
        return;
      } else {
        // First selection
        selectedRef.current = idx;
        selectionCenterRef.current =
          centerX >= 0 ? centerX : nodes[idx].normX;
        selectionProgressRef.current = 0;
        selPhaseRef.current = "expanding";

        selectTimerRef.current = setTimeout(() => {
          onSelectRef.current(idx + 1);
        }, SELECT_DELAY_MS);
      }
    };

    // ── Event handlers ──

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mousePos.x = e.clientX - rect.left;
      mousePos.y = e.clientY - rect.top;
    };

    const handleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const { nodes } = getLayout(w, h);
      const idx = getHoveredIndex(mx, my, nodes);

      if (idx >= 0) {
        selectNode(idx, nodes, smoothMouseXRef.current);
      }
    };

    const handleMouseLeave = () => {
      mousePos.x = -9999;
      mousePos.y = -9999;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      const rect = container.getBoundingClientRect();
      const mx = t.clientX - rect.left;
      const my = t.clientY - rect.top;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const { nodes } = getLayout(w, h);
      const idx = getHoveredIndex(mx, my, nodes);

      if (idx >= 0) {
        selectNode(idx, nodes, nodes[idx].normX);
      }
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("click", handleClick);
    container.addEventListener("mouseleave", handleMouseLeave);
    container.addEventListener("touchend", handleTouchEnd);

    // ── Animation loop ──

    const fieldLines = fieldLinesRef.current!;
    let prevTimestamp: number | null = null;

    function draw(timestamp: number) {
      if (prevTimestamp === null) prevTimestamp = timestamp;
      const dt = (timestamp - prevTimestamp) / 1000;
      prevTimestamp = timestamp;
      timeRef.current += dt;

      const canvas = canvasRef.current;
      if (!canvas) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;

      ctx.clearRect(0, 0, w, h);

      const { baselineY, lineStartX, lineEndX, lineWidth, nodes } =
        getLayout(w, h);
      const selected = selectedRef.current;
      const time = timeRef.current;

      // ── Hit detection + cursor ──

      const hoverIdx = getHoveredIndex(mousePos.x, mousePos.y, nodes);
      hoveredRef.current = hoverIdx;
      container.style.cursor = hoverIdx >= 0 ? "pointer" : "default";

      // ── Update smoothMouseX + hover intensity ──

      const mouseOnCanvas = mousePos.x > -9000;

      if (mouseOnCanvas) {
        const rawNormX = Math.max(
          0,
          Math.min(1, (mousePos.x - lineStartX) / lineWidth)
        );
        if (smoothMouseXRef.current < 0) {
          smoothMouseXRef.current = rawNormX;
        } else {
          smoothMouseXRef.current +=
            (rawNormX - smoothMouseXRef.current) * LERP_FACTOR;
        }
        hoverIntensityRef.current = Math.min(
          1,
          hoverIntensityRef.current + dt * 3.0
        );
      } else {
        hoverIntensityRef.current = Math.max(
          0,
          hoverIntensityRef.current - dt * 3.0
        );
        if (hoverIntensityRef.current <= 0) {
          smoothMouseXRef.current = -1;
        }
      }

      const hoverIntensity = hoverIntensityRef.current;
      const smoothMouseX = smoothMouseXRef.current;

      // ── Advance selectionProgress + lerp selection center ──

      const phase = selPhaseRef.current;

      if (phase === "shrinking") {
        selectionProgressRef.current = Math.max(
          0,
          selectionProgressRef.current - dt * 4.0
        );
        if (selectionProgressRef.current <= 0) {
          const pending = selPendingRef.current;
          if (pending >= 0) {
            selectedRef.current = pending;
            selPendingRef.current = -1;
            selectionProgressRef.current = 0;
            selPhaseRef.current = "expanding";

            if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
            selectTimerRef.current = setTimeout(() => {
              onSelectRef.current(pending + 1);
            }, SELECT_DELAY_MS);
          }
        }
      } else if (phase === "expanding" && selected >= 0) {
        selectionProgressRef.current = Math.min(
          1,
          selectionProgressRef.current + dt * 2.5
        );
      }

      // Always lerp center toward current selection target
      if (selected >= 0) {
        const targetX = nodes[selected].normX;
        selectionCenterRef.current +=
          (targetX - selectionCenterRef.current) * 0.08;
      }

      const selProgress = selectionProgressRef.current;
      const selCenter = selectionCenterRef.current;

      // ── Draw baseline ──

      ctx.beginPath();
      ctx.moveTo(lineStartX, baselineY);
      ctx.lineTo(lineEndX, baselineY);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // ── Draw field lines ──

      const HOVER_MAX_HEIGHT = 55;
      const HOVER_MAX_ALPHA = 0.15;
      const POST_SEL_HOVER_MAX_HEIGHT = 30;
      const POST_SEL_HOVER_SIGMA = 0.06;
      const POST_SEL_HOVER_MAX_ALPHA = 0.08;

      for (const fl of fieldLines) {
        const x = lineStartX + (fl.normX + fl.jitterX) * lineWidth;
        const fullColor = getSpectrumColor(fl.normX);
        const grey = 140;
        const hoverColor = {
          r: grey + (fullColor.r - grey) * 0.35,
          g: grey + (fullColor.g - grey) * 0.35,
          b: grey + (fullColor.b - grey) * 0.35,
        };

        let height: number;
        let alpha: number;
        let cr: number, cg: number, cb: number;

        if (selected >= 0) {
          // Selection field
          const sigma = 0.03 + selProgress * 0.14;
          const g = gaussian(fl.normX, selCenter, sigma);

          const heightMult = 0.15 + selProgress * 0.85;
          height =
            FIELD_MIN_HEIGHT +
            g * (FIELD_MAX_HEIGHT * 1.2 - FIELD_MIN_HEIGHT) * heightMult;
          alpha =
            (0.02 + g * (0.65 - 0.02)) * (0.2 + selProgress * 0.8);
          cr = fullColor.r;
          cg = fullColor.g;
          cb = fullColor.b;

          // Layer post-selection hover on top
          if (smoothMouseX >= 0 && hoverIntensity > 0) {
            const gh = gaussian(fl.normX, smoothMouseX, POST_SEL_HOVER_SIGMA);
            const hoverH =
              FIELD_MIN_HEIGHT +
              gh * (POST_SEL_HOVER_MAX_HEIGHT - FIELD_MIN_HEIGHT);
            const hoverA = gh * POST_SEL_HOVER_MAX_ALPHA * hoverIntensity;
            if (hoverH > height) height = hoverH;
            alpha = Math.min(0.7, alpha + hoverA);
          }
        } else if (smoothMouseX >= 0 && hoverIntensity > 0) {
          // Hover state
          const g = gaussian(fl.normX, smoothMouseX, GAUSSIAN_SIGMA);
          const rawHeight =
            FIELD_MIN_HEIGHT + g * (HOVER_MAX_HEIGHT - FIELD_MIN_HEIGHT);
          const rawAlpha = 0.03 + g * (HOVER_MAX_ALPHA - 0.03);

          const breathe =
            Math.sin(time * 0.8 + fl.phaseOffset) * 0.5 + 0.5;
          const idleHeight = FIELD_MIN_HEIGHT + breathe * 4;
          const idleAlpha = 0.03 + breathe * 0.02;

          height =
            idleHeight + (rawHeight - idleHeight) * hoverIntensity;
          alpha = idleAlpha + (rawAlpha - idleAlpha) * hoverIntensity;
          cr = hoverColor.r;
          cg = hoverColor.g;
          cb = hoverColor.b;
        } else {
          // Idle state
          const breathe =
            Math.sin(time * 0.8 + fl.phaseOffset) * 0.5 + 0.5;
          height = FIELD_MIN_HEIGHT + breathe * 4;
          alpha = 0.03 + breathe * 0.02;
          cr = hoverColor.r;
          cg = hoverColor.g;
          cb = hoverColor.b;
        }

        ctx.beginPath();
        ctx.moveTo(x, baselineY - height);
        ctx.lineTo(x, baselineY + height);
        ctx.strokeStyle = `rgba(${cr! | 0}, ${cg! | 0}, ${cb! | 0}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Draw nodes ──

      for (let i = 0; i < 5; i++) {
        const node = nodes[i];
        const isHovered = hoverIdx === i;
        const isSelected = selected === i;
        const hasSelection = selected >= 0;
        const color = SPECTRUM[i];

        let nodeSize: number;
        let nodeAlpha: number;

        if (isSelected) {
          nodeSize = 12;
          nodeAlpha = 0.95;
        } else if (isHovered && hasSelection) {
          nodeSize = 8;
          nodeAlpha = 0.35;
        } else if (isHovered) {
          nodeSize = 9;
          nodeAlpha = 0.6;
        } else if (hasSelection) {
          nodeSize = 6;
          nodeAlpha = 0.2;
        } else {
          nodeSize = 7;
          nodeAlpha = 0.5;
        }

        // Glow for selected node
        if (isSelected) {
          ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
          ctx.shadowBlur = 16;
        }

        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${nodeAlpha})`;
        ctx.fillRect(
          node.x - nodeSize / 2,
          node.y - nodeSize / 2,
          nodeSize,
          nodeSize
        );

        if (isSelected) {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }
      }

      // ── Draw labels (min + max only) ──

      ctx.font = '400 13px "Kosugi", sans-serif';
      ctx.textBaseline = "top";

      // Min label (left)
      {
        const node = nodes[0];
        const isHovered = hoverIdx === 0;
        const isSelected = selected === 0;
        const hasSelection = selected >= 0;
        const labelAlpha = isSelected
          ? 0.95
          : isHovered
            ? 0.75
            : hasSelection
              ? 0.3
              : 0.6;

        ctx.textAlign = "left";
        ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha})`;
        ctx.fillText(minLabel.toUpperCase(), node.x, node.y + 16);
      }

      // Max label (right)
      {
        const node = nodes[4];
        const isHovered = hoverIdx === 4;
        const isSelected = selected === 4;
        const hasSelection = selected >= 0;
        const labelAlpha = isSelected
          ? 0.95
          : isHovered
            ? 0.75
            : hasSelection
              ? 0.3
              : 0.6;

        ctx.textAlign = "right";
        ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha})`;
        ctx.fillText(maxLabel.toUpperCase(), node.x, node.y + 16);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    // ── Cleanup ──

    return () => {
      cancelAnimationFrame(animRef.current);
      if (observer) observer.disconnect();
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseleave", handleMouseLeave);
      container.removeEventListener("touchend", handleTouchEnd);
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    };
  }, [resize]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}

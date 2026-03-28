"use client";

/**
 * SituationalResponse — Canvas 2D radial selector
 *
 * Ported from ops-site leadership assessment SituationalGrid.
 * 4 rays from center to nodes at organic cardinal positions.
 * Hover pushes other nodes away via angular redistribution.
 * Selection triggers angular redistribution with glow.
 * Mobile: vertical line with alternating left/right labels.
 *
 * Pure Canvas 2D API — no animation libraries.
 */

import { useRef, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SituationalResponseProps {
  options: { id: string; label: string }[];
  value: string | null;
  onSelect: (optionId: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 }; // #597794
const GREY = { r: 100, g: 100, b: 100 };

const HIT_RADIUS = 60;
const PI2 = Math.PI * 2;
const SELECT_DELAY_MS = 500;

// Offset by ~PI/6, slightly organic spacing
const ROT = Math.PI / 6;
const BASE_ANGLES = [
  -Math.PI / 2 + 0.12 + ROT, // top-ish
  0 + 0.08 + ROT, // right-ish
  Math.PI / 2 - 0.12 + ROT, // bottom-ish
  Math.PI + 0.05 + ROT, // left-ish
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function wrapAngleDelta(target: number, current: number): number {
  let delta = target - current;
  delta -= Math.round(delta / PI2) * PI2;
  return delta;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SituationalResponse({
  options,
  value,
  onSelect,
}: SituationalResponseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const selectedRef = useRef<number>(-1);
  const hoveredRef = useRef<number>(-1);
  const onSelectRef = useRef(onSelect);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentAnglesRef = useRef<number[]>([...BASE_ANGLES]);
  const targetAnglesRef = useRef<number[]>([...BASE_ANGLES]);
  const nodeRadiiRef = useRef<number[]>([1, 1, 1, 1]);
  const nodeTintRef = useRef<number[]>([0, 0, 0, 0]);

  onSelectRef.current = onSelect;

  // Apply saved value on mount
  if (value !== null && selectedRef.current < 0) {
    const savedIdx = options.findIndex((o) => o.id === value);
    if (savedIdx >= 0) {
      selectedRef.current = savedIdx;
    }
  }

  // DPI-aware resize
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

  // Hit detection
  const getHoveredIndex = useCallback(
    (mx: number, my: number, nodePositions: { x: number; y: number }[]) => {
      let closest = -1;
      let closestDist = HIT_RADIUS;
      for (let i = 0; i < nodePositions.length; i++) {
        const dx = mx - nodePositions[i].x;
        const dy = my - nodePositions[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      return closest;
    },
    []
  );

  // Main effect
  useEffect(() => {
    resize();

    const container = containerRef.current!;
    const canvas = canvasRef.current!;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    }

    const mousePos = { x: -9999, y: -9999 };

    // Selection logic
    const selectNode = (mx: number, my: number) => {
      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const mCx = w / 2;
      const mCy = h / 2;
      const mobile = w < 500;
      const optCount = Math.min(4, options.length);

      let nodePositions: { x: number; y: number }[];

      if (mobile) {
        const topY = h * 0.08;
        const bottomY = h * 0.92;
        const lineLen = bottomY - topY;
        nodePositions = [];
        for (let i = 0; i < optCount; i++) {
          const normY = optCount > 1 ? i / (optCount - 1) : 0.5;
          nodePositions.push({ x: mCx, y: topY + normY * lineLen });
        }
      } else {
        const radius = Math.min(w, h) * 0.32;
        const currentAngles = currentAnglesRef.current;
        const radii = nodeRadiiRef.current;
        nodePositions = currentAngles.map((angle, i) => ({
          x: mCx + Math.cos(angle) * radius * radii[i],
          y: mCy + Math.sin(angle) * radius * radii[i],
        }));
      }

      const idx = getHoveredIndex(mx, my, nodePositions);

      if (idx >= 0 && idx < options.length) {
        if (selectedRef.current === idx) return;
        selectedRef.current = idx;

        const selAngle = BASE_ANGLES[idx];
        const targets = [...BASE_ANGLES];
        targets[idx] = selAngle;

        for (let i = 0; i < 4; i++) {
          if (i === idx) continue;
          const diff = Math.abs(i - idx);
          const isOpposite = diff === 2;
          const isAdjacent = diff === 1 || diff === 3;

          if (isAdjacent) {
            const sign =
              wrapAngleDelta(BASE_ANGLES[i], selAngle) > 0 ? 1 : -1;
            targets[i] = selAngle + sign * ((Math.PI * 2) / 3);
          } else if (isOpposite) {
            targets[i] = selAngle + Math.PI;
          }
        }
        targetAnglesRef.current = targets;

        if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
        selectTimerRef.current = setTimeout(() => {
          onSelectRef.current(options[idx].id);
        }, SELECT_DELAY_MS);
      }
    };

    // Event handlers
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mousePos.x = e.clientX - rect.left;
      mousePos.y = e.clientY - rect.top;
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      selectNode(e.clientX - rect.left, e.clientY - rect.top);
    };

    const handleMouseLeave = () => {
      mousePos.x = -9999;
      mousePos.y = -9999;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      selectNode(t.clientX - rect.left, t.clientY - rect.top);
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("touchend", handleTouchEnd);

    // Animation loop
    const currentAngles = currentAnglesRef.current;
    const targetAngles = targetAnglesRef.current;
    const radii = nodeRadiiRef.current;
    const tints = nodeTintRef.current;

    function draw() {
      const canvasEl = canvasRef.current;
      if (!canvasEl) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvasEl.getContext("2d");
      if (!ctx) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const w = parseFloat(canvasEl.style.width) || canvasEl.width;
      const h = parseFloat(canvasEl.style.height) || canvasEl.height;
      const cx = w / 2;
      const cy = h / 2;
      const selected = selectedRef.current;
      const isMobile = w < 500;

      ctx.clearRect(0, 0, w, h);

      const optCount = Math.min(4, options.length);

      let nodePositions: { x: number; y: number }[];

      if (isMobile) {
        // MOBILE: Vertical line
        const lineX = cx;
        const topY = h * 0.08;
        const bottomY = h * 0.92;
        const lineLen = bottomY - topY;

        nodePositions = [];
        for (let i = 0; i < optCount; i++) {
          const normY = optCount > 1 ? i / (optCount - 1) : 0.5;
          nodePositions.push({ x: lineX, y: topY + normY * lineLen });
        }

        const hoverIdx = getHoveredIndex(
          mousePos.x,
          mousePos.y,
          nodePositions
        );
        hoveredRef.current = hoverIdx;
        canvas.style.cursor = hoverIdx >= 0 ? "pointer" : "default";

        // Draw vertical line
        ctx.beginPath();
        ctx.moveTo(lineX, topY);
        ctx.lineTo(lineX, bottomY);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw nodes + labels
        for (let i = 0; i < optCount; i++) {
          const pos = nodePositions[i];
          const isSelected = selected === i;
          const isHovered = hoverIdx === i;
          const hasSelection = selected >= 0;

          let nodeSize: number;
          let nodeAlpha: number;
          let nodeColor: typeof ACCENT;

          if (isSelected) {
            nodeColor = ACCENT;
            nodeSize = 12;
            nodeAlpha = 0.9;
          } else if (isHovered && hasSelection && !isSelected) {
            nodeColor = ACCENT;
            nodeSize = 6;
            nodeAlpha = 0.35;
          } else if (isHovered && !hasSelection) {
            nodeColor = ACCENT;
            nodeSize = 9;
            nodeAlpha = 0.65;
          } else if (hasSelection) {
            nodeColor = GREY;
            nodeSize = 5;
            nodeAlpha = 0.15;
          } else {
            nodeColor = { r: 160, g: 160, b: 160 };
            nodeSize = 7;
            nodeAlpha = 0.5;
          }

          if (isSelected) {
            ctx.shadowColor = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.5)`;
            ctx.shadowBlur = 14;
          }

          ctx.fillStyle = `rgba(${nodeColor.r}, ${nodeColor.g}, ${nodeColor.b}, ${nodeAlpha})`;
          ctx.fillRect(
            pos.x - nodeSize / 2,
            pos.y - nodeSize / 2,
            nodeSize,
            nodeSize
          );

          if (isSelected) {
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
          }

          // Label — alternating left/right
          const tintTarget = isSelected || isHovered ? 1 : 0;
          tints[i] += (tintTarget - tints[i]) * 0.08;
          const tint = tints[i];

          const textAlpha = isSelected
            ? 0.9
            : isHovered && hasSelection && !isSelected
              ? 0.55
              : isHovered && !hasSelection
                ? 0.7
                : hasSelection
                  ? 0.25
                  : 0.6;
          ctx.font = '400 18px "Kosugi", sans-serif';
          const labelR = (200 + (ACCENT.r - 200) * tint) | 0;
          const labelG = (200 + (ACCENT.g - 200) * tint) | 0;
          const labelB = (200 + (ACCENT.b - 200) * tint) | 0;
          ctx.fillStyle = `rgba(${labelR}, ${labelG}, ${labelB}, ${textAlpha})`;
          ctx.textBaseline = "middle";

          const isLeftSide = i % 2 === 0;
          const textGap = 18;
          const maxWidth = cx - 30;

          if (isLeftSide) {
            ctx.textAlign = "right";
            const lines = wrapText(ctx, options[i].label.toUpperCase(), maxWidth);
            const lineHeight = 22;
            const blockHeight = (lines.length - 1) * lineHeight;
            const startY = pos.y - blockHeight / 2;
            for (let li = 0; li < lines.length; li++) {
              ctx.fillText(
                lines[li],
                pos.x - textGap,
                startY + li * lineHeight
              );
            }
          } else {
            ctx.textAlign = "left";
            const lines = wrapText(ctx, options[i].label.toUpperCase(), maxWidth);
            const lineHeight = 22;
            const blockHeight = (lines.length - 1) * lineHeight;
            const startY = pos.y - blockHeight / 2;
            for (let li = 0; li < lines.length; li++) {
              ctx.fillText(
                lines[li],
                pos.x + textGap,
                startY + li * lineHeight
              );
            }
          }
        }
      } else {
        // DESKTOP: Radial layout
        const radius = Math.min(w, h) * 0.32;

        nodePositions = currentAngles.map((angle, i) => ({
          x: cx + Math.cos(angle) * radius * radii[i],
          y: cy + Math.sin(angle) * radius * radii[i],
        }));

        const hoverIdx = getHoveredIndex(
          mousePos.x,
          mousePos.y,
          nodePositions
        );
        hoveredRef.current = hoverIdx;
        canvas.style.cursor = hoverIdx >= 0 ? "pointer" : "default";

        // Update target angles on hover (only if no selection)
        if (selected < 0) {
          if (hoverIdx >= 0) {
            const hovAngle = BASE_ANGLES[hoverIdx];
            for (let i = 0; i < 4; i++) {
              if (i === hoverIdx) {
                targetAngles[i] = BASE_ANGLES[i];
              } else {
                const diff = Math.abs(i - hoverIdx);
                const isOpposite = diff === 2;
                if (isOpposite) {
                  targetAngles[i] = hovAngle + Math.PI;
                } else {
                  const sign =
                    wrapAngleDelta(BASE_ANGLES[i], hovAngle) > 0 ? 1 : -1;
                  targetAngles[i] =
                    hovAngle + sign * (Math.PI / 2 + Math.PI / 8);
                }
              }
            }
          } else {
            for (let i = 0; i < 4; i++) {
              targetAngles[i] = BASE_ANGLES[i];
            }
          }
        }

        // Lerp angles and radii
        for (let i = 0; i < 4; i++) {
          const delta = wrapAngleDelta(targetAngles[i], currentAngles[i]);
          currentAngles[i] += delta * 0.06;
        }

        for (let i = 0; i < 4; i++) {
          const target =
            selected >= 0
              ? selected === i
                ? 1.15
                : 0.92
              : hoverIdx === i
                ? 1.06
                : 1.0;
          radii[i] += (target - radii[i]) * 0.06;
        }

        // Recompute positions after lerp
        for (let i = 0; i < 4; i++) {
          nodePositions[i] = {
            x: cx + Math.cos(currentAngles[i]) * radius * radii[i],
            y: cy + Math.sin(currentAngles[i]) * radius * radii[i],
          };
        }

        // Draw rays and nodes
        for (let i = 0; i < optCount; i++) {
          const pos = nodePositions[i];
          const isSelected = selected === i;
          const isHovered = hoverIdx === i;
          const hasSelection = selected >= 0;
          const isHoveredWhileSelected =
            isHovered && hasSelection && !isSelected;

          let nodeSize: number;
          let nodeAlpha: number;
          let nodeColor: typeof ACCENT;

          if (isSelected) {
            nodeColor = ACCENT;
            nodeSize = 12;
            nodeAlpha = 0.9;
          } else if (isHoveredWhileSelected) {
            nodeColor = ACCENT;
            nodeSize = 6;
            nodeAlpha = 0.35;
          } else if (isHovered && !hasSelection) {
            nodeColor = ACCENT;
            nodeSize = 9;
            nodeAlpha = 0.65;
          } else if (hasSelection) {
            nodeColor = GREY;
            nodeSize = 5;
            nodeAlpha = 0.15;
          } else {
            nodeColor = { r: 160, g: 160, b: 160 };
            nodeSize = 7;
            nodeAlpha = 0.5;
          }

          // Ray
          const rayAlpha = isSelected
            ? 0.6
            : isHovered && !hasSelection
              ? 0.35
              : isHoveredWhileSelected
                ? 0.12
                : hasSelection
                  ? 0.06
                  : 0.25;

          if (isSelected) {
            ctx.shadowColor = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.6)`;
            ctx.shadowBlur = 18;
          }

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(pos.x, pos.y);
          const rayColor =
            !isSelected && !isHovered && !hasSelection
              ? { r: 160, g: 160, b: 160 }
              : nodeColor;
          ctx.strokeStyle = `rgba(${rayColor.r}, ${rayColor.g}, ${rayColor.b}, ${rayAlpha})`;
          ctx.lineWidth = isSelected ? 1.5 : 0.6;
          ctx.stroke();

          if (isSelected) ctx.stroke(); // double-stroke for glow

          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;

          // Node glow
          if (isSelected || isHoveredWhileSelected) {
            ctx.shadowColor = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${isSelected ? 0.5 : 0.3})`;
            ctx.shadowBlur = isSelected ? 14 : 8;
          }

          ctx.fillStyle = `rgba(${nodeColor.r}, ${nodeColor.g}, ${nodeColor.b}, ${nodeAlpha})`;
          ctx.fillRect(
            pos.x - nodeSize / 2,
            pos.y - nodeSize / 2,
            nodeSize,
            nodeSize
          );

          if (isSelected || isHoveredWhileSelected) {
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
          }

          // Label
          const baseCos = Math.cos(BASE_ANGLES[i]);

          const tintTarget = isSelected || isHovered ? 1 : 0;
          tints[i] += (tintTarget - tints[i]) * 0.08;
          const tint = tints[i];

          const textAlpha = isSelected
            ? 0.9
            : isHoveredWhileSelected
              ? 0.55
              : isHovered && !hasSelection
                ? 0.7
                : hasSelection
                  ? 0.25
                  : 0.6;
          ctx.font = '400 18px "Kosugi", sans-serif';
          const labelR = (200 + (ACCENT.r - 200) * tint) | 0;
          const labelG = (200 + (ACCENT.g - 200) * tint) | 0;
          const labelB = (200 + (ACCENT.b - 200) * tint) | 0;
          ctx.fillStyle = `rgba(${labelR}, ${labelG}, ${labelB}, ${textAlpha})`;

          const lineHeight = 22;
          const maxWidth = 200;
          const baseSin = Math.sin(BASE_ANGLES[i]);

          const isRightAligned =
            (baseSin < -0.3 && baseCos < 0.3) ||
            (baseCos < -0.3 && Math.abs(baseSin) < 0.7) ||
            (baseSin > 0.3 && Math.abs(baseCos) < 0.7);

          let textX: number;
          if (isRightAligned) {
            ctx.textAlign = "right";
            textX = pos.x - 20;
          } else {
            ctx.textAlign = "left";
            textX = pos.x + 20;
          }

          const lines = wrapText(ctx, options[i].label.toUpperCase(), maxWidth);
          const blockHeight = (lines.length - 1) * lineHeight;
          const blockStartY = pos.y - blockHeight / 2;

          for (let li = 0; li < lines.length; li++) {
            ctx.fillText(
              lines[li],
              textX,
              blockStartY + li * lineHeight
            );
          }
        }

        // Center point
        ctx.fillStyle = `rgba(${GREY.r}, ${GREY.g}, ${GREY.b}, 0.12)`;
        ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      if (observer) observer.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("touchend", handleTouchEnd);
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    };
  }, [resize, getHoveredIndex, options]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}

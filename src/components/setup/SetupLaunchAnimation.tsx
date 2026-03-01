"use client";

/**
 * SetupLaunchAnimation — Canvas 2D orbit + convergence animation
 *
 * Sequence:
 * 1. Start from starfield state (all nodes visible, answered ones blue)
 * 2. Draw lines between answered nodes (edges fade in ~500ms)
 * 3. Camera orbit: rotate from XY → Z-axis view (~2s)
 * 4. Answered nodes converge into single point
 * 5. Ambient particles fade out one by one (~1.5s)
 * 6. Single node pulses then fades (~800ms)
 * 7. Canvas dark → trigger onComplete
 *
 * Total: ~5-6 seconds
 */

import { useRef, useEffect, useCallback } from "react";
import type { StarfieldQuestion } from "@/stores/setup-store";

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 };
const GREY = { r: 160, g: 160, b: 160 };
const FOCAL_LENGTH = 600;
const PARTICLE_COUNT = 60;
const TOTAL_DURATION = 5500; // ms

// ─── Easing ─────────────────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface SetupLaunchAnimationProps {
  questions: StarfieldQuestion[];
  starfieldAnswers: Record<string, string | number>;
  onComplete: () => void;
}

export function SetupLaunchAnimation({
  questions,
  starfieldAnswers,
  onComplete,
}: SetupLaunchAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

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

  useEffect(() => {
    resize();

    const container = containerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    }

    const answeredNodes = questions.filter((q) => starfieldAnswers[q.id] != null);
    const unansweredNodes = questions.filter((q) => starfieldAnswers[q.id] == null);

    // Generate ambient particles
    const particles: {
      x: number;
      y: number;
      z: number;
      size: number;
      alpha: number;
      fadeDelay: number;
    }[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 800,
        z: (Math.random() - 0.5) * 400,
        size: 1 + Math.random() * 2,
        alpha: 0.03 + Math.random() * 0.06,
        fadeDelay: Math.random(),
      });
    }

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    function project(
      px: number,
      py: number,
      pz: number,
      cameraZ: number,
      rotateAngle: number,
      centerX: number,
      centerY: number,
      zoom: number
    ): { x: number; y: number; scale: number } {
      // Rotate around Y-axis
      const cosA = Math.cos(rotateAngle);
      const sinA = Math.sin(rotateAngle);
      const rx = px * cosA - pz * sinA;
      const ry = py;
      const rz = px * sinA + pz * cosA;

      const perspective = FOCAL_LENGTH / (FOCAL_LENGTH + rz - cameraZ);
      const scale = perspective * zoom;
      return {
        x: centerX + rx * scale,
        y: centerY + ry * scale,
        scale: Math.max(scale, 0),
      };
    }

    function draw(timestamp: number) {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / TOTAL_DURATION, 1);

      const canvas = canvasRef.current;
      if (!canvas) {
        if (progress < 1) animRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        if (progress < 1) animRef.current = requestAnimationFrame(draw);
        return;
      }

      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const centerX = w / 2;
      const centerY = h / 2;

      ctx.clearRect(0, 0, w, h);

      // ── Phase timing ──
      // 0.0 - 0.09: Edge lines fade in
      // 0.09 - 0.55: Camera orbit (rotate around Y)
      // 0.55 - 0.82: Particles fade out
      // 0.82 - 1.0: Final node pulse + fade

      const edgeProgress = Math.min(progress / 0.09, 1);
      const orbitProgress =
        progress < 0.09
          ? 0
          : Math.min((progress - 0.09) / 0.46, 1);
      const particleFadeProgress =
        progress < 0.55
          ? 0
          : Math.min((progress - 0.55) / 0.27, 1);
      const finalFadeProgress =
        progress < 0.82
          ? 0
          : Math.min((progress - 0.82) / 0.18, 1);

      // Camera rotation from 0 to PI/2 (XY plane → Z-axis view)
      const rotateAngle = easeInOutCubic(orbitProgress) * (Math.PI / 2);
      const cameraZ = -400;
      const zoom = 1 + orbitProgress * 0.3;

      // ── Draw ambient particles ──
      for (const p of particles) {
        const fadeT =
          particleFadeProgress > 0
            ? Math.max(0, 1 - (particleFadeProgress - p.fadeDelay * 0.5) / 0.5)
            : 1;
        if (fadeT <= 0) continue;

        const proj = project(p.x, p.y, p.z, cameraZ, rotateAngle, centerX, centerY, zoom);
        if (proj.scale <= 0) continue;

        const screenSize = p.size * proj.scale;
        const alpha = p.alpha * fadeT;

        ctx.fillStyle = `rgba(${GREY.r}, ${GREY.g}, ${GREY.b}, ${alpha})`;
        ctx.fillRect(
          proj.x - screenSize / 2,
          proj.y - screenSize / 2,
          screenSize,
          screenSize
        );
      }

      // ── Draw unanswered nodes (fade during orbit) ──
      for (const q of unansweredNodes) {
        const fade = Math.max(0, 1 - orbitProgress * 2);
        if (fade <= 0) continue;

        const proj = project(
          q.position.x,
          q.position.y,
          q.position.z,
          cameraZ,
          rotateAngle,
          centerX,
          centerY,
          zoom
        );
        if (proj.scale <= 0) continue;

        const nodeSize = 8 * proj.scale;
        ctx.fillStyle = `rgba(${GREY.r}, ${GREY.g}, ${GREY.b}, ${0.3 * fade})`;
        ctx.fillRect(
          proj.x - nodeSize / 2,
          proj.y - nodeSize / 2,
          nodeSize,
          nodeSize
        );
      }

      // ── Draw edges between answered nodes ──
      if (answeredNodes.length >= 2) {
        const edgeAlpha = easeInOutCubic(edgeProgress) * 0.4;
        ctx.strokeStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${edgeAlpha})`;
        ctx.lineWidth = 1;

        for (let i = 0; i < answeredNodes.length; i++) {
          for (let j = i + 1; j < answeredNodes.length; j++) {
            const a = answeredNodes[i];
            const b = answeredNodes[j];
            const pa = project(
              a.position.x,
              a.position.y,
              a.position.z,
              cameraZ,
              rotateAngle,
              centerX,
              centerY,
              zoom
            );
            const pb = project(
              b.position.x,
              b.position.y,
              b.position.z,
              cameraZ,
              rotateAngle,
              centerX,
              centerY,
              zoom
            );

            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
        }
      }

      // ── Draw answered nodes ──
      const showFinalFade = finalFadeProgress > 0;
      const finalAlpha = showFinalFade
        ? Math.max(0, 1 - easeInOutCubic(finalFadeProgress))
        : 1;

      for (const q of answeredNodes) {
        const proj = project(
          q.position.x,
          q.position.y,
          q.position.z,
          cameraZ,
          rotateAngle,
          centerX,
          centerY,
          zoom
        );
        if (proj.scale <= 0) continue;

        const nodeSize = 8 * proj.scale;

        // Glow
        if (finalAlpha > 0) {
          ctx.shadowColor = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${0.4 * finalAlpha})`;
          ctx.shadowBlur = showFinalFade ? 20 + (1 - finalFadeProgress) * 10 : 16;
        }

        ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${0.8 * finalAlpha})`;
        ctx.fillRect(
          proj.x - nodeSize / 2,
          proj.y - nodeSize / 2,
          nodeSize,
          nodeSize
        );
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }

      // ── Continue or complete ──
      if (progress >= 1) {
        onCompleteRef.current();
        return;
      }

      if (prefersReduced && progress === 0) {
        // Single frame for reduced motion, then complete after timeout
        setTimeout(() => onCompleteRef.current(), 500);
        return;
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      if (observer) observer.disconnect();
    };
  }, [questions, starfieldAnswers, resize]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}

"use client";

/**
 * SetupLaunchAnimation — Hyperspeed star-tunnel transition
 *
 * Sequence:
 * 1. Stars visible as dots (brief idle, ~300ms)
 * 2. Accelerate forward — stars stretch into radial streaks (~2s)
 * 3. Full hyperspeed tunnel — long blue/white streaks (~1.5s)
 * 4. Bright flash from center (~400ms)
 * 5. Fade to black → trigger onComplete (~800ms)
 *
 * Total: ~5 seconds
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { Check } from "lucide-react";
import type { StarfieldQuestion } from "@/stores/setup-store";

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 };
const STAR_COUNT = 500;
const TOTAL_DURATION = 5000; // ms

// ─── Star ───────────────────────────────────────────────────────────────────

interface HyperStar {
  x: number; // cross-section position (-1 to 1)
  y: number;
  z: number; // depth (0.001 = near camera, 1 = far)
  size: number;
  brightness: number;
}

function spawnStar(zMin = 0.01, zMax = 1): HyperStar {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.03 + Math.pow(Math.random(), 0.6) * 0.97;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: zMin + Math.random() * (zMax - zMin),
    size: 0.4 + Math.random() * 1.6,
    brightness: 0.3 + Math.random() * 0.7,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface SetupLaunchAnimationProps {
  questions: StarfieldQuestion[];
  starfieldAnswers: Record<string, string | number>;
  onComplete: () => void;
  workspaceReady?: boolean;
}

export function SetupLaunchAnimation({
  onComplete,
  workspaceReady,
}: SetupLaunchAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Workspace overlay
  const [overlayVisible, setOverlayVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOverlayVisible(true), 600);
    return () => clearTimeout(timer);
  }, []);

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

    const stars: HyperStar[] = Array.from({ length: STAR_COUNT }, () =>
      spawnStar()
    );

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let lastTime: number | null = null;

    function draw(timestamp: number) {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      if (lastTime === null) lastTime = timestamp;
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap dt
      lastTime = timestamp;

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
      const focalLength = Math.min(w, h) * 0.5;

      // Clear to black
      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fillRect(0, 0, w, h);

      // ── Speed curve ──
      // 0.00 - 0.06: idle/gentle (0 → 0.3)
      // 0.06 - 0.45: exponential ramp (0.3 → 12)
      // 0.45 - 0.72: full hyperspeed (12 → 20)
      // 0.72+: hold at max during flash/fade
      let speed: number;
      if (progress < 0.06) {
        speed = (progress / 0.06) * 0.3;
      } else if (progress < 0.45) {
        const t = (progress - 0.06) / 0.39;
        speed = 0.3 + Math.pow(t, 2.2) * 11.7;
      } else if (progress < 0.72) {
        const t = (progress - 0.45) / 0.27;
        speed = 12 + t * 8;
      } else {
        speed = 20;
      }

      // ── Color shift: white → accent blue ──
      const colorT = Math.min(progress / 0.45, 1);
      const starR = Math.round(220 - (220 - ACCENT.r) * colorT * 0.7);
      const starG = Math.round(220 - (220 - ACCENT.g) * colorT * 0.5);
      const starB = Math.round(230 - (230 - ACCENT.b) * colorT * 0.3);

      // Brighter core color for fast stars
      const coreR = Math.round(255 - (255 - 180) * colorT * 0.3);
      const coreG = Math.round(255 - (255 - 210) * colorT * 0.3);
      const coreB = 255;

      // ── Move and draw stars ──
      const trailScale = speed * 0.02;

      for (const star of stars) {
        // Advance toward camera
        star.z -= speed * dt * 0.25;

        // Respawn behind camera
        if (star.z <= 0.002) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 0.03 + Math.pow(Math.random(), 0.6) * 0.97;
          star.x = Math.cos(angle) * radius;
          star.y = Math.sin(angle) * radius;
          star.z = 0.7 + Math.random() * 0.3;
          star.brightness = 0.3 + Math.random() * 0.7;
        }

        // Project current position
        const perspective = 1 / star.z;
        const sx = centerX + star.x * perspective * focalLength;
        const sy = centerY + star.y * perspective * focalLength;

        // Skip if off-screen (with generous margin)
        if (sx < -100 || sx > w + 100 || sy < -100 || sy > h + 100) continue;

        // Trail end (slightly deeper z = closer to center)
        const trailZ = Math.min(star.z + trailScale, 1);
        const trailPerspective = 1 / trailZ;
        const tsx = centerX + star.x * trailPerspective * focalLength;
        const tsy = centerY + star.y * trailPerspective * focalLength;

        const alpha = star.brightness * Math.min(1, 0.15 + speed * 0.12);

        if (speed < 0.8) {
          // Dots at low speed
          const dotSize = Math.max(1, star.size * perspective * 1.5);
          ctx.fillStyle = `rgba(${starR}, ${starG}, ${starB}, ${alpha * 0.6})`;
          ctx.beginPath();
          ctx.arc(sx, sy, dotSize, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Streaks at high speed
          const lineWidth = Math.max(0.3, star.size * perspective * 0.8);

          // Outer streak (colored)
          ctx.strokeStyle = `rgba(${starR}, ${starG}, ${starB}, ${alpha * 0.8})`;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          ctx.moveTo(tsx, tsy);
          ctx.lineTo(sx, sy);
          ctx.stroke();

          // Bright core for close/bright stars
          if (star.z < 0.3 && star.brightness > 0.5) {
            ctx.strokeStyle = `rgba(${coreR}, ${coreG}, ${coreB}, ${alpha * 0.5})`;
            ctx.lineWidth = Math.max(0.2, lineWidth * 0.4);
            ctx.beginPath();
            ctx.moveTo(tsx, tsy);
            ctx.lineTo(sx, sy);
            ctx.stroke();
          }
        }
      }

      // ── Central glow during hyperspeed ──
      if (speed > 5) {
        const glowIntensity = Math.min((speed - 5) / 15, 1) * 0.15;
        const gradient = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          Math.min(w, h) * 0.4
        );
        gradient.addColorStop(
          0,
          `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${glowIntensity})`
        );
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Flash (0.72 → 0.82) ──
      if (progress > 0.72 && progress <= 0.82) {
        const flashT = (progress - 0.72) / 0.1;
        // Quick rise, slower fall
        const flashAlpha =
          flashT < 0.4
            ? (flashT / 0.4) * 0.7
            : 0.7 * (1 - (flashT - 0.4) / 0.6);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, flashAlpha)})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Fade to black (0.82 → 1.0) ──
      if (progress > 0.82) {
        const fadeT = (progress - 0.82) / 0.18;
        ctx.fillStyle = `rgba(0, 0, 0, ${fadeT})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Complete ──
      if (progress >= 1) {
        // Final black frame
        ctx.fillStyle = "rgb(0, 0, 0)";
        ctx.fillRect(0, 0, w, h);
        onCompleteRef.current();
        return;
      }

      if (prefersReduced && elapsed === 0) {
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
  }, [resize]);

  return (
    <div ref={containerRef} className="absolute inset-0" aria-hidden="true">
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />

      {/* Workspace setup overlay */}
      <div
        className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 transition-opacity duration-500"
        style={{ opacity: overlayVisible ? 1 : 0 }}
      >
        <div className="flex items-center gap-1.5">
          {workspaceReady && <Check className="w-3 h-3 text-ops-accent" />}
          <span className="font-kosugi text-[11px] text-text-disabled uppercase tracking-widest">
            {workspaceReady ? "Ready" : "Setting up your workspace\u2026"}
          </span>
        </div>
        <div className="w-32 h-[2px] rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
          <div
            className={`h-full bg-ops-accent rounded-full transition-all duration-500 ${
              workspaceReady ? "w-full" : "animate-shimmer"
            }`}
            style={workspaceReady ? undefined : { width: "40%" }}
          />
        </div>
      </div>
    </div>
  );
}

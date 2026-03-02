"use client";

/**
 * SetupStarfield — Interactive Canvas 2D galaxy with question nodes
 *
 * - ~300 ambient stars with randomized sizes, clusters, gentle drift
 * - Cursor repulsion: nearby stars push away with a smear effect
 * - Question nodes: orange glow (unanswered), blue glow (answered)
 * - All nodes have gentle floating oscillation
 * - Focus: subtle zoom, other nodes fade + push outward
 * - Instruction overlay when idle
 */

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { StarfieldQuestion } from "@/stores/setup-store";
import {
  trackStarfieldNodeFocused,
  trackStarfieldQuestionAnswered,
} from "@/lib/analytics/analytics";
import { LikertResponse } from "./starfield/LikertResponse";
import { ForcedChoiceResponse } from "./starfield/ForcedChoiceResponse";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Camera {
  x: number;
  y: number;
  z: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetZoom: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
  baseAlpha: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  displaceX: number;
  displaceY: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 }; // #597794 — answered
const AMBER = { r: 196, g: 168, b: 104 }; // #C4A868 — unanswered question nodes (secondary accent)
const STAR_COUNT = 300;
const CLUSTER_COUNT = 6;
const FOCAL_LENGTH = 600;
const REPULSE_RADIUS = 100;
const REPULSE_STRENGTH = 4;
const NODE_RADIUS = 5;
const NODE_HIT_RADIUS = 28;
const SUB_NODE_RADIUS = 4;
const SUB_NODE_ORBIT_RADIUS = 140;
const CAMERA_LERP = 0.06;

// ─── Projection ──────────────────────────────────────────────────────────────

function project3D(
  px: number,
  py: number,
  pz: number,
  camera: Camera,
  centerX: number,
  centerY: number
): { x: number; y: number; scale: number } {
  const rx = px - camera.x;
  const ry = py - camera.y;
  const rz = pz - camera.z;
  const perspective = FOCAL_LENGTH / (FOCAL_LENGTH + rz);
  const scale = perspective * camera.zoom;
  return {
    x: centerX + rx * scale,
    y: centerY + ry * scale,
    scale,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SetupStarfieldProps {
  questions: StarfieldQuestion[];
  starfieldAnswers: Record<string, string | number>;
  onAnswer: (questionId: string, answer: string | number) => void;
  minRequired?: number;
}

export function SetupStarfield({
  questions,
  starfieldAnswers,
  onAnswer,
  minRequired = 4,
}: SetupStarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const cameraRef = useRef<Camera>({
    x: 0, y: 0, z: -400,
    zoom: 1,
    targetX: 0, targetY: 0, targetZ: -400,
    targetZoom: 1,
  });
  const starsRef = useRef<Star[]>([]);
  const hoveredNodeRef = useRef<string | null>(null);
  const focusProgressRef = useRef(0);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;

  // DOM state for overlays
  const [hoveredNode, setHoveredNode] = useState<{
    id: string;
    label: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [subNodePositions, setSubNodePositions] = useState<
    { id: string; label: string; screenX: number; screenY: number; selected: boolean }[]
  >([]);

  const focusedNodeRef = useRef<string | null>(null);
  focusedNodeRef.current = focusedNode;

  const starfieldAnswersRef = useRef(starfieldAnswers);
  starfieldAnswersRef.current = starfieldAnswers;

  const nodeFocusTimeRef = useRef(0);

  // ─── Conditional visibility ────────────────────────────────────────────

  const visibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (!q.conditionalOn) return true;
      const depAnswer = starfieldAnswers[q.conditionalOn.questionId];
      return depAnswer != null && depAnswer !== q.conditionalOn.excludeAnswer;
    });
  }, [questions, starfieldAnswers]);

  const visibleQuestionsRef = useRef(visibleQuestions);
  visibleQuestionsRef.current = visibleQuestions;

  // ─── Canvas resize ────────────────────────────────────────────────────

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

  // ─── Zoom to node ─────────────────────────────────────────────────────

  const zoomToNode = useCallback((q: StarfieldQuestion) => {
    const camera = cameraRef.current;
    // Subtle drift toward node + slight zoom — no dramatic camera move
    camera.targetX = q.position.x * 0.2;
    camera.targetY = q.position.y * 0.2;
    camera.targetZoom = 1.2;
    nodeFocusTimeRef.current = Date.now();
    const questionIndex = visibleQuestionsRef.current.findIndex((vq) => vq.id === q.id);
    const currentAnsweredCount = visibleQuestionsRef.current.filter(
      (vq) => starfieldAnswersRef.current[vq.id] != null
    ).length;
    trackStarfieldNodeFocused(q.id, questionIndex + 1, currentAnsweredCount);
    setFocusedNode(q.id);
    setHoveredNode(null);
  }, []);

  const zoomOut = useCallback(() => {
    const camera = cameraRef.current;
    camera.targetX = 0;
    camera.targetY = 0;
    camera.targetZoom = 1;
    setFocusedNode(null);
    setSubNodePositions([]);
  }, []);

  // ─── Handle option select ─────────────────────────────────────────────

  const handleOptionSelect = useCallback(
    (questionId: string, optionId: string | number, zoomOutDelay = 400) => {
      const timeOnQuestion = Date.now() - nodeFocusTimeRef.current;
      const questionIndex = visibleQuestionsRef.current.findIndex((q) => q.id === questionId);
      const currentAnsweredCount = visibleQuestionsRef.current.filter(
        (q) => starfieldAnswersRef.current[q.id] != null
      ).length;
      trackStarfieldQuestionAnswered(
        questionId,
        optionId,
        questionIndex + 1,
        currentAnsweredCount + (starfieldAnswersRef.current[questionId] == null ? 1 : 0),
        timeOnQuestion
      );
      onAnswer(questionId, optionId);
      setTimeout(() => zoomOut(), zoomOutDelay);
    },
    [onAnswer, zoomOut]
  );

  // ─── Main animation loop ──────────────────────────────────────────────

  useEffect(() => {
    resize();

    const container = containerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    }

    // Generate cluster centers
    const clusterCenters = Array.from({ length: CLUSTER_COUNT }, () => ({
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 600,
      z: (Math.random() - 0.5) * 300,
    }));

    // Generate stars — mix of clustered and spread
    const stars: Star[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      let x: number, y: number, z: number;
      if (i < STAR_COUNT * 0.35) {
        // Clustered around a center
        const c = clusterCenters[i % CLUSTER_COUNT];
        const spread = 30 + Math.random() * 80;
        x = c.x + (Math.random() - 0.5) * spread;
        y = c.y + (Math.random() - 0.5) * spread;
        z = c.z + (Math.random() - 0.5) * spread * 0.5;
      } else {
        // Spread across the field
        x = (Math.random() - 0.5) * 1000;
        y = (Math.random() - 0.5) * 1000;
        z = (Math.random() - 0.5) * 500;
      }

      // Randomized sizes: mostly small, some medium, rare large
      const sizeRoll = Math.random();
      const size =
        sizeRoll < 0.5
          ? 1 + Math.random() * 1.5
          : sizeRoll < 0.85
            ? 2 + Math.random() * 2
            : 4 + Math.random() * 3;

      stars.push({
        x, y, z, size,
        baseAlpha: 0.08 + Math.random() * 0.15,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        vz: (Math.random() - 0.5) * 1.5,
        phase: Math.random() * Math.PI * 2,
        displaceX: 0,
        displaceY: 0,
      });
    }
    starsRef.current = stars;

    // Mouse handlers
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container?.getBoundingClientRect();
      if (!rect) return;
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };
    container?.addEventListener("mousemove", handleMouseMove);
    container?.addEventListener("mouseleave", handleMouseLeave);

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let prevTimestamp: number | null = null;

    function draw(timestamp: number) {
      if (prevTimestamp === null) prevTimestamp = timestamp;
      const dt = Math.min((timestamp - prevTimestamp) / 1000, 0.1);
      prevTimestamp = timestamp;

      const canvas = canvasRef.current;
      if (!canvas) { animRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { animRef.current = requestAnimationFrame(draw); return; }

      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const centerX = w / 2;
      const centerY = h / 2;
      const mouse = mouseRef.current;
      const camera = cameraRef.current;
      const qs = visibleQuestionsRef.current;
      const answers = starfieldAnswersRef.current;
      const t = timestamp * 0.001;

      // ── Lerp camera toward target ──
      if (!prefersReduced) {
        camera.x += (camera.targetX - camera.x) * CAMERA_LERP;
        camera.y += (camera.targetY - camera.y) * CAMERA_LERP;
        camera.z += (camera.targetZ - camera.z) * CAMERA_LERP;
        camera.zoom += (camera.targetZoom - camera.zoom) * CAMERA_LERP;
      } else {
        camera.x = camera.targetX;
        camera.y = camera.targetY;
        camera.z = camera.targetZ;
        camera.zoom = camera.targetZoom;
      }

      // ── Focus progress (0 = idle, 1 = fully focused) ──
      const targetFP = focusedNodeRef.current ? 1 : 0;
      focusProgressRef.current += (targetFP - focusProgressRef.current) * CAMERA_LERP;
      const fp = focusProgressRef.current;

      ctx.clearRect(0, 0, w, h);

      // ── Draw ambient stars ──
      for (const star of stars) {
        if (!prefersReduced) {
          // Drift
          star.x += star.vx * dt;
          star.y += star.vy * dt;
          star.z += star.vz * dt;

          // Wrap
          if (star.x < -500) star.x = 500;
          if (star.x > 500) star.x = -500;
          if (star.y < -500) star.y = 500;
          if (star.y > 500) star.y = -500;
          if (star.z < -250) star.z = 250;
          if (star.z > 250) star.z = -250;

          // Decay displacement from repulsion
          star.displaceX *= 0.92;
          star.displaceY *= 0.92;
        }

        const proj = project3D(star.x, star.y, star.z, camera, centerX, centerY);
        if (proj.scale <= 0) continue;

        let sx = proj.x + star.displaceX;
        let sy = proj.y + star.displaceY;
        const screenSize = Math.max(star.size * proj.scale, 0.5);

        // Skip off-screen
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

        // Cursor repulsion — push stars away from cursor
        if (!prefersReduced) {
          const mdx = sx - mouse.x;
          const mdy = sy - mouse.y;
          const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
          if (mDist < REPULSE_RADIUS && mDist > 1) {
            const force = (1 - mDist / REPULSE_RADIUS) * REPULSE_STRENGTH;
            star.displaceX += (mdx / mDist) * force;
            star.displaceY += (mdy / mDist) * force;
          }
          // Recalculate screen position with displacement
          sx = proj.x + star.displaceX;
          sy = proj.y + star.displaceY;
        }

        // Twinkle
        const twinkle = 0.8 + 0.2 * Math.sin(t * 0.5 + star.phase);
        const alpha = star.baseAlpha * twinkle;

        ctx.fillStyle = `rgba(220, 220, 230, ${alpha})`;
        ctx.fillRect(sx - screenSize / 2, sy - screenSize / 2, screenSize, screenSize);
      }

      // ── Draw question nodes ──
      let newHoveredNode: string | null = null;
      const isFocused = focusedNodeRef.current !== null;

      for (const q of qs) {
        // Gentle floating oscillation
        const oscX = Math.sin(t * 0.3 + q.position.x * 0.02) * 4;
        const oscY = Math.cos(t * 0.25 + q.position.y * 0.02) * 4;

        const proj = project3D(
          q.position.x + oscX,
          q.position.y + oscY,
          q.position.z,
          camera, centerX, centerY
        );
        if (proj.scale <= 0) continue;

        let sx = proj.x;
        let sy = proj.y;
        const baseNodeSize = NODE_RADIUS * proj.scale;

        const isAnswered = answers[q.id] != null;
        const isFocusedNode = focusedNodeRef.current === q.id;

        // Push non-focused nodes outward during focus
        if (isFocused && !isFocusedNode) {
          const pushAmount = 1 + fp * 0.5;
          sx = centerX + (sx - centerX) * pushAmount;
          sy = centerY + (sy - centerY) * pushAmount;
        }

        // Check hover (only when not focused)
        const dx = sx - mouse.x;
        const dy = sy - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isHovered = dist < NODE_HIT_RADIUS * proj.scale && !isFocused;
        if (isHovered) newHoveredNode = q.id;

        // Determine color and alpha
        let nodeAlpha: number;
        let fillR: number, fillG: number, fillB: number;
        let glowBlur: number;

        if (isFocused && !isFocusedNode) {
          // Faded while another node is focused
          nodeAlpha = 0.12;
          if (isAnswered) {
            fillR = ACCENT.r; fillG = ACCENT.g; fillB = ACCENT.b;
          } else {
            fillR = AMBER.r; fillG = AMBER.g; fillB = AMBER.b;
          }
          glowBlur = 0;
        } else if (isAnswered) {
          // Blue accent glow
          nodeAlpha = 0.9;
          fillR = ACCENT.r; fillG = ACCENT.g; fillB = ACCENT.b;
          glowBlur = 18;
        } else if (isFocusedNode) {
          // Bright orange, strong glow
          nodeAlpha = 1;
          fillR = AMBER.r; fillG = AMBER.g; fillB = AMBER.b;
          glowBlur = 24;
        } else if (isHovered) {
          // Brighter orange on hover
          nodeAlpha = 0.9;
          fillR = AMBER.r; fillG = AMBER.g; fillB = AMBER.b;
          glowBlur = 22;
        } else {
          // Default orange glow — pulsing
          const pulse = 0.5 + 0.15 * Math.sin(t * 0.8 + q.position.x * 0.01);
          nodeAlpha = pulse;
          fillR = AMBER.r; fillG = AMBER.g; fillB = AMBER.b;
          glowBlur = 14;
        }

        // Draw glow
        if (glowBlur > 0) {
          ctx.shadowColor = `rgba(${fillR}, ${fillG}, ${fillB}, ${nodeAlpha * 0.5})`;
          ctx.shadowBlur = glowBlur;
        }

        // Node size — slightly larger when hovered or focused
        const sizeMultiplier = isFocusedNode ? 1.3 : isHovered ? 1.2 : 1;
        const nodeSize = baseNodeSize * sizeMultiplier;

        // Draw as circle
        ctx.fillStyle = `rgba(${fillR}, ${fillG}, ${fillB}, ${nodeAlpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, nodeSize, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // ── Draw sub-nodes when focused (situational only) ──
        if (isFocusedNode && q.responseType === "situational") {
          const subPositions: {
            id: string;
            label: string;
            screenX: number;
            screenY: number;
            selected: boolean;
          }[] = [];

          const options = q.options;
          const angleStep = (2 * Math.PI) / options.length;
          const orbitRadius = SUB_NODE_ORBIT_RADIUS * proj.scale;

          for (let i = 0; i < options.length; i++) {
            const angle = angleStep * i - Math.PI / 2;
            const subX = sx + Math.cos(angle) * orbitRadius;
            const subY = sy + Math.sin(angle) * orbitRadius;
            const subSize = SUB_NODE_RADIUS * proj.scale;
            const isSelected = answers[q.id] === options[i].id;

            // Line from center to sub-node
            ctx.strokeStyle = isSelected
              ? `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.6)`
              : `rgba(255, 255, 255, 0.12)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(subX, subY);
            ctx.stroke();

            // Sub-node dot
            if (isSelected) {
              ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.9)`;
              ctx.shadowColor = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.4)`;
              ctx.shadowBlur = 10;
            } else {
              ctx.fillStyle = `rgba(255, 255, 255, 0.4)`;
            }
            ctx.beginPath();
            ctx.arc(subX, subY, subSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;

            subPositions.push({
              id: options[i].id,
              label: options[i].label,
              screenX: subX,
              screenY: subY,
              selected: isSelected,
            });
          }

          setSubNodePositions(subPositions);
        }
      }

      // Update hover state
      if (newHoveredNode !== hoveredNodeRef.current) {
        hoveredNodeRef.current = newHoveredNode;
        if (newHoveredNode) {
          const q = qs.find((vq) => vq.id === newHoveredNode);
          if (q) {
            const oscX = Math.sin(t * 0.3 + q.position.x * 0.02) * 4;
            const oscY = Math.cos(t * 0.25 + q.position.y * 0.02) * 4;
            const proj = project3D(
              q.position.x + oscX, q.position.y + oscY, q.position.z,
              camera, centerX, centerY
            );
            setHoveredNode({
              id: q.id,
              label: q.label,
              screenX: proj.x,
              screenY: proj.y,
            });
          }
        } else {
          setHoveredNode(null);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    if (prefersReduced) {
      requestAnimationFrame(draw);
    } else {
      animRef.current = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(animRef.current);
      if (observer) observer.disconnect();
      container?.removeEventListener("mousemove", handleMouseMove);
      container?.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [resize]);

  // ─── Click handler ─────────────────────────────────────────────────────

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const centerX = w / 2;
      const centerY = h / 2;
      const camera = cameraRef.current;
      const qs = visibleQuestionsRef.current;
      const t = performance.now() * 0.001;

      // If focused, check sub-node clicks (situational) or zoom out
      if (focusedNodeRef.current) {
        const q = qs.find((vq) => vq.id === focusedNodeRef.current);
        if (q) {
          if (q.responseType === "situational") {
            const oscX = Math.sin(t * 0.3 + q.position.x * 0.02) * 4;
            const oscY = Math.cos(t * 0.25 + q.position.y * 0.02) * 4;
            const proj = project3D(
              q.position.x + oscX, q.position.y + oscY, q.position.z,
              camera, centerX, centerY
            );
            const orbitRadius = SUB_NODE_ORBIT_RADIUS * proj.scale;
            const angleStep = (2 * Math.PI) / q.options.length;

            for (let i = 0; i < q.options.length; i++) {
              const angle = angleStep * i - Math.PI / 2;
              const subX = proj.x + Math.cos(angle) * orbitRadius;
              const subY = proj.y + Math.sin(angle) * orbitRadius;
              const dx = clickX - subX;
              const dy = clickY - subY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 20 * proj.scale) {
                handleOptionSelect(q.id, q.options[i].id);
                return;
              }
            }
          }
          zoomOut();
          return;
        }
      }

      // Check if clicking a question node
      for (const q of qs) {
        const oscX = Math.sin(t * 0.3 + q.position.x * 0.02) * 4;
        const oscY = Math.cos(t * 0.25 + q.position.y * 0.02) * 4;
        const proj = project3D(
          q.position.x + oscX, q.position.y + oscY, q.position.z,
          camera, centerX, centerY
        );
        const dx = clickX - proj.x;
        const dy = clickY - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < NODE_HIT_RADIUS * proj.scale) {
          zoomToNode(q);
          return;
        }
      }
    },
    [zoomToNode, zoomOut, handleOptionSelect]
  );

  // ─── Render ────────────────────────────────────────────────────────────

  const focusedQuestion = visibleQuestions.find((q) => q.id === focusedNode) ?? null;
  const answeredCount = visibleQuestions.filter((q) => starfieldAnswers[q.id] != null).length;

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Setup questionnaire"
      className="absolute inset-0 cursor-crosshair"
      onClick={handleCanvasClick}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: "block", width: "100%", height: "100%" }}
      />

      {/* Screen-reader-only question list */}
      <div className="sr-only">
        <h2>Setup Questions</h2>
        <ul>
          {visibleQuestions.map((q) => {
            const answer = starfieldAnswers[q.id];
            const answerText =
              answer != null
                ? q.responseType === "likert"
                  ? `${answer} of 5`
                  : q.options.find((o) => o.id === answer)?.label ?? String(answer)
                : "Not answered";
            return (
              <li key={q.id}>
                {q.question} — {answerText}
              </li>
            );
          })}
        </ul>
        <p>
          {answeredCount} of {visibleQuestions.length} answered.
          {answeredCount < minRequired &&
            ` ${minRequired - answeredCount} more needed.`}
        </p>
      </div>

      {/* Instruction — visible when no node is focused */}
      <AnimatePresence>
        {!focusedNode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute top-[14%] left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none"
          >
            <p className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.2em]">
              Click the glowing nodes to customize your dashboard
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover tooltip */}
      <AnimatePresence>
        {hoveredNode && !focusedNode && (
          <motion.div
            key={hoveredNode.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute pointer-events-none z-10"
            style={{
              left: hoveredNode.screenX,
              top: hoveredNode.screenY - 32,
              transform: "translateX(-50%)",
            }}
          >
            <div className="px-2 py-1 rounded-sm bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)]">
              <span className="font-mohave text-body-sm text-text-primary whitespace-nowrap">
                {hoveredNode.label}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Focused node: question text + response UI */}
      <AnimatePresence>
        {focusedQuestion && (
          <motion.div
            key={`question-${focusedQuestion.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 pointer-events-none z-10"
          >
            {/* Question text at top */}
            <div className="absolute top-[15%] left-1/2 -translate-x-1/2 text-center max-w-[500px] px-4">
              <h2 className="font-mohave text-display text-text-primary">
                {focusedQuestion.question}
              </h2>
              <p className="font-kosugi text-caption text-text-tertiary mt-1">
                Click an option to answer
              </p>
            </div>

            {/* Situational: sub-node labels */}
            {focusedQuestion.responseType === "situational" &&
              subNodePositions.map((sub) => (
                <div
                  key={sub.id}
                  className="absolute pointer-events-auto cursor-pointer"
                  style={{
                    left: sub.screenX,
                    top: sub.screenY + 16,
                    transform: "translateX(-50%)",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOptionSelect(focusedQuestion.id, sub.id);
                  }}
                >
                  <span
                    className={`font-kosugi text-caption whitespace-nowrap transition-colors ${
                      sub.selected ? "text-ops-accent" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {sub.label}
                  </span>
                </div>
              ))}

            {/* Likert response */}
            {focusedQuestion.responseType === "likert" && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <LikertResponse
                  minLabel={focusedQuestion.likertMin!}
                  maxLabel={focusedQuestion.likertMax!}
                  value={
                    typeof starfieldAnswers[focusedQuestion.id] === "number"
                      ? (starfieldAnswers[focusedQuestion.id] as number)
                      : null
                  }
                  onSelect={(value) => {
                    handleOptionSelect(focusedQuestion.id, value, 100);
                  }}
                />
              </div>
            )}

            {/* Forced choice response */}
            {focusedQuestion.responseType === "forced_choice" && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <ForcedChoiceResponse
                  options={focusedQuestion.options}
                  value={
                    typeof starfieldAnswers[focusedQuestion.id] === "string"
                      ? (starfieldAnswers[focusedQuestion.id] as string)
                      : null
                  }
                  onSelect={(optionId) => {
                    handleOptionSelect(focusedQuestion.id, optionId, 100);
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress indicator */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10" aria-hidden="true">
        <div className="flex items-center gap-2">
          {visibleQuestions.map((q) => (
            <div
              key={q.id}
              className={`w-2 h-2 rounded-sm transition-colors duration-300 ${
                starfieldAnswers[q.id] != null
                  ? "bg-ops-accent shadow-[0_0_6px_rgba(65,115,148,0.4)]"
                  : "bg-white/10"
              }`}
            />
          ))}
        </div>
        <p className="font-kosugi text-[10px] text-text-disabled text-center mt-2">
          {answeredCount}/{visibleQuestions.length} answered
          {answeredCount < minRequired && ` · ${minRequired - answeredCount} more needed`}
        </p>
      </div>
    </div>
  );
}

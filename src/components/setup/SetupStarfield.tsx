"use client";

/**
 * SetupStarfield — Interactive Canvas 2D galaxy with question nodes
 *
 * Full-screen canvas with:
 * - ~80 ambient particles (small squares, slow random drift)
 * - 8 larger question nodes at fixed 3D positions
 * - Cursor proximity: nearby particles brighten + shift orange
 * - Node hover: label tooltip, nearby particles orbit toward node
 * - Click node: camera zooms in, shows sub-node options radially
 * - Select option: sub-node highlights, auto zoom-out
 * - Answered nodes turn accent blue
 * - Respects prefers-reduced-motion
 */

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { StarfieldQuestion } from "@/stores/setup-store";
import { LikertResponse } from "./starfield/LikertResponse";
import { ForcedChoiceResponse } from "./starfield/ForcedChoiceResponse";

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

interface AmbientParticle {
  x: number;
  y: number;
  z: number;
  size: number;
  baseAlpha: number;
  vx: number;
  vy: number;
  vz: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 }; // #597794
const GREY = { r: 160, g: 160, b: 160 };
const ORANGE = { r: 200, g: 140, b: 60 };
const PARTICLE_COUNT = 80;
const FOCAL_LENGTH = 600;
const BRIGHTEN_RADIUS = 80;
const NODE_RADIUS = 8;
const NODE_HIT_RADIUS = 24;
const SUB_NODE_RADIUS = 6;
const SUB_NODE_ORBIT_RADIUS = 80;
const CAMERA_SPRING = 0.04;
const CAMERA_DAMPING = 0.85;

// ─── Projection ─────────────────────────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────────────

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
  const cameraVelRef = useRef({ x: 0, y: 0, z: 0, zoom: 0 });
  const particlesRef = useRef<AmbientParticle[]>([]);
  const hoveredNodeRef = useRef<string | null>(null);
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

  // Keep a ref to starfieldAnswers so the canvas draw loop can read it
  const starfieldAnswersRef = useRef(starfieldAnswers);
  starfieldAnswersRef.current = starfieldAnswers;

  // ─── Conditional visibility ──────────────────────────────────────────────

  const visibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (!q.conditionalOn) return true;
      const depAnswer = starfieldAnswers[q.conditionalOn.questionId];
      return depAnswer != null && depAnswer !== q.conditionalOn.excludeAnswer;
    });
  }, [questions, starfieldAnswers]);

  const visibleQuestionsRef = useRef(visibleQuestions);
  visibleQuestionsRef.current = visibleQuestions;

  // ─── Canvas resize ──────────────────────────────────────────────────────

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

  // ─── Zoom to node ───────────────────────────────────────────────────────

  const zoomToNode = useCallback((q: StarfieldQuestion) => {
    const camera = cameraRef.current;
    camera.targetX = q.position.x;
    camera.targetY = q.position.y;
    camera.targetZ = q.position.z - 250;
    camera.targetZoom = 3.5;
    setFocusedNode(q.id);
    setHoveredNode(null);
  }, []);

  const zoomOut = useCallback(() => {
    const camera = cameraRef.current;
    camera.targetX = 0;
    camera.targetY = 0;
    camera.targetZ = -400;
    camera.targetZoom = 1;
    setFocusedNode(null);
    setSubNodePositions([]);
  }, []);

  // ─── Handle option select ───────────────────────────────────────────────

  const handleOptionSelect = useCallback(
    (questionId: string, optionId: string) => {
      onAnswer(questionId, optionId);
      // Short delay then zoom out
      setTimeout(() => zoomOut(), 400);
    },
    [onAnswer, zoomOut]
  );

  // ─── Main animation loop ───────────────────────────────────────────────

  useEffect(() => {
    resize();

    const container = containerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    }

    // Generate ambient particles
    const particles: AmbientParticle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 800,
        z: (Math.random() - 0.5) * 400,
        size: 1 + Math.random() * 2,
        baseAlpha: 0.03 + Math.random() * 0.06,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        vz: (Math.random() - 0.5) * 4,
      });
    }
    particlesRef.current = particles;

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
      const centerX = w / 2;
      const centerY = h / 2;
      const mouse = mouseRef.current;
      const camera = cameraRef.current;
      const vel = cameraVelRef.current;
      const qs = visibleQuestionsRef.current;
      const answers = starfieldAnswersRef.current;

      // ── Spring camera toward target ──
      if (!prefersReduced) {
        vel.x += (camera.targetX - camera.x) * CAMERA_SPRING;
        vel.y += (camera.targetY - camera.y) * CAMERA_SPRING;
        vel.z += (camera.targetZ - camera.z) * CAMERA_SPRING;
        vel.zoom += (camera.targetZoom - camera.zoom) * CAMERA_SPRING;

        vel.x *= CAMERA_DAMPING;
        vel.y *= CAMERA_DAMPING;
        vel.z *= CAMERA_DAMPING;
        vel.zoom *= CAMERA_DAMPING;

        camera.x += vel.x;
        camera.y += vel.y;
        camera.z += vel.z;
        camera.zoom += vel.zoom;
      } else {
        camera.x = camera.targetX;
        camera.y = camera.targetY;
        camera.z = camera.targetZ;
        camera.zoom = camera.targetZoom;
      }

      ctx.clearRect(0, 0, w, h);

      // ── Draw ambient particles ──
      for (const p of particles) {
        if (!prefersReduced) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;

          // Wrap
          if (p.x < -400) p.x = 400;
          if (p.x > 400) p.x = -400;
          if (p.y < -400) p.y = 400;
          if (p.y > 400) p.y = -400;
          if (p.z < -200) p.z = 200;
          if (p.z > 200) p.z = -200;
        }

        const proj = project3D(p.x, p.y, p.z, camera, centerX, centerY);
        if (proj.scale <= 0) continue;

        const screenSize = p.size * proj.scale;
        const sx = proj.x;
        const sy = proj.y;

        // Skip if off screen
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

        // Cursor proximity: brighten + shift orange
        let alpha = p.baseAlpha;
        let r = GREY.r,
          g = GREY.g,
          b = GREY.b;

        const mdx = sx - mouse.x;
        const mdy = sy - mouse.y;
        const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mDist < BRIGHTEN_RADIUS) {
          const proximity = 1 - mDist / BRIGHTEN_RADIUS;
          alpha = Math.min(alpha * (1 + proximity * 2), 0.25);
          // Shift toward orange
          r = Math.round(r + (ORANGE.r - r) * proximity * 0.6);
          g = Math.round(g + (ORANGE.g - g) * proximity * 0.6);
          b = Math.round(b + (ORANGE.b - b) * proximity * 0.6);
        }

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(sx - screenSize / 2, sy - screenSize / 2, screenSize, screenSize);
      }

      // ── Draw question nodes ──
      let newHoveredNode: string | null = null;
      const isFocused = focusedNodeRef.current !== null;

      for (const q of qs) {
        const proj = project3D(
          q.position.x,
          q.position.y,
          q.position.z,
          camera,
          centerX,
          centerY
        );
        if (proj.scale <= 0) continue;

        const nodeSize = NODE_RADIUS * proj.scale;
        const sx = proj.x;
        const sy = proj.y;

        // Check hover
        const dx = sx - mouse.x;
        const dy = sy - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isHovered = dist < NODE_HIT_RADIUS * proj.scale && !isFocused;

        if (isHovered) {
          newHoveredNode = q.id;
        }

        // Node color
        const isAnswered = answers[q.id] != null;
        const isFocusedNode = focusedNodeRef.current === q.id;
        let nodeAlpha = 0.6;

        if (isAnswered) {
          // Accent blue for answered
          ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.8)`;
          nodeAlpha = 0.8;
        } else if (isFocusedNode) {
          ctx.fillStyle = `rgba(255, 255, 255, 0.9)`;
          nodeAlpha = 0.9;
        } else if (isHovered) {
          ctx.fillStyle = `rgba(255, 255, 255, 0.7)`;
          nodeAlpha = 0.7;
        } else {
          ctx.fillStyle = `rgba(${GREY.r}, ${GREY.g}, ${GREY.b}, 0.4)`;
          nodeAlpha = 0.4;
        }

        // Glow
        if (isHovered || isFocusedNode || isAnswered) {
          const glowColor = isAnswered
            ? `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${nodeAlpha * 0.3})`
            : `rgba(255, 255, 255, ${nodeAlpha * 0.2})`;
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = isAnswered ? 16 : 12;
        }

        // Draw node as square
        ctx.fillRect(sx - nodeSize / 2, sy - nodeSize / 2, nodeSize, nodeSize);
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

            // Vector line from center to sub-node
            ctx.strokeStyle = isSelected
              ? `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.6)`
              : `rgba(255, 255, 255, 0.15)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(subX, subY);
            ctx.stroke();

            // Sub-node
            if (isSelected) {
              ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.9)`;
              ctx.shadowColor = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.4)`;
              ctx.shadowBlur = 10;
            } else {
              ctx.fillStyle = `rgba(255, 255, 255, 0.5)`;
            }
            ctx.fillRect(subX - subSize / 2, subY - subSize / 2, subSize, subSize);
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

          // Update DOM sub-node positions (throttled via state)
          setSubNodePositions(subPositions);
        }
      }

      // Update hover state
      if (newHoveredNode !== hoveredNodeRef.current) {
        hoveredNodeRef.current = newHoveredNode;
        if (newHoveredNode) {
          const q = qs.find((q) => q.id === newHoveredNode);
          if (q) {
            const proj = project3D(
              q.position.x,
              q.position.y,
              q.position.z,
              camera,
              centerX,
              centerY
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

    // Static frame for reduced motion
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

  // ─── Click handler ────────────────────────────────────────────────────

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

      // If focused on a node, check sub-node clicks (situational only)
      if (focusedNodeRef.current) {
        const q = qs.find((q) => q.id === focusedNodeRef.current);
        if (q) {
          // Only check canvas sub-node clicks for situational type
          if (q.responseType === "situational") {
            const proj = project3D(
              q.position.x,
              q.position.y,
              q.position.z,
              camera,
              centerX,
              centerY
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

          // Click outside sub-nodes / response area? zoom out
          zoomOut();
          return;
        }
      }

      // Check if clicking a node
      for (const q of qs) {
        const proj = project3D(
          q.position.x,
          q.position.y,
          q.position.z,
          camera,
          centerX,
          centerY
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

  // ─── Render ───────────────────────────────────────────────────────────

  const focusedQuestion = visibleQuestions.find((q) => q.id === focusedNode) ?? null;
  const answeredCount = visibleQuestions.filter((q) => starfieldAnswers[q.id] != null).length;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 cursor-crosshair"
      onClick={handleCanvasClick}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />

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
            <div className="px-2 py-1 rounded bg-background-card/90 border border-border backdrop-blur-sm">
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
            <div className="absolute top-[15%] left-1/2 -translate-x-1/2 text-center">
              <h2 className="font-mohave text-display text-text-primary">
                {focusedQuestion.question}
              </h2>
              <p className="font-kosugi text-caption text-text-tertiary mt-1">
                Click an option to answer
              </p>
            </div>

            {/* Situational: sub-node labels (canvas draws the nodes) */}
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
                    onAnswer(focusedQuestion.id, value);
                    setTimeout(() => zoomOut(), 100);
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
                    onAnswer(focusedQuestion.id, optionId);
                    setTimeout(() => zoomOut(), 100);
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress indicator */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
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
        <p className="font-mono text-[10px] text-text-disabled text-center mt-2">
          {answeredCount}/{visibleQuestions.length} answered
          {answeredCount < minRequired && ` (${minRequired - answeredCount} more needed)`}
        </p>
      </div>
    </div>
  );
}

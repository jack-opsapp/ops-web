"use client";

/**
 * SetupStarfield — Interactive Canvas 2D galaxy with question nodes
 *
 * - ~600 ambient stars with randomized sizes, clusters, gentle drift
 * - Cursor repulsion: nearby stars push away
 * - Question nodes: SQUARE, amber glow (unanswered), blue glow (answered)
 * - Particle orbit: stars near hovered node swirl around it
 * - Focus: stars orbit tightly with amber tint
 * - Answer burst: captured stars turn blue, explode outward, dissipate
 * - Clickable progress boxes at bottom
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
import { SituationalResponse } from "./starfield/SituationalResponse";

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
  speedMult: number; // per-star drift speed multiplier (0.3–2.5)
  mass: number; // per-star mass for orbit gravity variance (0.5–2.0)
  // Orbit/burst state
  captured: boolean;
  orbitAngle: number;
  bursting: boolean;
  burstVx: number;
  burstVy: number;
  burstAlpha: number; // 1 = full, fades to 0
  tintAmount: number; // 0 = no tint, 1 = full tint
  tintR: number;
  tintG: number;
  tintB: number;
  orbitStrength: number; // 0 = free, 1 = fully orbiting (smooth ramp)
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 }; // #597794 — answered
const AMBER = { r: 196, g: 168, b: 104 }; // #C4A868 — unanswered
const BLUE_BURST = { r: 120, g: 170, b: 220 }; // burst color
const STAR_COUNT = 1000;
const CLUSTER_COUNT = 4;
const STARS_PER_NODE = 25; // extra stars spawned near each question node
const FOCAL_LENGTH = 600;
const REPULSE_RADIUS = 100;
const REPULSE_STRENGTH = 4;
const NODE_HALF = 5; // half-size of square node
const NODE_HIT_RADIUS = 28;
const CAMERA_LERP = 0.06;
const CAPTURE_RADIUS = 140; // screen-space radius for orbit capture
const ORBIT_RADIUS_HOVER = 80; // orbit distance when hovering
const ORBIT_RADIUS_FOCUS = 40; // tighter orbit when focused
const ORBIT_SPEED = 1.2; // radians per second
const BURST_SPEED = 250; // px/s outward velocity
const BURST_FADE_RATE = 1.5; // alpha fade per second
const AMBIENT_ORBIT_RADIUS = 60; // screen-space capture radius for idle orbit
const AMBIENT_ORBIT_SPEED = 0.3; // slow orbit around unanswered nodes
const AMBIENT_ORBIT_STRENGTH = 0.012; // gentle pull

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
  onFocusChange?: (focused: boolean) => void;
}

export function SetupStarfield({
  questions,
  starfieldAnswers,
  onAnswer,
  minRequired = 4,
  onFocusChange,
}: SetupStarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const cameraRef = useRef<Camera>({
    x: 0,
    y: 0,
    z: -400,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZ: -400,
    targetZoom: 1,
  });
  const starsRef = useRef<Star[]>([]);
  const hoveredNodeRef = useRef<string | null>(null);
  const focusProgressRef = useRef(0);
  const nodeSpreadRef = useRef(1);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;

  // Completion animation (all questions answered → push nodes outward)
  const completionProgressRef = useRef(0);

  // Track which node just got answered for burst effect
  const burstNodeRef = useRef<string | null>(null);
  const burstNodeScreenRef = useRef<{ x: number; y: number } | null>(null);

  // DOM state for overlays
  const [hoveredNode, setHoveredNode] = useState<{
    id: string;
    label: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);

  const focusedNodeRef = useRef<string | null>(null);
  focusedNodeRef.current = focusedNode;

  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;

  useEffect(() => {
    onFocusChangeRef.current?.(focusedNode !== null);
  }, [focusedNode]);

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
    const ns = nodeSpreadRef.current;
    camera.targetX = q.position.x * ns * 0.2;
    camera.targetY = q.position.y * ns * 0.2;
    camera.targetZoom = 1.2;
    nodeFocusTimeRef.current = Date.now();
    const questionIndex = visibleQuestionsRef.current.findIndex(
      (vq) => vq.id === q.id
    );
    const currentAnsweredCount = visibleQuestionsRef.current.filter(
      (vq) => starfieldAnswersRef.current[vq.id] != null
    ).length;
    trackStarfieldNodeFocused(
      q.id,
      questionIndex + 1,
      currentAnsweredCount
    );
    setFocusedNode(q.id);
    setHoveredNode(null);
  }, []);

  const zoomOut = useCallback(() => {
    const camera = cameraRef.current;
    camera.targetX = 0;
    camera.targetY = 0;
    camera.targetZoom = 1;
    setFocusedNode(null);
  }, []);

  // ─── Handle option select ─────────────────────────────────────────────

  const handleOptionSelect = useCallback(
    (questionId: string, optionId: string | number) => {
      const timeOnQuestion = Date.now() - nodeFocusTimeRef.current;
      const questionIndex = visibleQuestionsRef.current.findIndex(
        (q) => q.id === questionId
      );
      const currentAnsweredCount = visibleQuestionsRef.current.filter(
        (q) => starfieldAnswersRef.current[q.id] != null
      ).length;
      trackStarfieldQuestionAnswered(
        questionId,
        optionId,
        questionIndex + 1,
        currentAnsweredCount +
          (starfieldAnswersRef.current[questionId] == null ? 1 : 0),
        timeOnQuestion
      );

      // Trigger burst effect on the focused node
      burstNodeRef.current = questionId;
      // The screen position will be computed in the draw loop

      onAnswer(questionId, optionId);

      // Delay zoom out to let burst animation play
      setTimeout(() => zoomOut(), 700);
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

    // Scale galaxy to viewport — wider on desktop
    const containerW = container?.getBoundingClientRect().width ?? 800;
    const spreadScale = Math.max(1, containerW / 800);

    // Node spread: push question nodes further apart on wider screens
    const nodeSpread = Math.min(1.6, 1 + Math.max(0, containerW - 600) / 2000);
    nodeSpreadRef.current = nodeSpread;

    // Generate cluster centers
    const clusterCenters = Array.from({ length: CLUSTER_COUNT }, () => ({
      x: (Math.random() - 0.5) * 900 * spreadScale,
      y: (Math.random() - 0.5) * 700 * spreadScale,
      z: (Math.random() - 0.5) * 400,
    }));

    // Helper: create a star at given position with optional spread
    function makeStar(bx: number, by: number, bz: number, spread: number): Star {
      const x = bx + (Math.random() - 0.5) * spread;
      const y = by + (Math.random() - 0.5) * spread;
      const z = bz + (Math.random() - 0.5) * spread * 0.3;

      const sizeRoll = Math.random();
      const size =
        sizeRoll < 0.6
          ? 1 + Math.random() * 1.5       // 60%: 1–2.5px (tiny dots)
          : sizeRoll < 0.9
            ? 2.5 + Math.random() * 2      // 30%: 2.5–4.5px (small)
            : 4.5 + Math.random() * 2.5;   // 10%: 4.5–7px (medium accent)

      const speedRoll = Math.random();
      const speedMult = speedRoll < 0.3 ? 0.3 + Math.random() * 0.4
        : speedRoll < 0.8 ? 0.8 + Math.random() * 0.6
        : 1.5 + Math.random() * 1.0;

      return {
        x, y, z, size,
        baseAlpha: 0.12 + Math.random() * 0.25,
        vx: (Math.random() - 0.5) * 3 * speedMult,
        vy: (Math.random() - 0.5) * 3 * speedMult,
        vz: (Math.random() - 0.5) * 1.5 * speedMult,
        phase: Math.random() * Math.PI * 2,
        displaceX: 0,
        displaceY: 0,
        speedMult,
        mass: 0.5 + Math.random() * 1.5,
        captured: false,
        orbitAngle: Math.random() * Math.PI * 2,
        bursting: false,
        burstVx: 0,
        burstVy: 0,
        burstAlpha: 1,
        tintAmount: 0,
        tintR: 220,
        tintG: 220,
        tintB: 230,
        orbitStrength: 0,
      };
    }

    // Generate base stars (mostly ambient, light clustering)
    const stars: Star[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      if (i < STAR_COUNT * 0.15) {
        // 15% loosely clustered — wider spread so they blend in
        const c = clusterCenters[i % CLUSTER_COUNT];
        const spread = 120 + Math.random() * 200;
        stars.push(makeStar(c.x, c.y, c.z, spread));
      } else {
        stars.push(makeStar(
          (Math.random() - 0.5) * 1600 * spreadScale,
          (Math.random() - 0.5) * 1200 * spreadScale,
          (Math.random() - 0.5) * 600,
          0
        ));
      }
    }

    // Extra stars near each question node (denser particle field around nodes)
    const qs = questionsRef.current;
    for (const q of qs) {
      for (let j = 0; j < STARS_PER_NODE; j++) {
        stars.push(makeStar(
          q.position.x * nodeSpread,
          q.position.y * nodeSpread,
          q.position.z,
          120 // spread radius around node
        ));
      }
    }

    starsRef.current = stars;

    // Mouse handlers
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container?.getBoundingClientRect();
      if (!rect) return;
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };
    container?.addEventListener("mousemove", handleMouseMove);
    container?.addEventListener("mouseleave", handleMouseLeave);

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
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

      // ── Completion progress (all questions answered → push nodes) ──
      const allQAnswered = visibleQuestionsRef.current.length > 0 &&
        visibleQuestionsRef.current.every(q => starfieldAnswersRef.current[q.id] != null);
      const completionTarget = allQAnswered ? 1 : 0;
      completionProgressRef.current += (completionTarget - completionProgressRef.current) * 0.015;
      const completionProgress = completionProgressRef.current;

      // ── Focus progress (0 = idle, 1 = fully focused) ──
      const targetFP = focusedNodeRef.current ? 1 : 0;
      focusProgressRef.current +=
        (targetFP - focusProgressRef.current) * CAMERA_LERP;
      const fp = focusProgressRef.current;

      ctx.clearRect(0, 0, w, h);

      // ── Pre-compute node screen positions ──
      const nodeScreenPositions: {
        id: string;
        sx: number;
        sy: number;
        scale: number;
        isAnswered: boolean;
        isFocused: boolean;
        isHovered: boolean;
      }[] = [];

      const isFocused = focusedNodeRef.current !== null;

      const ns = nodeSpreadRef.current;

      for (const q of qs) {
        const oscX = Math.sin(t * 0.3 + q.position.x * 0.02) * 4;
        const oscY = Math.cos(t * 0.25 + q.position.y * 0.02) * 4;

        const proj = project3D(
          q.position.x * ns + oscX,
          q.position.y * ns + oscY,
          q.position.z,
          camera,
          centerX,
          centerY
        );
        if (proj.scale <= 0) continue;

        let sx = proj.x;
        let sy = proj.y;
        const isFocusedNode = focusedNodeRef.current === q.id;
        const isAnswered = answers[q.id] != null;

        // Push non-focused nodes outward during focus
        if (isFocused && !isFocusedNode) {
          const pushAmount = 1 + fp * 0.5;
          sx = centerX + (sx - centerX) * pushAmount;
          sy = centerY + (sy - centerY) * pushAmount;
        }

        // Push all nodes outward when all questions answered
        if (completionProgress > 0.01) {
          const pushAmount = 1 + completionProgress * 2.5;
          sx = centerX + (sx - centerX) * pushAmount;
          sy = centerY + (sy - centerY) * pushAmount;
        }

        // Check hover
        const dx = sx - mouse.x;
        const dy = sy - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isHovered =
          dist < NODE_HIT_RADIUS * proj.scale && !isFocused;

        nodeScreenPositions.push({
          id: q.id,
          sx,
          sy,
          scale: proj.scale,
          isAnswered,
          isFocused: isFocusedNode,
          isHovered,
        });
      }

      // Find the active orbit target (hovered or focused node)
      let orbitTarget: {
        sx: number;
        sy: number;
        radius: number;
        tintR: number;
        tintG: number;
        tintB: number;
      } | null = null;

      const hoveredNodeScreen = nodeScreenPositions.find((n) => n.isHovered);
      const focusedNodeScreen = nodeScreenPositions.find((n) => n.isFocused);

      if (focusedNodeScreen) {
        // Focused: tight orbit, amber tint
        orbitTarget = {
          sx: focusedNodeScreen.sx,
          sy: focusedNodeScreen.sy,
          radius: ORBIT_RADIUS_FOCUS,
          tintR: AMBER.r,
          tintG: AMBER.g,
          tintB: AMBER.b,
        };
      } else if (hoveredNodeScreen) {
        // Hovered: wider orbit, accent tint — accelerated gravity like ForcedChoice
        orbitTarget = {
          sx: hoveredNodeScreen.sx,
          sy: hoveredNodeScreen.sy,
          radius: ORBIT_RADIUS_HOVER,
          tintR: ACCENT.r,
          tintG: ACCENT.g,
          tintB: ACCENT.b,
        };
      }

      // When hovering a node, disable cursor repulsion entirely
      const suppressRepulsor = orbitTarget !== null;

      // Check for burst trigger
      const burstNodeId = burstNodeRef.current;
      if (burstNodeId) {
        const burstScreen = nodeScreenPositions.find(
          (n) => n.id === burstNodeId
        );
        if (burstScreen) {
          burstNodeScreenRef.current = {
            x: burstScreen.sx,
            y: burstScreen.sy,
          };
          // Trigger burst on all captured stars
          for (const star of stars) {
            if (star.captured && !star.bursting) {
              const proj = project3D(
                star.x,
                star.y,
                star.z,
                camera,
                centerX,
                centerY
              );
              const sx = proj.x + star.displaceX;
              const sy = proj.y + star.displaceY;
              const dx = sx - burstScreen.sx;
              const dy = sy - burstScreen.sy;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              star.bursting = true;
              star.burstVx =
                (dx / dist) * BURST_SPEED * (0.5 + Math.random() * 0.5);
              star.burstVy =
                (dy / dist) * BURST_SPEED * (0.5 + Math.random() * 0.5);
              star.burstAlpha = 1;
              star.tintR = BLUE_BURST.r;
              star.tintG = BLUE_BURST.g;
              star.tintB = BLUE_BURST.b;
              star.tintAmount = 1;
            }
          }
        }
        burstNodeRef.current = null;
      }

      // ── Pre-compute likert repulsion zones (when a likert question is focused) ──
      const likertRepulseNodes: { x: number; y: number }[] = [];
      if (focusedNodeRef.current) {
        const focQ = qs.find((q) => q.id === focusedNodeRef.current);
        if (focQ && focQ.responseType === "likert") {
          // Match the LikertResponse layout: container is 580x300, centered
          const cw = 580, ch = 300;
          const cl = centerX - cw / 2;
          const ct = centerY - ch / 2;
          const blY = ct + ch * 0.45;
          const lsX = cl + cw * 0.1;
          const lW = cw * 0.8;
          for (let i = 0; i < 5; i++) {
            likertRepulseNodes.push({ x: lsX + (i / 4) * lW, y: blY });
          }
        }
      }

      // ── Draw ambient stars ──
      for (const star of stars) {
        if (!prefersReduced) {
          // Drift
          star.x += star.vx * dt;
          star.y += star.vy * dt;
          star.z += star.vz * dt;

          // Wrap
          const wrapX = 800 * spreadScale;
          const wrapY = 600 * spreadScale;
          if (star.x < -wrapX) star.x = wrapX;
          if (star.x > wrapX) star.x = -wrapX;
          if (star.y < -wrapY) star.y = wrapY;
          if (star.y > wrapY) star.y = -wrapY;
          if (star.z < -300) star.z = 300;
          if (star.z > 300) star.z = -300;
        }

        const proj = project3D(
          star.x,
          star.y,
          star.z,
          camera,
          centerX,
          centerY
        );
        if (proj.scale <= 0) continue;

        let sx = proj.x + star.displaceX;
        let sy = proj.y + star.displaceY;
        const screenSize = Math.max(star.size * proj.scale, 0.5);

        // Skip off-screen
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;

        // Handle bursting stars
        if (star.bursting) {
          star.displaceX += star.burstVx * dt;
          star.displaceY += star.burstVy * dt;
          star.burstAlpha -= BURST_FADE_RATE * dt;

          if (star.burstAlpha <= 0) {
            // Reset burst state
            star.bursting = false;
            star.captured = false;
            star.burstAlpha = 1;
            star.tintAmount = 0;
            star.displaceX = 0;
            star.displaceY = 0;
          }

          sx = proj.x + star.displaceX;
          sy = proj.y + star.displaceY;

          // Draw bursting star with blue tint
          const alpha = star.baseAlpha * star.burstAlpha;
          const cr = star.tintR;
          const cg = star.tintG;
          const cb = star.tintB;
          ctx.fillStyle = `rgba(${cr | 0}, ${cg | 0}, ${cb | 0}, ${alpha})`;
          ctx.fillRect(
            sx - screenSize / 2,
            sy - screenSize / 2,
            screenSize,
            screenSize
          );
          continue;
        }

        // Orbit logic — smooth acceleration into orbit, smooth release
        if (orbitTarget && !star.bursting) {
          const dx = sx - orbitTarget.sx;
          const dy = sy - orbitTarget.sy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Capture radius scaled by mass (heavier = captured from further)
          const captureR = CAPTURE_RADIUS * (0.8 + star.mass * 0.3);

          if (dist < captureR) {
            // Smoothly ramp orbit strength up (heavier stars accelerate faster)
            // Faster acceleration when hovering (2x), like ForcedChoice gravity
            const isHoverOrbit = !focusedNodeRef.current && hoveredNodeScreen;
            const accelMult = isHoverOrbit ? 2.5 : 1.0;
            const accelRate = (0.8 + star.mass * 0.4) * dt * accelMult;
            star.orbitStrength = Math.min(1, star.orbitStrength + accelRate);
            star.captured = true;

            // Orbit speed ramps with orbitStrength — starts slow, reaches full speed
            const massOrbitSpeed = ORBIT_SPEED * (2.2 - star.mass * 0.6);
            star.orbitAngle += massOrbitSpeed * dt * star.orbitStrength;

            // Orbit radius varies: heavier stars orbit closer
            const massOrbitRadius = orbitTarget.radius * (0.6 + (1 - star.mass / 2) * 0.8);

            // Target orbit position
            const targetOrbitX =
              orbitTarget.sx +
              Math.cos(star.orbitAngle) * massOrbitRadius;
            const targetOrbitY =
              orbitTarget.sy +
              Math.sin(star.orbitAngle) * massOrbitRadius;

            // Pull strength ramps with orbitStrength — gradual pull-in
            const pullStrength = (0.03 + star.mass * 0.03) * star.orbitStrength;
            const targetDx = targetOrbitX - proj.x;
            const targetDy = targetOrbitY - proj.y;
            star.displaceX += (targetDx - star.displaceX) * pullStrength;
            star.displaceY += (targetDy - star.displaceY) * pullStrength;

            // Tint ramps with orbit strength
            star.tintAmount = Math.min(1, star.tintAmount + dt * 2 * star.orbitStrength);
            star.tintR = orbitTarget.tintR;
            star.tintG = orbitTarget.tintG;
            star.tintB = orbitTarget.tintB;
          } else {
            // Outside capture range — smoothly decelerate
            star.orbitStrength = Math.max(0, star.orbitStrength - dt * 1.8);
            if (star.orbitStrength < 0.01) {
              star.captured = false;
              star.orbitStrength = 0;
            }
            star.tintAmount = Math.max(0, star.tintAmount - dt * 2);
          }
        } else if (!star.bursting) {
          // No orbit target — smoothly release (not instant uncapture)
          star.orbitStrength = Math.max(0, star.orbitStrength - dt * 1.2);
          if (star.orbitStrength < 0.01) {
            star.captured = false;
            star.orbitStrength = 0;
          }
          star.tintAmount = Math.max(0, star.tintAmount - dt * 2);
        }

        // Decay displacement — rate depends on orbit strength (orbiting stars hold position)
        if (!star.bursting && !prefersReduced) {
          const decayRate = star.captured ? (0.98 - star.orbitStrength * 0.06) : 0.92;
          if (!star.captured || star.orbitStrength < 0.5) {
            star.displaceX *= decayRate;
            star.displaceY *= decayRate;
          }
        }

        // Ambient orbit — gentle swirl around nearby unanswered nodes (idle state only)
        if (!orbitTarget && !star.bursting && !star.captured && !prefersReduced) {
          for (const ns of nodeScreenPositions) {
            if (ns.isAnswered) continue;
            const adx = sx - ns.sx;
            const ady = sy - ns.sy;
            const aDist = Math.sqrt(adx * adx + ady * ady);
            if (aDist < AMBIENT_ORBIT_RADIUS && aDist > 2) {
              const proximity = 1 - aDist / AMBIENT_ORBIT_RADIUS;
              // Tangential force (perpendicular to radial direction) for orbital motion
              const tx = -ady / aDist;
              const ty = adx / aDist;
              const orbitForce = proximity * AMBIENT_ORBIT_SPEED * star.speedMult;
              star.displaceX += tx * orbitForce;
              star.displaceY += ty * orbitForce;
              // Slight inward pull to keep stars from drifting away
              star.displaceX -= (adx / aDist) * proximity * AMBIENT_ORBIT_STRENGTH;
              star.displaceY -= (ady / aDist) * proximity * AMBIENT_ORBIT_STRENGTH;
              // Subtle amber tint near unanswered nodes
              star.tintAmount = Math.min(star.tintAmount + proximity * dt * 0.5, 0.3);
              star.tintR = AMBER.r;
              star.tintG = AMBER.g;
              star.tintB = AMBER.b;
            }
          }
        }

        // Cursor repulsion — disabled when orbiting or when hovering/focusing a node
        if (star.orbitStrength < 0.1 && !star.bursting && !prefersReduced && !suppressRepulsor) {
          const mdx = sx - mouse.x;
          const mdy = sy - mouse.y;
          const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
          if (mDist < REPULSE_RADIUS && mDist > 1) {
            const force =
              (1 - mDist / REPULSE_RADIUS) * REPULSE_STRENGTH;
            star.displaceX += (mdx / mDist) * force;
            star.displaceY += (mdy / mDist) * force;
          }
        }

        // Likert node repulsion — push particles away from response nodes
        if (likertRepulseNodes.length > 0 && !star.bursting && !prefersReduced) {
          for (const ln of likertRepulseNodes) {
            const ldx = sx - ln.x;
            const ldy = sy - ln.y;
            const lDist = Math.sqrt(ldx * ldx + ldy * ldy);
            if (lDist < 60 && lDist > 1) {
              const force = (1 - lDist / 60) * 5;
              star.displaceX += (ldx / lDist) * force;
              star.displaceY += (ldy / lDist) * force;
            }
          }
        }

        // Recalculate screen position with displacement
        sx = proj.x + star.displaceX;
        sy = proj.y + star.displaceY;

        // Twinkle
        const twinkle = 0.8 + 0.2 * Math.sin(t * 0.5 + star.phase);
        const alpha = star.baseAlpha * twinkle;

        // Color: blend between base white and tint color
        const tA = star.tintAmount;
        const cr = 220 + (star.tintR - 220) * tA;
        const cg = 220 + (star.tintG - 220) * tA;
        const cb = 230 + (star.tintB - 230) * tA;

        ctx.fillStyle = `rgba(${cr | 0}, ${cg | 0}, ${cb | 0}, ${alpha})`;
        ctx.fillRect(
          sx - screenSize / 2,
          sy - screenSize / 2,
          screenSize,
          screenSize
        );
      }

      // ── Draw question nodes (squares with glow) ──
      let newHoveredNode: string | null = null;

      for (const ns of nodeScreenPositions) {
        const q = qs.find((vq) => vq.id === ns.id);
        if (!q) continue;

        const { sx, sy, scale, isAnswered, isFocused: isFocusedNode, isHovered } = ns;
        if (isHovered) newHoveredNode = q.id;

        // Determine color and alpha
        let nodeAlpha: number;
        let fillR: number, fillG: number, fillB: number;
        let glowBlur: number;

        if (isFocused && !isFocusedNode) {
          // Faded while another node is focused
          nodeAlpha = 0.12;
          if (isAnswered) {
            fillR = ACCENT.r;
            fillG = ACCENT.g;
            fillB = ACCENT.b;
          } else {
            fillR = AMBER.r;
            fillG = AMBER.g;
            fillB = AMBER.b;
          }
          glowBlur = 0;
        } else if (isAnswered) {
          // Blue accent glow
          nodeAlpha = 0.9;
          fillR = ACCENT.r;
          fillG = ACCENT.g;
          fillB = ACCENT.b;
          glowBlur = 18;
        } else if (isFocusedNode) {
          // Focused node — visible but NO glow (question is open)
          nodeAlpha = 0.85;
          fillR = AMBER.r;
          fillG = AMBER.g;
          fillB = AMBER.b;
          glowBlur = 0;
        } else if (isHovered) {
          // Brighter amber on hover
          nodeAlpha = 0.9;
          fillR = AMBER.r;
          fillG = AMBER.g;
          fillB = AMBER.b;
          glowBlur = 22;
        } else {
          // Default amber glow — pulsing (only unanswered)
          const pulse =
            0.5 + 0.15 * Math.sin(t * 0.8 + q.position.x * 0.01);
          nodeAlpha = pulse;
          fillR = AMBER.r;
          fillG = AMBER.g;
          fillB = AMBER.b;
          glowBlur = 14;
        }

        // Radial gradient glow behind unanswered nodes
        if (!isAnswered && glowBlur > 0) {
          const glowRadius = glowBlur * 2.5;
          const glowAlpha = nodeAlpha * 0.3;
          const grad = ctx.createRadialGradient(
            sx,
            sy,
            0,
            sx,
            sy,
            glowRadius
          );
          grad.addColorStop(
            0,
            `rgba(${fillR}, ${fillG}, ${fillB}, ${glowAlpha})`
          );
          grad.addColorStop(
            0.5,
            `rgba(${fillR}, ${fillG}, ${fillB}, ${glowAlpha * 0.3})`
          );
          grad.addColorStop(
            1,
            `rgba(${fillR}, ${fillG}, ${fillB}, 0)`
          );
          ctx.fillStyle = grad;
          ctx.fillRect(
            sx - glowRadius,
            sy - glowRadius,
            glowRadius * 2,
            glowRadius * 2
          );
        }

        // Draw shadow glow
        if (glowBlur > 0) {
          ctx.shadowColor = `rgba(${fillR}, ${fillG}, ${fillB}, ${nodeAlpha * 0.5})`;
          ctx.shadowBlur = glowBlur;
        }

        // Node size — slightly larger when hovered or focused
        const sizeMultiplier = isFocusedNode ? 1.3 : isHovered ? 1.2 : 1;
        const nodeSize = NODE_HALF * scale * sizeMultiplier;

        // Draw as SQUARE
        ctx.fillStyle = `rgba(${fillR}, ${fillG}, ${fillB}, ${nodeAlpha})`;
        ctx.fillRect(sx - nodeSize, sy - nodeSize, nodeSize * 2, nodeSize * 2);

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }

      // Update hover state
      if (newHoveredNode !== hoveredNodeRef.current) {
        hoveredNodeRef.current = newHoveredNode;
        if (newHoveredNode) {
          const ns = nodeScreenPositions.find(
            (n) => n.id === newHoveredNode
          );
          const q = qs.find((vq) => vq.id === newHoveredNode);
          if (ns && q) {
            setHoveredNode({
              id: q.id,
              label: q.label,
              screenX: ns.sx,
              screenY: ns.sy,
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

      // If focused, zoom out on background click
      if (focusedNodeRef.current) {
        zoomOut();
        return;
      }

      // Check if clicking a question node
      const clickNs = nodeSpreadRef.current;
      for (const q of qs) {
        const oscX = Math.sin(t * 0.3 + q.position.x * 0.02) * 4;
        const oscY = Math.cos(t * 0.25 + q.position.y * 0.02) * 4;
        const proj = project3D(
          q.position.x * clickNs + oscX,
          q.position.y * clickNs + oscY,
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
    [zoomToNode, zoomOut]
  );

  // ─── Render ────────────────────────────────────────────────────────────

  const focusedQuestion =
    visibleQuestions.find((q) => q.id === focusedNode) ?? null;
  const answeredCount = visibleQuestions.filter(
    (q) => starfieldAnswers[q.id] != null
  ).length;
  const allQuestionsAnswered =
    visibleQuestions.length > 0 && answeredCount === visibleQuestions.length;

  // Track when minimum required answers are first reached
  const [showUnlocked, setShowUnlocked] = useState(false);
  const hasShownUnlockedRef = useRef(false);

  useEffect(() => {
    if (
      answeredCount >= minRequired &&
      !hasShownUnlockedRef.current
    ) {
      hasShownUnlockedRef.current = true;
      setShowUnlocked(true);
      const timer = setTimeout(() => setShowUnlocked(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [answeredCount, minRequired]);

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
                  : q.options.find((o) => o.id === answer)?.label ??
                    String(answer)
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

      {/* Instruction — visible when no node is focused and not all answered */}
      <AnimatePresence>
        {!focusedNode && !allQuestionsAnswered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute top-[14%] left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none"
          >
            <p className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.2em] max-w-[400px] leading-relaxed">
              Answer questions so we can tailor OPS to your operation
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
            <div className="px-2.5 py-1.5 rounded-sm bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)]">
              <span className="font-kosugi text-body text-text-primary whitespace-nowrap uppercase tracking-wider">
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

            {/* Situational response */}
            {focusedQuestion.responseType === "situational" && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                style={{ width: 550, height: 480 }}
                onClick={(e) => e.stopPropagation()}
              >
                <SituationalResponse
                  options={focusedQuestion.options}
                  value={
                    typeof starfieldAnswers[focusedQuestion.id] === "string"
                      ? (starfieldAnswers[focusedQuestion.id] as string)
                      : null
                  }
                  onSelect={(optionId) => {
                    handleOptionSelect(focusedQuestion.id, optionId);
                  }}
                />
              </div>
            )}

            {/* Likert response */}
            {focusedQuestion.responseType === "likert" && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                style={{ width: 580, height: 300 }}
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
                    handleOptionSelect(focusedQuestion.id, value);
                  }}
                />
              </div>
            )}

            {/* Forced choice response */}
            {focusedQuestion.responseType === "forced_choice" && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                style={{ width: 580, height: 420 }}
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
                    handleOptionSelect(focusedQuestion.id, optionId);
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dashboard unlocked notification — centered in viewport */}
      <AnimatePresence>
        {showUnlocked && !focusedNode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          >
            <div className="px-6 py-4 rounded-sm bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(89,119,148,0.3)] text-center">
              <p className="font-mohave text-body text-text-primary">
                Dashboard unlocked
              </p>
              <p className="font-kosugi text-[11px] text-text-tertiary mt-0.5">
                Keep going or hit Launch to see your command center
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress indicator — clickable boxes */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-auto"
        aria-hidden="true"
      >
        <div className="flex items-center gap-2">
          {visibleQuestions.map((q) => (
            <button
              key={q.id}
              type="button"
              className={`w-4 h-[2px] rounded-full transition-colors duration-300 cursor-pointer hover:scale-y-[2] ${
                starfieldAnswers[q.id] != null
                  ? "bg-ops-accent shadow-[0_0_6px_rgba(65,115,148,0.4)]"
                  : "bg-white/10 hover:bg-white/25"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                zoomToNode(q);
              }}
              aria-label={`Question: ${q.label}`}
            />
          ))}
        </div>
        <p className="font-kosugi text-[10px] text-text-disabled text-center mt-2">
          {answeredCount}/{visibleQuestions.length} answered
          {answeredCount < minRequired &&
            ` · ${minRequired - answeredCount} more needed`}
        </p>
      </div>
    </div>
  );
}

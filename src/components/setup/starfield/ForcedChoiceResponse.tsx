/**
 * ForcedChoiceResponse — Canvas particle field with two nodes
 *
 * Exact animation from ops-site ForcedChoiceFork.
 * Particles float in ambient state. Hovering left/right gravitates particles
 * toward that side. Selection triggers a horizontal stream with funnel effect.
 *
 * Pure Canvas 2D API — no animation libraries.
 */

'use client';

import { useRef, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ForcedChoiceResponseProps {
  options: { id: string; label: string }[];
  value: string | null;
  onSelect: (id: string) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseAlpha: number;
  phase: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PARTICLE_COUNT = 80;
const HIT_RADIUS = 60;
const SELECT_DELAY_MS = 500;

const LEFT_NODE = { nx: 0.25, ny: 0.45 };
const RIGHT_NODE = { nx: 0.75, ny: 0.45 };

const NEUTRAL = { r: 160, g: 160, b: 160 };
const BLUE    = { r: 89,  g: 140, b: 200 };
const ORANGE  = { r: 210, g: 140, b: 60  };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateParticles(): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: -0.5 + Math.random() * 2.0,
      y: -0.5 + Math.random() * 2.0,
      vx: (Math.random() - 0.5) * 0.00005,
      vy: (Math.random() - 0.5) * 0.00005,
      size: 2 + Math.random() * 3.5,
      baseAlpha: 0.15 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return particles;
}

/** Alpha multiplier: 1.0 in center, fades to 0 at boundary edges */
function edgeTaper(x: number, y: number): number {
  const EDGE = 0.5; // taper zone width (matches expanded boundary)
  let taper = 1;
  if (x < 0)       taper = Math.min(taper, 1 - Math.min(1, -x / EDGE));
  if (x > 1)       taper = Math.min(taper, 1 - Math.min(1, (x - 1) / EDGE));
  if (y < 0)       taper = Math.min(taper, 1 - Math.min(1, -y / EDGE));
  if (y > 1)       taper = Math.min(taper, 1 - Math.min(1, (y - 1) / EDGE));
  return taper * taper; // quadratic falloff for smoother taper
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
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

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ForcedChoiceResponse({
  options, value, onSelect,
}: ForcedChoiceResponseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const hoveredRef = useRef<number>(-1);
  const selectedRef = useRef<number>(-1);
  const onSelectRef = useRef(onSelect);
  const optionsRef = useRef(options);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeRef = useRef(0);
  const particlesRef = useRef<Particle[] | null>(null);
  const selProgressRef = useRef(0);

  onSelectRef.current = onSelect;
  optionsRef.current = options;

  if (value !== null && selectedRef.current < 0) {
    const savedIdx = options.findIndex(o => o.id === value);
    if (savedIdx >= 0) { selectedRef.current = savedIdx; selProgressRef.current = 1; }
  }
  if (!particlesRef.current) particlesRef.current = generateParticles();

  const resize = useCallback(() => {
    const canvas = canvasRef.current; const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    resize();
    const container = containerRef.current!;
    let observer: ResizeObserver | null = null;
    if (container) { observer = new ResizeObserver(() => resize()); observer.observe(container); }
    const mousePos = { x: -9999, y: -9999 };

    const selectNode = (mx: number, my: number) => {
      const canvas = canvasRef.current; if (!canvas) return;
      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const nodes = [{ x: LEFT_NODE.nx * w, y: LEFT_NODE.ny * h }, { x: RIGHT_NODE.nx * w, y: RIGHT_NODE.ny * h }];
      let closest = -1, closestDist = HIT_RADIUS;
      for (let i = 0; i < nodes.length; i++) {
        const dx = mx - nodes[i].x, dy = my - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      }
      if (closest >= 0 && closest < optionsRef.current.length) {
        if (selectedRef.current === closest) {
          if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
          selectTimerRef.current = setTimeout(() => {
            onSelectRef.current(optionsRef.current[closest].id);
          }, SELECT_DELAY_MS);
          return;
        }
        selectedRef.current = closest; selProgressRef.current = 0;
        if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
        selectTimerRef.current = setTimeout(() => {
          onSelectRef.current(optionsRef.current[closest].id);
        }, SELECT_DELAY_MS);
      }
    };

    const handleMouseMove = (e: MouseEvent) => { const rect = container.getBoundingClientRect(); mousePos.x = e.clientX - rect.left; mousePos.y = e.clientY - rect.top; };
    const handleClick = (e: MouseEvent) => { const rect = container.getBoundingClientRect(); selectNode(e.clientX - rect.left, e.clientY - rect.top); };
    const handleMouseLeave = () => { mousePos.x = -9999; mousePos.y = -9999; };
    const handleTouchEnd = (e: TouchEvent) => { if (e.changedTouches.length === 0) return; const t = e.changedTouches[0]; const rect = container.getBoundingClientRect(); selectNode(t.clientX - rect.left, t.clientY - rect.top); };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('click', handleClick);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('touchend', handleTouchEnd);

    const particles = particlesRef.current!;
    let prevTimestamp: number | null = null;

    function draw(timestamp: number) {
      if (prevTimestamp === null) prevTimestamp = timestamp;
      const dt = (timestamp - prevTimestamp) / 1000;
      prevTimestamp = timestamp;
      timeRef.current += dt;
      const canvas = canvasRef.current;
      if (!canvas) { animRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { animRef.current = requestAnimationFrame(draw); return; }
      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      const time = timeRef.current; const selected = selectedRef.current;
      ctx.clearRect(0, 0, w, h);
      const leftX = LEFT_NODE.nx * w, leftY = LEFT_NODE.ny * h;
      const rightX = RIGHT_NODE.nx * w, rightY = RIGHT_NODE.ny * h;

      // Hover detection
      let hoverIdx = -1;
      if (mousePos.x > -9000) {
        const nodes = [{ x: leftX, y: leftY }, { x: rightX, y: rightY }];
        let closestDist = HIT_RADIUS;
        for (let i = 0; i < nodes.length; i++) {
          const dx = mousePos.x - nodes[i].x, dy = mousePos.y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) { closestDist = dist; hoverIdx = i; }
        }
      }
      hoveredRef.current = hoverIdx;
      container.style.cursor = hoverIdx >= 0 ? 'pointer' : 'default';

      if (selected >= 0 && selProgressRef.current < 1) selProgressRef.current = Math.min(1, selProgressRef.current + dt * 1.8);
      const selProgress = selProgressRef.current;
      const flowDir = selected === 0 ? -1 : 1;
      const selNode = selected === 0 ? LEFT_NODE : RIGHT_NODE;
      const selColor = selected === 0 ? BLUE : ORANGE;
      const hoveringUnselected = selected >= 0 && hoverIdx >= 0 && hoverIdx !== selected;
      const flowSpeedMult = hoveringUnselected ? 0.2 : 1.0;

      // Update + draw particles
      for (const p of particles) {
        if (selected >= 0) {
          const baseFlowSpeed = 0.002 * (0.3 + selProgress * 0.7) * flowSpeedMult;
          const flowVx = flowDir * baseFlowSpeed;
          const distToNode = flowDir < 0 ? (selNode.nx - p.x) : (p.x - selNode.nx);
          const approachT = Math.max(0, Math.min(1, (distToNode + 0.5) / 0.5));
          const funnelStrength = (0.0002 + approachT * 0.003) * selProgress;
          p.vy += (selNode.ny - p.y) * funnelStrength; p.vy *= 0.92;
          p.vx += (flowVx * (0.4 + approachT * 0.6) - p.vx) * (0.03 + selProgress * 0.06);
          if (distToNode < -0.1) { p.vy += Math.sin(time * 1.5 + p.phase) * 0.0002 * (1 - approachT); p.vx += Math.cos(time * 0.8 + p.phase * 2) * 0.00005 * (1 - approachT); }
          else { p.vy += Math.sin(time * 2 + p.phase) * 0.00003; }
          p.x += p.vx; p.y += p.vy;
          if (flowDir < 0 && p.x < -0.5) { p.x = 1.2 + Math.random() * 0.3; p.y = selNode.ny + (Math.random() - 0.5) * 1.0; p.vx = flowDir * baseFlowSpeed * 0.3; p.vy = (Math.random() - 0.5) * 0.0003; }
          else if (flowDir > 0 && p.x > 1.5) { p.x = -0.5 + Math.random() * 0.3; p.y = selNode.ny + (Math.random() - 0.5) * 1.0; p.vx = flowDir * baseFlowSpeed * 0.3; p.vy = (Math.random() - 0.5) * 0.0003; }
          if (p.y < -0.5) p.y = 1.5; if (p.y > 1.5) p.y = -0.5;
        } else if (hoverIdx >= 0) {
          const hovNode = hoverIdx === 0 ? LEFT_NODE : RIGHT_NODE;
          const dx = hovNode.nx - p.x, dy = hovNode.ny - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.01) { p.vx += (dx / dist) * 0.00015; p.vy += (dy / dist) * 0.00015; p.vx += (-dy / dist) * 0.00008; p.vy += (dx / dist) * 0.00008; }
          p.vx += Math.sin(time * 0.15 + p.phase) * 0.00001; p.vy += Math.cos(time * 0.1 + p.phase * 1.3) * 0.00001;
          p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy;
          if (p.x < -0.5) p.x = 1.5; if (p.x > 1.5) p.x = -0.5; if (p.y < -0.5) p.y = 1.5; if (p.y > 1.5) p.y = -0.5;
        } else {
          p.vx += Math.sin(time * 0.15 + p.phase) * 0.00003; p.vy += Math.cos(time * 0.1 + p.phase * 1.3) * 0.00003;
          p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx; p.y += p.vy;
          if (p.x < -0.5) p.x = 1.5; if (p.x > 1.5) p.x = -0.5; if (p.y < -0.5) p.y = 1.5; if (p.y > 1.5) p.y = -0.5;
        }

        // Color + alpha
        const px = p.x * w, py = p.y * h;
        let cr: number, cg: number, cb: number, alpha = p.baseAlpha;
        if (selected >= 0) {
          const passedNode = flowDir < 0 ? (selNode.nx - p.x) : (p.x - selNode.nx);
          const dNode = Math.sqrt((p.x - selNode.nx) ** 2 + (p.y - selNode.ny) ** 2);
          const proximity = Math.max(0, 1 - dNode / 0.25);
          let colorT = passedNode > 0 ? Math.min(1, 0.6 + passedNode * 2) : Math.max(0, 1 + passedNode * 3) * 0.5;
          colorT *= selProgress;
          const c = lerpColor(NEUTRAL, selColor, colorT); cr = c.r; cg = c.g; cb = c.b;
          alpha = Math.max(p.baseAlpha * 0.5, p.baseAlpha * 0.7 + proximity * selProgress * 0.5);
        } else if (hoverIdx >= 0) {
          const hovNode = hoverIdx === 0 ? LEFT_NODE : RIGHT_NODE;
          const dHov = Math.sqrt((p.x - hovNode.nx) ** 2 + (p.y - hovNode.ny) ** 2);
          const proximity = Math.max(0, 1 - dHov / 0.45);
          const c = lerpColor(NEUTRAL, hoverIdx === 0 ? BLUE : ORANGE, proximity * 0.8); cr = c.r; cg = c.g; cb = c.b;
          alpha = p.baseAlpha + proximity * 0.2;
        } else { cr = NEUTRAL.r; cg = NEUTRAL.g; cb = NEUTRAL.b; alpha = p.baseAlpha + Math.sin(time * 0.5 + p.phase) * 0.03; }
        // Apply edge taper — particles fade out at expanded boundary edges
        alpha *= edgeTaper(p.x, p.y);
        ctx.fillStyle = `rgba(${cr | 0}, ${cg | 0}, ${cb | 0}, ${Math.max(0, Math.min(1, alpha))})`;
        ctx.fillRect(px - p.size / 2, py - p.size / 2, p.size, p.size);
      }

      // Draw nodes
      for (let i = 0; i < 2; i++) {
        const nodeX = i === 0 ? leftX : rightX, nodeY = i === 0 ? leftY : rightY;
        const isHovered = hoverIdx === i, isSelected = selected === i, hasSelection = selected >= 0;
        const nodeColor = i === 0 ? BLUE : ORANGE;
        let nodeSize: number, nodeAlpha: number;
        if (isSelected) { nodeSize = 12; nodeAlpha = 0.95; } else if (isHovered && hasSelection) { nodeSize = 9; nodeAlpha = 0.45; }
        else if (isHovered) { nodeSize = 10; nodeAlpha = 0.65; } else if (hasSelection) { nodeSize = 6; nodeAlpha = 0.15; }
        else { nodeSize = 7; nodeAlpha = 0.4; }
        if (isSelected) { ctx.shadowColor = `rgba(${nodeColor.r}, ${nodeColor.g}, ${nodeColor.b}, 0.6)`; ctx.shadowBlur = 18; }
        const drawColor = (isSelected || isHovered) ? nodeColor : NEUTRAL;
        ctx.fillStyle = `rgba(${drawColor.r}, ${drawColor.g}, ${drawColor.b}, ${nodeAlpha})`;
        ctx.fillRect(nodeX - nodeSize / 2, nodeY - nodeSize / 2, nodeSize, nodeSize);
        if (isSelected) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }
      }

      // Draw labels
      ctx.textBaseline = 'top';
      for (let i = 0; i < Math.min(2, optionsRef.current.length); i++) {
        const nodeX = i === 0 ? leftX : rightX, nodeY = i === 0 ? leftY : rightY;
        const isHovered = hoverIdx === i, isSelected = selected === i, hasSelection = selected >= 0;
        let labelAlpha: number;
        if (isSelected) labelAlpha = 0.95; else if (isHovered && hasSelection) labelAlpha = 0.75;
        else if (isHovered) labelAlpha = 0.90; else if (hasSelection) labelAlpha = 0.30; else labelAlpha = 0.65;
        ctx.font = '400 18px "Kosugi", sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha})`;
        const lines = wrapText(ctx, optionsRef.current[i].label.toUpperCase(), w * 0.30);
        for (let l = 0; l < lines.length; l++) ctx.fillText(lines[l], nodeX, nodeY + 22 + l * 22);
      }

      animRef.current = requestAnimationFrame(draw);
    }
    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      if (observer) observer.disconnect();
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('click', handleClick);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('touchend', handleTouchEnd);
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    };
  }, [resize]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}

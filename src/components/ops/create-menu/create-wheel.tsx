"use client";

/**
 * CreateWheel — the Create surface (WEB OVERHAUL P4-5).
 *
 * Replaces the old `// CREATE` popover card. A full-viewport overlay: the
 * actions float as an iOS-style drum picker, vertically centered over a
 * full-height frosted wash in the app's own background colour (no card, no
 * border). The centre three rows sit expanded on a cosine curve and the rest
 * fall off in scale + opacity; scroll the wheel, or press an action's keycap
 * (single letter, live only while the wheel is open, so no global collision) to
 * scroll it to centre, flash a press state and fire. `Enter` fires the centred
 * row, `Escape` / backdrop-click closes.
 *
 * Presentational shell only — open/close, the setup gate and dispatch live in
 * CreateCluster; this calls `onRun` / `onClose` up. The per-row drum transform
 * is imperative (scroll distance → transform) for 60fps; the overlay's
 * enter/exit fade is Framer Motion. Both honour reduced motion.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import type { FABAction } from "@/lib/constants/fab-actions";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface CreateWheelProps {
  actions: FABAction[];
  /** `quick-actions` dictionary accessor. */
  t: (key: string) => string;
  onRun: (action: FABAction) => void;
  onClose: () => void;
  reducedMotion: boolean;
}

// Drum falloff reach, in row-pitches from centre. Beyond this a row sits at the
// minimum scale/opacity. ~3.4 keeps the centre three near full size.
const REACH = 3.4;

export function CreateWheel({
  actions,
  t,
  onRun,
  onClose,
  reducedMotion,
}: CreateWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pitchRef = useRef(56);
  const rafRef = useRef(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const [pressId, setPressId] = useState<string | null>(null);

  // Distance-from-centre → scale + opacity on a cosine curve (flat-topped via
  // the 0.55 power, so the centre three hold their size before the falloff).
  const curve = useCallback(() => {
    const wheel = wheelRef.current;
    if (!wheel) return;
    const mid = wheel.scrollTop + wheel.clientHeight / 2;
    const pitch = pitchRef.current || 56;
    let best = Infinity;
    let bestIdx = 0;
    rowRefs.current.forEach((row, i) => {
      if (!row) return;
      const rc = row.offsetTop + row.offsetHeight / 2;
      const d = Math.abs(rc - mid);
      const u = Math.min(d / pitch / REACH, 1);
      const w = Math.pow(Math.cos((u * Math.PI) / 2), 0.55);
      row.style.transform = `translateX(${(6 * (1 - w)).toFixed(1)}px) scale(${(
        0.82 +
        0.34 * w
      ).toFixed(3)})`;
      row.style.opacity = (0.34 + 0.66 * w).toFixed(3);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    });
    setFocusIdx(bestIdx);
  }, []);

  // Pad top/bottom so the first and last rows can reach the centre line; derive
  // the true pitch from the first two rows; centre the first row on open.
  useLayoutEffect(() => {
    const wheel = wheelRef.current;
    const first = rowRefs.current[0];
    if (!wheel || !first) return;
    const second = rowRefs.current[1];
    if (second) pitchRef.current = second.offsetTop - first.offsetTop;
    const pad = wheel.clientHeight / 2 - first.offsetHeight / 2;
    wheel.style.paddingTop = `${pad}px`;
    wheel.style.paddingBottom = `${pad}px`;
    wheel.scrollTop = 0;
    curve();
  }, [curve, actions.length]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      curve();
    });
  }, [curve]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const fire = useCallback(
    (action: FABAction, idx: number) => {
      const wheel = wheelRef.current;
      const row = rowRefs.current[idx];
      if (wheel && row && typeof wheel.scrollTo === "function") {
        const target =
          row.offsetTop + row.offsetHeight / 2 - wheel.clientHeight / 2;
        wheel.scrollTo({ top: target, behavior: reducedMotion ? "auto" : "smooth" });
      }
      setPressId(action.id);
      // Let the press state read before the surface tears down.
      window.setTimeout(() => onRun(action), reducedMotion ? 110 : 300);
    },
    [onRun, reducedMotion],
  );

  // Keys are bound only while the wheel is mounted (open), so single letters
  // never shadow app-wide shortcuts. Enter fires the centred row.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        const action = actions[focusIdx];
        if (action) {
          e.preventDefault();
          fire(action, focusIdx);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      const idx = actions.findIndex((a) => a.hotkey === k);
      if (idx >= 0) {
        e.preventDefault();
        fire(actions[idx], idx);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [actions, focusIdx, fire, onClose]);

  return (
    <motion.div
      data-bug-report-ignore="true"
      className="fixed inset-0 z-[1555]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.15 : 0.3, ease: EASE_SMOOTH }}
    >
      {/* Outside-click backdrop */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* Full-height frosted wash in the app background colour, ~2/3 wide,
          fading off only on the left so it dims the content behind the wheel. */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0"
        style={{
          width: "min(540px, 66vw)",
          background:
            "linear-gradient(270deg, rgba(18,18,20,0.96) 0%, rgba(18,18,20,0.82) 24%, rgba(17,17,19,0.52) 50%, rgba(16,16,18,0.2) 74%, rgba(8,8,10,0) 100%)",
          backdropFilter: "blur(13px) saturate(1.1)",
          WebkitBackdropFilter: "blur(13px) saturate(1.1)",
          WebkitMaskImage: "linear-gradient(270deg, #000 62%, transparent 99%)",
          maskImage: "linear-gradient(270deg, #000 62%, transparent 99%)",
        }}
      />

      <div className="pointer-events-none absolute right-[34px] top-[30px] font-mono text-[10px] uppercase tracking-[0.24em] text-text-3">
        <span aria-hidden className="text-text-mute">
          {"// "}
        </span>
        {t("menu.title")}
      </div>

      {/* The drum */}
      <div
        ref={wheelRef}
        onScroll={onScroll}
        role="menu"
        aria-label={t("menu.title")}
        className="scrollbar-hide absolute inset-y-0 right-[54px] w-[330px] overflow-y-auto"
        style={{ paddingLeft: 60, paddingRight: 16, scrollSnapType: "y proximity" }}
      >
        {actions.map((action, i) => {
          const Icon = action.icon;
          const isFocus = i === focusIdx;
          const isPress = pressId === action.id;
          return (
            <button
              key={action.id}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => fire(action, i)}
              style={{
                scrollSnapAlign: "center",
                transformOrigin: "100% 50%",
                willChange: "transform, opacity",
              }}
              className={`my-2 flex h-[44px] w-full cursor-pointer items-center gap-4 rounded-lg px-3.5 outline-none transition-colors duration-150 ${
                isPress ? "bg-white/10" : "hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="h-[22px] w-[22px] shrink-0 text-text-2" />
              <span className="whitespace-nowrap font-cakemono text-[15px] font-light uppercase tracking-[0.1em] text-text">
                {t(action.labelKey)}
              </span>
              <span aria-hidden className="ml-auto shrink-0 pl-4">
                <kbd
                  className={`inline-flex h-[21px] min-w-[21px] items-center justify-center rounded-chip border px-[5px] font-mono text-[11px] transition-all duration-150 ${
                    isPress
                      ? "translate-y-px border-white/60 bg-white/20 text-white"
                      : isFocus
                        ? "border-white/40 bg-white/[0.08] text-text"
                        : "border-white/[0.14] bg-white/[0.03] text-text-3"
                  }`}
                >
                  {action.hotkey}
                </kbd>
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

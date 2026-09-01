"use client";

/**
 * Bug-report element picker overlay (bug 1f2bf7e9).
 *
 * The operator is mid-report and already annoyed. This layer lets them point
 * at the thing that is wrong without losing a word of what they typed — the
 * drawer stays mounted behind it, hidden and inert.
 *
 * It reads as a targeting layer over the operator's own app, not a modal that
 * took the app away: the canvas dims, the hovered control keeps the exact
 * hover fill it would have had, and a hairline reticle names it back in the
 * app's own micro-label voice (`button · Save`).
 *
 * ── Design tokens ────────────────────────────────────────────────────────
 * Everything traces to a token except two values that ARE this component's
 * tokens, registered here because no global equivalent exists:
 *   PICKER_WASH   rgba(0,0,0,0.35)  — painted dim. NOT backdrop-filter: a
 *                                     full-viewport filtered layer flickers
 *                                     the dashboard (known ops-web defect).
 *   Highlight fill                  — `bg-surface-hover`, the global
 *                                     rgba(255,255,255,0.05) interaction
 *                                     token, so the reticled element looks
 *                                     hovered rather than selected.
 * Reticle outline `var(--text-2)` · flash `var(--ops-accent)` (the single
 * accent element on screen, and only at the instant of commitment) ·
 * pills `bg-glass-dense` + `border-line` + `rounded-chip` + mono 10 upper.
 *
 * ── Motion ───────────────────────────────────────────────────────────────
 * Beat: discovery (the reticle rewards exploration instantly), resolving to
 * commitment (the accent flash is the decision landing). One curve
 * (EASE_SMOOTH), no spring. Overlay fades 150ms. The reticle is driven by
 * requestAnimationFrame — never a timer — and moves on compositor-only
 * transform/size with a 120ms transition. `prefers-reduced-motion` takes
 * every duration to zero.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  buildElementReference,
  describeElement,
  isPickable,
  pickFromPoint,
  resolvePickTarget,
} from "@/lib/utils/element-reference";
import type { ElementReference } from "@/lib/types/bug-report-element";

// ─── Layer ─────────────────────────────────────────────────────────────────

/**
 * Picker layer of the OPS z-index scale — above modals (3000) and the
 * full-screen map controls (5000), below the emergency layer (9000).
 * See `CLAUDE.md` § Z-Index Scale and `ops-software-bible/05_DESIGN_SYSTEM.md` § 15.
 */
export const Z_PICKER = 8000;

// ─── Motion + surface constants ────────────────────────────────────────────

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Overlay fade, seconds — matches the drawer's entry beat. */
const OVERLAY_FADE_S = 0.15;
/** Reticle travel between elements, ms. */
const RETICLE_MS = 120;
/** Accent confirmation flash, ms. */
const FLASH_MS = 150;
/** Painted dim over the app. See the token note above. */
const PICKER_WASH = "rgba(0, 0, 0, 0.35)";
/** Reticle label height + gap, used to decide whether the pill flips below. */
const LABEL_OFFSET = 22;
/** Distance from the viewport edge for the hint rail. */
const HINT_INSET = 16;

const PILL =
  "px-2 py-1 rounded-chip border border-line bg-glass-dense " +
  "font-mono text-[10px] uppercase tracking-wider text-text-2 whitespace-nowrap text-left";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ElementPickResult {
  element: HTMLElement;
  reference: ElementReference;
  crop: Blob | null;
}

export interface BugReportElementPickerProps {
  open: boolean;
  onSelect: (result: ElementPickResult) => void;
  onCancel: () => void;
  /** Injected so the drawer owns the capture options; resolves null on failure. */
  captureCrop: (el: HTMLElement) => Promise<Blob | null>;
}

interface HighlightState {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  role: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function BugReportElementPicker({
  open,
  onSelect,
  onCancel,
  captureCrop,
}: BugReportElementPickerProps) {
  const { t } = useDictionary("common");
  const reducedMotion = useReducedMotion();

  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState<HighlightState | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [flashing, setFlashing] = useState(false);

  // The element currently under the reticle. A ref (not state) because the
  // rAF loop reads it every frame and Enter/touchend select off it.
  const targetRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  /** True from the moment of selection until the crop resolves — input is inert. */
  const busyRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);

  // ── Reticle placement ──
  const applyTarget = useCallback((el: HTMLElement | null) => {
    if (!el) {
      targetRef.current = null;
      setHighlight((prev) => (prev === null ? prev : null));
      return;
    }

    targetRef.current = el;
    const r = el.getBoundingClientRect();
    const described = describeElement(el);
    const next: HighlightState = {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      label: described.label,
      role: described.role,
    };

    // Only re-render when something actually moved — the rAF loop runs on
    // every pointer frame and most frames resolve the same element.
    setHighlight((prev) =>
      prev &&
      prev.x === next.x &&
      prev.y === next.y &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.label === next.label &&
      prev.role === next.role
        ? prev
        : next
    );
  }, []);

  const scheduleHitTest = useCallback(
    (x: number, y: number) => {
      pendingPointRef.current = { x, y };
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const point = pendingPointRef.current;
        if (!point || busyRef.current) return;
        applyTarget(pickFromPoint(point.x, point.y));
      });
    },
    [applyTarget]
  );

  // ── Selection ──
  const select = useCallback(
    async (el: HTMLElement) => {
      if (busyRef.current) return;
      busyRef.current = true;

      // Freeze the reticle on the choice and flash it to the accent — the
      // one beat of commitment. The capture runs underneath it.
      setFlashing(true);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(
        () => setFlashing(false),
        reducedMotion ? 0 : FLASH_MS
      );
      setCapturing(true);

      let crop: Blob | null = null;
      try {
        crop = await captureCrop(el);
      } catch (err) {
        // A missing crop never costs the operator the reference.
        console.warn("Bug report element crop failed:", err);
        crop = null;
      }

      const reference = buildElementReference(el);

      setCapturing(false);
      busyRef.current = false;
      onSelect({ element: el, reference, crop });
    },
    [captureCrop, onSelect, reducedMotion]
  );

  // ── Overlay input ──
  useEffect(() => {
    if (!open || !rootEl) return;

    // A click or move over the picker's own hint rail is chrome, not a pick.
    function isChrome(target: EventTarget | null): boolean {
      const el = target as Element | null;
      return !!el?.closest?.("[data-element-picker-chrome]");
    }

    function handlePointerMove(e: Event) {
      if (busyRef.current) return;
      if (isChrome(e.target)) return;
      const { clientX, clientY } = e as unknown as { clientX: number; clientY: number };
      if (typeof clientX !== "number" || typeof clientY !== "number") return;
      scheduleHitTest(clientX, clientY);
    }

    function handleClick(e: Event) {
      if (busyRef.current) return;
      if (isChrome(e.target)) return;
      const { clientX, clientY } = e as unknown as { clientX: number; clientY: number };
      const el =
        typeof clientX === "number" && typeof clientY === "number"
          ? pickFromPoint(clientX, clientY)
          : targetRef.current;
      if (!el) return;
      e.preventDefault();
      void select(el);
    }

    function handleTouchStart(e: Event) {
      if (busyRef.current) return;
      if (isChrome(e.target)) return;
      const touch = (e as unknown as { touches?: Array<{ clientX: number; clientY: number }> })
        .touches?.[0];
      if (!touch) return;
      scheduleHitTest(touch.clientX, touch.clientY);
    }

    function handleTouchEnd(e: Event) {
      if (busyRef.current) return;
      if (isChrome(e.target)) return;
      const el = targetRef.current;
      if (!el) return;
      e.preventDefault();
      void select(el);
    }

    rootEl.addEventListener("pointermove", handlePointerMove);
    rootEl.addEventListener("click", handleClick);
    rootEl.addEventListener("touchstart", handleTouchStart);
    rootEl.addEventListener("touchend", handleTouchEnd);
    return () => {
      rootEl.removeEventListener("pointermove", handlePointerMove);
      rootEl.removeEventListener("click", handleClick);
      rootEl.removeEventListener("touchstart", handleTouchStart);
      rootEl.removeEventListener("touchend", handleTouchEnd);
    };
  }, [open, rootEl, scheduleHitTest, select]);

  // ── Keyboard + focus ──
  // Tab keeps moving through the page natively; the reticle follows focus so
  // the keyboard path sees exactly what the pointer path sees.
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        if (busyRef.current) return;
        const el = targetRef.current;
        if (!el) return;
        e.preventDefault();
        void select(el);
      }
    }

    function handleFocusIn() {
      if (busyRef.current) return;
      const el = resolvePickTarget(document.activeElement as Element | null);
      if (el && isPickable(el)) applyTarget(el);
    }

    function handleScroll() {
      if (busyRef.current) return;
      if (targetRef.current) applyTarget(targetRef.current);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, onCancel, select, applyTarget]);

  // ── Teardown ──
  useEffect(() => {
    if (open) return;
    targetRef.current = null;
    pendingPointRef.current = null;
    busyRef.current = false;
    setHighlight(null);
    setCapturing(false);
    setFlashing(false);
  }, [open]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    []
  );

  if (typeof document === "undefined") return null;

  const labelBelow = highlight !== null && highlight.y < LABEL_OFFSET;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="bug-report-element-picker"
          ref={setRootEl}
          data-element-picker-root=""
          data-bug-report-ignore="true"
          role="dialog"
          aria-modal="true"
          aria-label={t("bugReport.picker.dialogLabel")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: reducedMotion ? 0 : OVERLAY_FADE_S,
            ease: EASE_SMOOTH,
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: Z_PICKER,
            cursor: "crosshair",
            // Painted, never filtered — see the token note at the top.
            background: PICKER_WASH,
          }}
        >
          {highlight && (
            <>
              <div
                data-element-picker-highlight=""
                aria-hidden
                className="absolute top-0 left-0 rounded-chip bg-surface-hover pointer-events-none"
                style={{
                  transform: `translate3d(${highlight.x}px, ${highlight.y}px, 0)`,
                  width: highlight.width,
                  height: highlight.height,
                  outline: "1px solid",
                  outlineColor: flashing ? "var(--ops-accent)" : "var(--text-2)",
                  willChange: "transform",
                  transition: reducedMotion
                    ? "none"
                    : `transform ${RETICLE_MS}ms ${EASE_CSS}, width ${RETICLE_MS}ms ${EASE_CSS}, height ${RETICLE_MS}ms ${EASE_CSS}`,
                }}
              />
              <span
                data-element-picker-label=""
                className={cn(PILL, "absolute pointer-events-none")}
                style={{
                  left: highlight.x,
                  top: labelBelow
                    ? highlight.y + highlight.height + 6
                    : highlight.y - LABEL_OFFSET,
                }}
              >
                {`${highlight.role} · ${highlight.label}`}
              </span>
            </>
          )}

          <div
            data-element-picker-chrome=""
            className="absolute flex items-center gap-1.5"
            style={{ left: HINT_INSET, bottom: HINT_INSET }}
          >
            {capturing ? (
              <span className={PILL}>{t("bugReport.picker.capturing")}</span>
            ) : (
              <>
                <span className={PILL}>{t("bugReport.picker.hint")}</span>
                <span className={cn(PILL, "text-text-mute")}>
                  {t("bugReport.picker.keys")}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                  className={cn(PILL, "transition-colors duration-150 hover:text-text")}
                >
                  {t("bugReport.picker.cancel")}
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

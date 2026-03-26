"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CarouselItem<T> {
  id: string;
  data: T;
  /** AI-suggested default action key (e.g. "1", "2", "3") */
  defaultAction: string;
}

export interface CarouselDecision {
  label: string;
  color: string;
}

interface CardCarouselProps<T> {
  title: string;
  items: CarouselItem<T>[];
  renderCard: (item: CarouselItem<T>, isFocused: boolean, setDecision: (d: CarouselDecision) => void, triggerAction: (key: string) => void, highlightedKey: string, threadToggle: number) => ReactNode;
  actions: Record<string, (item: CarouselItem<T>) => CarouselDecision | void>;
  onComplete: () => void;
  onBack?: () => void;
  skipLabel?: string;
  keyboardHint?: string;
}

// ─── Noop helpers for non-interactive peek cards ─────────────────────────────

const noopSetDecision = () => {};
const noopTrigger = () => {};

// ─── Component ────────────────────────────────────────────────────────────────

export function CardCarousel<T>({
  title,
  items,
  renderCard,
  actions,
  onComplete,
  onBack,
  skipLabel = "SKIP TO NEXT STEP",
  keyboardHint = "←→ select · ↓/⏎ accept · ↑ back · ⌫ discard · E thread",
}: CardCarouselProps<T>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [decisions, setDecisions] = useState<Map<string, CarouselDecision>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();
  const { t } = useDictionary("import-wizard");

  // ── Action key selection state ────────────────────────────────────────
  const actionKeys = useMemo(
    () => Object.keys(actions).filter((k) => k !== "Backspace"),
    [actions]
  );
  const [highlightedKey, setHighlightedKey] = useState<string>("");
  // Incremented on E key — passed to EmailThreadView to toggle expand/collapse
  const [threadToggle, setThreadToggle] = useState(0);

  // Track which action key was used per item — for restoring highlight on revisit
  const [decisionKeys, setDecisionKeys] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const item = items[currentIndex];
    if (!item) return;
    // Restore the action key if user already decided, otherwise use the default
    const storedKey = decisionKeys.get(item.id);
    setHighlightedKey(storedKey ?? item.defaultAction);
  }, [currentIndex, items, decisionKeys]);

  const recordDecision = useCallback((itemId: string, decision: CarouselDecision) => {
    setDecisions((prev) => new Map(prev).set(itemId, decision));
  }, []);

  useEffect(() => {
    if (items.length === 0) onComplete();
  }, [items.length, onComplete]);

  const current = items[currentIndex];
  const prev = currentIndex > 0 ? items[currentIndex - 1] : null;
  const next = currentIndex < items.length - 1 ? items[currentIndex + 1] : null;

  const advance = useCallback(() => {
    if (currentIndex < items.length - 1) {
      setDirection(1);
      setCurrentIndex((i) => i + 1);
    } else {
      onComplete();
    }
  }, [currentIndex, items.length, onComplete]);

  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const handleAction = useCallback(
    (key: string) => {
      if (!current) return;
      const handler = actions[key];
      if (handler) {
        const decision = handler(current);
        if (decision) recordDecision(current.id, decision);
        // Remember which key was used so we can restore it on revisit
        const effectiveKey = key === "Backspace" ? actionKeys[actionKeys.length - 1] : key;
        setDecisionKeys((prev) => new Map(prev).set(current.id, effectiveKey));
        advance();
      }
    },
    [current, actions, advance, recordDecision, actionKeys]
  );

  // ── Keyboard ──────────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case "ArrowDown":
        case "Enter":
          e.preventDefault();
          if (highlightedKey) handleAction(highlightedKey);
          break;
        case "ArrowUp":
          e.preventDefault();
          goBack();
          break;
        case "ArrowLeft":
          e.preventDefault();
          setHighlightedKey((prev) => {
            const idx = actionKeys.indexOf(prev);
            return actionKeys[(idx - 1 + actionKeys.length) % actionKeys.length];
          });
          break;
        case "ArrowRight":
          e.preventDefault();
          setHighlightedKey((prev) => {
            const idx = actionKeys.indexOf(prev);
            return actionKeys[(idx + 1) % actionKeys.length];
          });
          break;
        case "Backspace":
          e.preventDefault();
          handleAction("Backspace");
          break;
        case "1":
        case "2":
        case "3":
        case "4":
          e.preventDefault();
          handleAction(e.key);
          break;
        case "e":
        case "E":
          e.preventDefault();
          setThreadToggle((n) => n + 1);
          break;
      }
    },
    [highlightedKey, actionKeys, goBack, handleAction]
  );

  useEffect(() => {
    containerRef.current?.focus();
  }, [currentIndex]);

  if (items.length === 0) return null;

  const dur = prefersReduced ? 0 : 0.2;
  const slideVariants = {
    enter: (dir: number) => ({
      y: prefersReduced ? 0 : dir > 0 ? 30 : -30,
      opacity: 0,
    }),
    center: {
      y: 0,
      opacity: 1,
      transition: { duration: dur, ease: EASE_SMOOTH },
    },
    exit: (dir: number) => ({
      y: prefersReduced ? 0 : dir > 0 ? -30 : 30,
      opacity: 0,
      transition: { duration: prefersReduced ? 0 : 0.15, ease: EASE_SMOOTH },
    }),
  };

  // Shared card surface style
  const cardSurface = {
    borderRadius: 4,
    background: "rgba(10, 10, 10, 0.70)",
    backdropFilter: "blur(20px) saturate(1.2)",
    WebkitBackdropFilter: "blur(20px) saturate(1.2)",
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-carousel-container
      className="flex flex-col outline-none h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="font-kosugi text-[11px] tracking-[0.15em] uppercase text-[#999]">
          {title}
        </h3>
        <span className="font-mohave text-[13px] text-[#555]">
          {currentIndex + 1} {t("of")} {items.length}
        </span>
      </div>

      {/* ── Card stack ── */}
      {/*
        The focused card sizes to its content. Peeks sit directly adjacent.
        Remaining space falls to the bottom via a spacer.
        When content is taller than available space, the card scrolls.
      */}
      <div className="flex-1 min-h-0 flex flex-col">

        {/* Previous card peek — 48px, only when there's a card behind */}
        {prev && (
          <div className="flex-shrink-0 mb-1.5 relative" style={{ height: 48 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={`prev-${prev.id}`}
                initial={prefersReduced ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: dur, ease: EASE_SMOOTH }}
                className="absolute inset-0"
              >
                <div
                  className="px-4 py-3 overflow-hidden pointer-events-none select-none relative border border-white/[0.06]"
                  style={{
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.02)",
                    height: 48,
                    opacity: 0.6,
                    transform: "scale(0.98)",
                    transformOrigin: "bottom center",
                  }}
                >
                  {renderCard(prev, false, noopSetDecision, noopTrigger, "", 0)}
                  <div
                    className="absolute inset-x-0 bottom-0 h-6"
                    style={{ background: "linear-gradient(to top, rgba(10,10,10,0.95), transparent)" }}
                  />
                  {decisions.get(prev.id) && (
                    <div
                      className="absolute top-2.5 right-3 font-kosugi text-[9px] tracking-[0.1em] uppercase"
                      style={{ color: decisions.get(prev.id)!.color }}
                    >
                      {decisions.get(prev.id)!.label}
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* Focused card — sizes to content, shrinks + scrolls when exceeding space */}
        <AnimatePresence mode="wait" custom={direction}>
          {current && (
            <motion.div
              key={current.id}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="shrink min-h-0 border border-white/10 p-4 overflow-y-auto scrollbar-hide overscroll-contain"
              style={cardSurface}
            >
              {renderCard(current, true, (d) => recordDecision(current.id, d), handleAction, highlightedKey, threadToggle)}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Next card peek — 48px, only when there's a card ahead */}
        {next && (
          <div className="flex-shrink-0 mt-1.5 relative" style={{ height: 48 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={`next-${next.id}`}
                initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: dur, ease: EASE_SMOOTH }}
                className="absolute inset-0"
              >
                <div
                  className="px-4 py-3 overflow-hidden pointer-events-none select-none relative border border-white/[0.06]"
                  style={{
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.02)",
                    height: 48,
                    opacity: 0.5,
                    transform: "scale(0.98)",
                    transformOrigin: "top center",
                  }}
                >
                  {renderCard(next, false, noopSetDecision, noopTrigger, "", 0)}
                  <div
                    className="absolute inset-x-0 top-0 h-6"
                    style={{ background: "linear-gradient(to bottom, rgba(10,10,10,0.95), transparent)" }}
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* Spacer — absorbs remaining vertical space below the stack */}
        <div className="flex-1 shrink-0" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/[0.06] flex-shrink-0 pb-3">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="font-kosugi text-[10px] tracking-[0.1em] uppercase text-[#666] hover:text-[#999] transition-colors"
            >
              ← {t("confirm.back")}
            </button>
          )}
          <span className="font-mohave text-[11px] text-[#555]">
            {keyboardHint}
          </span>
        </div>
        <button
          onClick={onComplete}
          className="font-kosugi text-[10px] tracking-[0.1em] uppercase text-[#666] hover:text-[#999] transition-colors"
        >
          {skipLabel || t("skipToNext")} →
        </button>
      </div>
    </div>
  );
}

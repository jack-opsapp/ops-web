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

  const dur = prefersReduced ? 0 : 0.3;

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
      <div className="flex-1 min-h-0 flex flex-col">

        {/* Previous card — collapsed title bar, tucked behind focused card */}
        <AnimatePresence mode="popLayout" initial={false}>
          {prev && (
            <motion.div
              key={prev.id}
              initial={prefersReduced ? false : { opacity: 0, y: -8, scale: 0.94 }}
              animate={{ opacity: 0.5, y: 0, scale: 0.96 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.94 }}
              transition={{ duration: dur, ease: EASE_SMOOTH }}
              className="flex-shrink-0 mb-[-4px] pointer-events-none select-none relative z-0"
              style={{ transformOrigin: "bottom center" }}
            >
              <div
                className="border border-white/[0.06] px-4 py-2.5 overflow-hidden relative"
                style={{ ...cardSurface, background: "rgba(255, 255, 255, 0.02)", height: 40 }}
              >
                {renderCard(prev, false, noopSetDecision, noopTrigger, "", 0)}
                {decisions.get(prev.id) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15, duration: 0.2 }}
                    className="absolute top-2.5 right-3 font-kosugi text-[9px] tracking-[0.1em] uppercase"
                    style={{ color: decisions.get(prev.id)!.color }}
                  >
                    {decisions.get(prev.id)!.label}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Focused card — sizes to content, smooth layout animation for thread expand */}
        <AnimatePresence mode="popLayout" custom={direction} initial={false}>
          {current && (
            <motion.div
              key={current.id}
              layout={!prefersReduced}
              custom={direction}
              variants={{
                enter: (dir: number) => prefersReduced ? { opacity: 1 } : {
                  y: dir > 0 ? 30 : -20,
                  opacity: dir > 0 ? 0.35 : 0.5,
                  scale: dir > 0 ? 0.97 : 0.96,
                },
                center: {
                  y: 0,
                  opacity: 1,
                  scale: 1,
                  transition: { duration: dur, ease: EASE_SMOOTH },
                },
                exit: (dir: number) => prefersReduced ? { opacity: 0 } : {
                  y: dir > 0 ? -15 : 30,
                  opacity: dir > 0 ? 0.4 : 0.3,
                  scale: dir > 0 ? 0.96 : 0.97,
                  transition: { duration: dur * 0.8, ease: EASE_SMOOTH },
                },
              }}
              initial="enter"
              animate="center"
              exit="exit"
              className="shrink min-h-0 border border-white/10 p-4 overflow-y-auto scrollbar-hide overscroll-contain relative z-10"
              style={cardSurface}
              transition={{ layout: { duration: 0.25, ease: EASE_SMOOTH } }}
            >
              {renderCard(current, true, (d) => recordDecision(current.id, d), handleAction, highlightedKey, threadToggle)}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Next card — full card, faded + shrunken */}
        <AnimatePresence mode="popLayout" initial={false}>
          {next && (
            <motion.div
              key={next.id}
              initial={prefersReduced ? false : { opacity: 0, y: 20, scale: 0.94 }}
              animate={{ opacity: 0.35, y: 0, scale: 0.97 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.94 }}
              transition={{ duration: dur, ease: EASE_SMOOTH }}
              className="flex-shrink-0 mt-2 pointer-events-none select-none"
              style={{ transformOrigin: "top center" }}
            >
              <div
                className="border border-white/[0.06] p-4"
                style={{ ...cardSurface, background: "rgba(255, 255, 255, 0.02)" }}
              >
                {renderCard(next, false, noopSetDecision, noopTrigger, "", 0)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

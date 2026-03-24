"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
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
  /** Render focused card content */
  renderCard: (item: CarouselItem<T>, isFocused: boolean, setDecision: (d: CarouselDecision) => void) => ReactNode;
  /** Render compressed preview (prev/next peek, decision badge) */
  renderPreview: (item: CarouselItem<T>, decision?: CarouselDecision) => ReactNode;
  /** Action handlers keyed by shortcut: "1", "2", "3", "Backspace". Return a CarouselDecision to show on the prev card badge. */
  actions: Record<string, (item: CarouselItem<T>) => CarouselDecision | void>;
  /** Called when all items processed or user clicks skip */
  onComplete: () => void;
  /** Called when user wants to go back to previous sub-step */
  onBack?: () => void;
  skipLabel?: string;
  /** Keyboard hint text shown at bottom left */
  keyboardHint?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CardCarousel<T>({
  title,
  items,
  renderCard,
  renderPreview,
  actions,
  onComplete,
  onBack,
  skipLabel = "SKIP TO NEXT STEP",
  keyboardHint = "↑↓ navigate · 1/2/3 select · ⏎ accept · ⌫ discard · E thread",
}: CardCarouselProps<T>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [decisions, setDecisions] = useState<Map<string, CarouselDecision>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();
  const { t } = useDictionary("import-wizard");

  const recordDecision = useCallback((itemId: string, decision: CarouselDecision) => {
    setDecisions((prev) => new Map(prev).set(itemId, decision));
  }, []);

  // Handle empty items via useEffect (not during render)
  useEffect(() => {
    if (items.length === 0) onComplete();
  }, [items.length, onComplete]);

  const current = items[currentIndex];
  const prev = currentIndex > 0 ? items[currentIndex - 1] : null;
  const next =
    currentIndex < items.length - 1 ? items[currentIndex + 1] : null;

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
        advance();
      }
    },
    [current, actions, advance, recordDecision]
  );

  const acceptDefault = useCallback(() => {
    if (!current) return;
    const handler = actions[current.defaultAction];
    if (handler) {
      const decision = handler(current);
      if (decision) recordDecision(current.id, decision);
      advance();
    }
  }, [current, actions, advance, recordDecision]);

  // Keyboard handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case "ArrowDown":
        case "Enter":
          e.preventDefault();
          acceptDefault();
          break;
        case "ArrowUp":
          e.preventDefault();
          goBack();
          break;
        case "Backspace":
          e.preventDefault();
          handleAction("Backspace");
          break;
        case "1":
        case "2":
        case "3":
          e.preventDefault();
          handleAction(e.key);
          break;
        // E key is handled by EmailThreadView — don't capture here
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [acceptDefault, goBack, handleAction]);

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  if (items.length === 0) return null;

  const dur = prefersReduced ? 0 : 0.2;
  const slideVariants = {
    enter: (dir: number) => ({
      y: prefersReduced ? 0 : dir > 0 ? 40 : -40,
      opacity: 0,
    }),
    center: {
      y: 0,
      opacity: 1,
      transition: { duration: dur, ease: EASE_SMOOTH },
    },
    exit: (dir: number) => ({
      y: prefersReduced ? 0 : dir > 0 ? -40 : 40,
      opacity: 0,
      transition: { duration: prefersReduced ? 0 : 0.15, ease: EASE_SMOOTH },
    }),
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex flex-col outline-none"
      style={{ maxHeight: "calc(85vh - 180px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-kosugi text-[10px] tracking-[0.15em] uppercase text-[#999]">
          {title}
        </h3>
        <span className="font-mohave text-[12px] text-[#555]">
          {currentIndex + 1} {t("of")} {items.length}
        </span>
      </div>

      {/* Previous card peek */}
      <div className="h-10 mb-2">
        {prev && (
          <motion.div
            key={`prev-${prev.id}`}
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 0.5 }}
            className="px-3 py-2 border border-white/5 overflow-hidden flex items-center justify-between"
            style={{
              borderRadius: 4,
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
            }}
          >
            <div className="flex-1 min-w-0">{renderPreview(prev, decisions.get(prev.id))}</div>
            {decisions.get(prev.id) && (
              <span
                className="font-kosugi text-[8px] tracking-[0.1em] uppercase flex-shrink-0 ml-2"
                style={{ color: decisions.get(prev.id)!.color }}
              >
                {decisions.get(prev.id)!.label}
              </span>
            )}
          </motion.div>
        )}
      </div>

      {/* Focused card */}
      <div className="flex-1 min-h-0 relative overflow-y-auto scrollbar-hide">
        <AnimatePresence mode="wait" custom={direction}>
          {current && (
            <motion.div
              key={current.id}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="border border-white/8 p-4"
              style={{
                borderRadius: 4,
                background: "rgba(10, 10, 10, 0.70)",
                backdropFilter: "blur(20px) saturate(1.2)",
                WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              }}
            >
              {renderCard(current, true, (d) => recordDecision(current.id, d))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Next card peek */}
      <div className="h-10 mt-2">
        {next && (
          <motion.div
            key={`next-${next.id}`}
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 0.4 }}
            className="px-3 py-2 border border-white/5 overflow-hidden"
            style={{
              borderRadius: 4,
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
            }}
          >
            {renderPreview(next, decisions.get(next.id))}
          </motion.div>
        )}
      </div>

      {/* Footer: back + keyboard hints + skip */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="font-kosugi text-[9px] tracking-[0.1em] uppercase text-[#555] hover:text-[#999] transition-colors"
            >
              ← {t("confirm.back")}
            </button>
          )}
          <span className="font-mohave text-[10px] text-[#444]">
            {keyboardHint}
          </span>
        </div>
        <button
          onClick={onComplete}
          className="font-kosugi text-[9px] tracking-[0.1em] uppercase text-[#555] hover:text-[#999] transition-colors"
        >
          {skipLabel || t("skipToNext")} →
        </button>
      </div>
    </div>
  );
}

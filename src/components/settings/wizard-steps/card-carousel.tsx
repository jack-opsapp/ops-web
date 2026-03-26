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
  /** Original AI suggestion key — never overwritten by user decisions */
  aiDefaultAction?: string;
}

export interface CarouselDecision {
  label: string;
  color: string;
}

interface CardCarouselProps<T> {
  title: string;
  items: CarouselItem<T>[];
  renderCard: (item: CarouselItem<T>, isFocused: boolean, setDecision: (d: CarouselDecision) => void, triggerAction: (key: string) => void, highlightedKey: string, threadToggle: number, onThreadToggle: () => void, hideBadge?: boolean) => ReactNode;
  actions: Record<string, (item: CarouselItem<T>) => CarouselDecision | void>;
  onComplete: () => void;
  onBack?: () => void;
  skipLabel?: string;
  keyboardHint?: string;
  /** Enable mouse wheel to advance (scroll down) / go back (scroll up) */
  wheelNavigation?: boolean;
}

// ─── Noop helpers for non-interactive peek cards ─────────────────────────────

const noopSetDecision = () => {};
const noopTrigger = () => {};
const noopToggle = () => {};

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
  wheelNavigation = false,
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
  // Track whether thread is expanded — card grows when true
  const [threadExpanded, setThreadExpanded] = useState(false);

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
          setThreadExpanded((v) => !v);
          break;
      }
    },
    [highlightedKey, actionKeys, goBack, handleAction]
  );

  // ── Mouse wheel navigation ─────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!wheelNavigation) return;
      if (Math.abs(e.deltaY) < 2) return;

      // Block wheel navigation entirely when thread is expanded
      if (threadExpanded) return;

      if (e.deltaY > 0) {
        if (highlightedKey) handleAction(highlightedKey);
      } else {
        goBack();
      }
    },
    [wheelNavigation, highlightedKey, handleAction, goBack, threadExpanded]
  );

  useEffect(() => {
    containerRef.current?.focus();
    setThreadExpanded(false);
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
      onWheel={onWheel}
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
        Flex column layout. Single AnimatePresence with stable keys so
        items keep identity as they move between roles. Layout animation
        handles position/size changes. No absolute positioning.
      */}
      <div className="flex-1 min-h-0 flex flex-col">
          {/* Previous — collapsed bar (no AnimatePresence, keyed by index to avoid layout fights) */}
          <AnimatePresence initial={false} mode="popLayout">
            {prev && (
              <motion.div
                key={`prev-${currentIndex}`}
                initial={prefersReduced ? false : direction === -1 ? { opacity: 0.5, scale: 0.96 } : { opacity: 0, y: -12 }}
                animate={{ opacity: 0.5, scale: 0.96 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
                transition={{ duration: dur * 0.7, ease: EASE_SMOOTH }}
                className="flex-shrink-0 mb-[-4px] pointer-events-none select-none relative z-0 border border-white/[0.06] px-4 py-2.5 overflow-hidden"
                style={{ ...cardSurface, background: "rgba(255, 255, 255, 0.02)", maxHeight: 40, transformOrigin: "bottom center" }}
              >
                {renderCard(prev, false, noopSetDecision, noopTrigger, "", 0, noopToggle, true)}
                {decisions.get(prev.id) && (() => {
                  const d = decisions.get(prev.id)!;
                  const usedKey = decisionKeys.get(prev.id);
                  const aiKey = prev.aiDefaultAction ?? prev.defaultAction;
                  const isDefault = usedKey === aiKey;
                  return (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.12, duration: 0.2 }}
                      className="absolute top-2.5 right-3 font-kosugi text-[9px] tracking-[0.1em] uppercase"
                      style={{ color: d.color }}
                    >
                      {isDefault ? `AGENT: ${d.label}` : `SELECTED: ${d.label}`}
                    </motion.div>
                  );
                })()}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Current — focused card */}
          <AnimatePresence initial={false} mode="popLayout">
            {current && (
              <motion.div
                ref={cardRef}
                key={current.id}
                initial={prefersReduced ? false : direction === -1
                  ? { opacity: 0.5, scale: 0.96, maxHeight: 40 }
                  : { opacity: 0, y: 20 }
                }
                animate={{ opacity: 1, scale: 1, maxHeight: 2000 }}
                exit={prefersReduced ? { opacity: 0 } : direction === 1
                  ? { opacity: 0, y: -12, maxHeight: 40, transition: { duration: dur * 0.6, ease: EASE_SMOOTH } }
                  : { opacity: 0, y: 20, transition: { duration: dur * 0.6, ease: EASE_SMOOTH } }
                }
                transition={{ duration: dur, ease: EASE_SMOOTH, maxHeight: { duration: 0.25, ease: EASE_SMOOTH } }}
                className="min-h-0 border border-white/10 p-4 overflow-y-auto scrollbar-hide overscroll-contain relative z-10 transition-[flex] duration-300"
                style={{ ...cardSurface, flex: threadExpanded ? "1.5 1 0%" : "0 1 auto", transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
              >
                {renderCard(current, true, (d) => recordDecision(current.id, d), handleAction, highlightedKey, threadToggle, () => setThreadExpanded((v) => !v))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Next — full card, faded */}
          <AnimatePresence initial={false} mode="popLayout">
            {next && (
              <motion.div
                key={`next-${currentIndex}`}
                initial={prefersReduced ? false : direction === 1 ? { opacity: 0, y: 20 } : { opacity: 0.35, scale: 0.97 }}
                animate={{ opacity: 0.35, scale: 0.97 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
                transition={{ duration: dur * 0.7, ease: EASE_SMOOTH }}
                className="flex-shrink-0 mt-2 pointer-events-none select-none border border-white/[0.06] p-4"
                style={{ ...cardSurface, background: "rgba(255, 255, 255, 0.02)", transformOrigin: "top center" }}
              >
                {renderCard(next, false, noopSetDecision, noopTrigger, "", 0, noopToggle)}
              </motion.div>
            )}
          </AnimatePresence>

        {/* Spacer */}
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

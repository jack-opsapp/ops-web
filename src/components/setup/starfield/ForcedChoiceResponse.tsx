"use client";

import { useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ForcedChoiceResponseProps {
  options: { id: string; label: string }[];
  value: string | null;
  onSelect: (optionId: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_DIAMETER = 16;
const TOUCH_TARGET = 44;
const HORIZONTAL_GAP = 200;
const SELECT_DELAY_MS = 400;

// ─── Component ──────────────────────────────────────────────────────────────

export function ForcedChoiceResponse({
  options,
  value,
  onSelect,
}: ForcedChoiceResponseProps) {
  const prefersReduced = useReducedMotion();
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    };
  }, []);

  const handleSelect = useCallback((optionId: string) => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    selectTimerRef.current = setTimeout(() => {
      onSelectRef.current(optionId);
    }, SELECT_DELAY_MS);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={prefersReduced ? undefined : { opacity: 0 }}
        animate={prefersReduced ? undefined : { opacity: 1 }}
        exit={prefersReduced ? undefined : { opacity: 0 }}
        transition={{ duration: prefersReduced ? 0 : 0.3, ease: "easeOut" }}
        className="flex flex-col items-center select-none"
      >
        {/* Nodes container — uses relative positioning with nodes placed from center */}
        <div
          className="relative flex items-center justify-center"
          style={{
            width: HORIZONTAL_GAP + TOUCH_TARGET,
            height: TOUCH_TARGET + 40, // room for label below
          }}
        >
          {/* Connecting line between nodes */}
          <motion.div
            className="absolute top-[22px] bg-white/10"
            style={{
              height: 1,
              left: TOUCH_TARGET / 2,
              right: TOUCH_TARGET / 2,
              width: HORIZONTAL_GAP,
            }}
            initial={prefersReduced ? undefined : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{
              duration: prefersReduced ? 0 : 0.4,
              delay: prefersReduced ? 0 : 0.15,
              ease: "easeOut",
            }}
            aria-hidden="true"
          />

          {/* Option nodes */}
          {options.slice(0, 2).map((option, index) => {
            const isSelected = value === option.id;
            const direction = index === 0 ? -1 : 1;

            return (
              <motion.div
                key={option.id}
                initial={
                  prefersReduced
                    ? undefined
                    : { x: 0, opacity: 0 }
                }
                animate={
                  prefersReduced
                    ? undefined
                    : { x: direction * (HORIZONTAL_GAP / 2), opacity: 1 }
                }
                exit={
                  prefersReduced
                    ? undefined
                    : { x: 0, opacity: 0 }
                }
                transition={{
                  duration: prefersReduced ? 0 : 0.35,
                  ease: [0.2, 0.8, 0.3, 1],
                }}
                className="absolute flex flex-col items-center"
                style={{ top: 0 }}
              >
                {/* Touch target button */}
                <button
                  type="button"
                  onClick={() => handleSelect(option.id)}
                  aria-label={option.label}
                  aria-pressed={isSelected}
                  className="flex items-center justify-center focus:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent/50 rounded-full"
                  style={{
                    width: TOUCH_TARGET,
                    height: TOUCH_TARGET,
                  }}
                >
                  {/* Visual node */}
                  <motion.div
                    initial={false}
                    animate={{
                      backgroundColor: isSelected
                        ? "rgb(65, 115, 148)"
                        : "transparent",
                      borderColor: isSelected
                        ? "rgb(65, 115, 148)"
                        : "rgba(255, 255, 255, 0.25)",
                      boxShadow: isSelected
                        ? "0 0 14px 3px rgba(65, 115, 148, 0.35)"
                        : "none",
                      scale: prefersReduced ? 1 : isSelected ? 1.25 : 1,
                    }}
                    transition={{
                      duration: prefersReduced ? 0 : 0.25,
                      ease: "easeOut",
                    }}
                    style={{
                      width: NODE_DIAMETER,
                      height: NODE_DIAMETER,
                      borderWidth: 1.5,
                      borderStyle: "solid",
                      borderRadius: "50%",
                    }}
                  />
                </button>

                {/* Label below node */}
                <motion.span
                  className="font-kosugi text-sm text-center mt-0.5 whitespace-nowrap"
                  initial={false}
                  animate={{
                    color: isSelected
                      ? "rgba(255, 255, 255, 1)"
                      : "rgba(255, 255, 255, 0.5)",
                  }}
                  transition={{
                    duration: prefersReduced ? 0 : 0.2,
                  }}
                >
                  {option.label}
                </motion.span>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

"use client";

import { useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LikertResponseProps {
  minLabel: string;
  maxLabel: string;
  value: number | null;
  onSelect: (value: number) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const POINT_COUNT = 5;
const BASELINE_WIDTH = 280;
const NODE_DIAMETER = 12;
const TOUCH_TARGET = 44;
const SELECT_DELAY_MS = 400;

// Scale factors for edge-prominence: edges larger, center neutral
const NODE_SCALES = [1.15, 1.05, 1.0, 1.05, 1.15];

// ─── Component ──────────────────────────────────────────────────────────────

export function LikertResponse({
  minLabel,
  maxLabel,
  value,
  onSelect,
}: LikertResponseProps) {
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

  const handleSelect = useCallback((pointValue: number) => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    // Fire parent callback after delay to allow visual feedback
    selectTimerRef.current = setTimeout(() => {
      onSelectRef.current(pointValue);
    }, SELECT_DELAY_MS);
  }, []);

  // Spacing between nodes
  const spacing = BASELINE_WIDTH / (POINT_COUNT - 1);

  return (
    <AnimatePresence>
      <motion.div
        initial={prefersReduced ? undefined : { opacity: 0, y: 8 }}
        animate={prefersReduced ? undefined : { opacity: 1, y: 0 }}
        exit={prefersReduced ? undefined : { opacity: 0, y: -4 }}
        transition={{ duration: prefersReduced ? 0 : 0.3, ease: "easeOut" }}
        className="flex flex-col items-center select-none"
      >
        {/* Baseline + nodes container */}
        <div
          className="relative flex items-center"
          style={{ width: BASELINE_WIDTH, height: TOUCH_TARGET }}
        >
          {/* Baseline line */}
          <div
            className="absolute top-1/2 left-0 right-0 h-px bg-white/10 -translate-y-1/2"
            aria-hidden="true"
          />

          {/* Nodes */}
          {Array.from({ length: POINT_COUNT }, (_, i) => {
            const pointValue = i + 1;
            const isSelected = value === pointValue;
            const scale = NODE_SCALES[i];
            const nodeDiameter = NODE_DIAMETER * scale;

            return (
              <button
                key={pointValue}
                type="button"
                onClick={() => handleSelect(pointValue)}
                aria-label={`${pointValue} of ${POINT_COUNT}`}
                aria-pressed={isSelected}
                className="absolute flex items-center justify-center focus:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent/50 rounded-full"
                style={{
                  left: i * spacing - TOUCH_TARGET / 2,
                  top: 0,
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
                      ? "0 0 12px 2px rgba(65, 115, 148, 0.35)"
                      : "none",
                    scale: prefersReduced ? 1 : isSelected ? 1.3 : 1,
                  }}
                  transition={{
                    duration: prefersReduced ? 0 : 0.25,
                    ease: "easeOut",
                  }}
                  style={{
                    width: nodeDiameter,
                    height: nodeDiameter,
                    borderWidth: 1.5,
                    borderStyle: "solid",
                    borderRadius: "50%",
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Labels */}
        <div
          className="flex justify-between mt-2"
          style={{ width: BASELINE_WIDTH }}
        >
          <span className="font-kosugi text-xs text-white/60">{minLabel}</span>
          <span className="font-kosugi text-xs text-white/60">{maxLabel}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

"use client";

import { useState, useRef } from "react";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { notifPillVariants, notifPillVariantsReduced, EASE_SMOOTH } from "@/lib/utils/motion";

interface NotificationPillProps {
  persistent: boolean;
  layoutId: string;
  title: string;
  body?: string;
}

export function NotificationPill({ persistent, layoutId, title, body }: NotificationPillProps) {
  const reducedMotion = useReducedMotion();
  const variants = reducedMotion ? notifPillVariantsReduced : notifPillVariants;
  const [hovered, setHovered] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        ref={pillRef}
        layout
        layoutId={layoutId}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="shrink-0 h-[14px] rounded-full"
        style={{
          width: 6,
          backgroundColor: persistent
            ? "var(--ops-accent, #597794)"
            : "rgba(255, 255, 255, 0.20)",
        }}
      />

      {/* Hover popover */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12, ease: EASE_SMOOTH }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[6px] pointer-events-none z-[1000]"
          >
            <div
              className="px-[8px] py-[5px] rounded-sm max-w-[200px]"
              style={{
                background: "rgba(10, 10, 10, 0.85)",
                backdropFilter: "blur(16px) saturate(1.2)",
                WebkitBackdropFilter: "blur(16px) saturate(1.2)",
                border: "1px solid rgba(255, 255, 255, 0.10)",
                borderLeft: persistent ? "2px solid var(--ops-accent, #597794)" : undefined,
              }}
            >
              <p className="font-mohave text-[11px] text-text-primary text-left leading-tight whitespace-nowrap truncate max-w-[184px]">
                {title}
              </p>
              {body && (
                <p className="font-mohave text-[10px] text-text-secondary text-left leading-tight mt-[1px] line-clamp-2">
                  {body}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

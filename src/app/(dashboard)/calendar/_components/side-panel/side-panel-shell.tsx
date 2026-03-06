"use client";

import { type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

// ─── Props ──────────────────────────────────────────────────────────────────

interface SidePanelShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SidePanelShell({
  isOpen,
  onClose,
  title,
  children,
}: SidePanelShellProps) {
  const prefersReducedMotion = useReducedMotion();

  const slideVariants = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { x: 320 },
        animate: { x: 0 },
        exit: { x: 320 },
      };

  const springTransition = prefersReducedMotion
    ? { duration: 0.15 }
    : { type: "spring" as const, stiffness: 300, damping: 30 };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.aside
          key="side-panel"
          variants={slideVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={springTransition}
          className="fixed top-0 right-0 z-50 h-full w-[320px] flex flex-col"
          style={{
            backgroundColor: "#0D0D0D",
            borderLeft: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-[16px] py-[12px] shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
          >
            <h2
              className="font-mohave font-semibold text-[16px] text-white text-left truncate"
              style={{ lineHeight: "1.25" }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              className="p-[4px] rounded-sm text-[#999999] hover:text-white transition-colors"
              style={{ marginRight: "-4px" }}
              aria-label="Close panel"
            >
              <X className="w-[16px] h-[16px]" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

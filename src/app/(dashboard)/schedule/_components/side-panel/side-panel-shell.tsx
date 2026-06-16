"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
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

  const slideTransition = prefersReducedMotion
    ? { duration: 0.15 }
    : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

  const panel = (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.aside
          key="side-panel"
          variants={slideVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={slideTransition}
          className="fixed top-0 right-0 z-[2000] h-dvh w-full max-w-[360px] flex flex-col"
          style={{
            backgroundColor: "var(--surface-glass-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            borderLeft: "1px solid rgba(255,255,255,0.10)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
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
              className="p-[4px] rounded-sm text-[var(--text-3)] hover:text-white transition-colors"
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

  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}

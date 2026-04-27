"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface HandlerShellProps {
  eyebrow: string;
  children: React.ReactNode;
}

export function HandlerShell({ eyebrow, children }: HandlerShellProps) {
  const reduced = useReducedMotion();
  const t = (delay = 0) =>
    reduced
      ? { duration: 0 }
      : { duration: 0.4, ease: EASE_SMOOTH, delay };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[420px] flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t()}
          className="font-cakemono font-light uppercase text-text-primary mb-6"
          style={{ fontSize: "20px", letterSpacing: "0.18em" }}
        >
          OPS
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0.08)}
          className="w-full rounded-[10px] p-6 sm:p-8"
          style={{
            background: "rgba(18, 18, 20, 0.58)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255, 255, 255, 0.09)",
          }}
        >
          <div
            className="font-cakemono font-light uppercase text-text-3 mb-5"
            style={{
              fontSize: "11px",
              letterSpacing: "0.18em",
              lineHeight: "14px",
            }}
          >
            {"// "}{eyebrow}
          </div>
          {children}
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(0.16)}
          className="font-mono uppercase text-text-mute mt-5"
          style={{ fontSize: "11px", letterSpacing: "0.12em" }}
        >
          [stuck — tap open ops]
        </motion.p>
      </div>
    </div>
  );
}

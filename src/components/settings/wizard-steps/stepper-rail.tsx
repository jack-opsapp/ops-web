"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  key: string;
  label: string;
  subSteps?: Array<{ key: string; label: string }>;
}

interface StepperRailProps {
  steps: Step[];
  currentStep: string;
  currentSubStep?: string;
  completedSteps: Set<string>;
  completedSubSteps: Set<string>;
  /** Show sub-steps only when in the step that has them */
  showSubSteps: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StepperRail({
  steps,
  currentStep,
  currentSubStep,
  completedSteps,
  completedSubSteps,
  showSubSteps,
}: StepperRailProps) {
  const prefersReduced = useReducedMotion();

  return (
    <nav className="flex flex-col gap-0.5 w-[160px] flex-shrink-0 pr-4 border-r border-white/5">
      {steps.map((step) => {
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        const isPast = isCompleted && !isCurrent;
        const isFuture = !isCompleted && !isCurrent;

        return (
          <div key={step.key}>
            {/* Main step row */}
            <div className="flex items-center gap-2 py-1.5">
              {/* Indicator */}
              <div
                className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0"
                style={{ borderRadius: 2 }}
              >
                {isCompleted ? (
                  <Check size={10} className="text-[#6F94B0]" />
                ) : isCurrent ? (
                  <div
                    className="w-2 h-2"
                    style={{ background: "#6F94B0", borderRadius: 1 }}
                  />
                ) : (
                  <div
                    className="w-2 h-2 border border-white/15"
                    style={{ borderRadius: 1 }}
                  />
                )}
              </div>

              {/* Label */}
              <span
                className="font-mono text-micro tracking-[0.15em] uppercase"
                style={{
                  color: isCurrent
                    ? "#E5E5E5"
                    : isPast
                      ? "#6F94B0"
                      : isFuture
                        ? "#444"
                        : "#666",
                }}
              >
                {step.label}
              </span>
            </div>

            {/* Sub-steps — only visible when in the step that has them */}
            {showSubSteps && isCurrent && step.subSteps && (
              <motion.div
                initial={prefersReduced ? false : { opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: prefersReduced
                    ? { duration: 0 }
                    : { duration: 0.2, ease: EASE_SMOOTH },
                }}
                className="ml-5 flex flex-col gap-0.5"
              >
                {step.subSteps.map((sub) => {
                  const isSubCurrent = sub.key === currentSubStep;
                  const isSubCompleted = completedSubSteps.has(sub.key);

                  return (
                    <div
                      key={sub.key}
                      className="flex items-center gap-2 py-1"
                    >
                      <div className="w-2.5 h-2.5 flex items-center justify-center flex-shrink-0">
                        {isSubCompleted ? (
                          <Check size={8} className="text-[#6F94B0]" />
                        ) : isSubCurrent ? (
                          <div
                            className="w-1.5 h-1.5"
                            style={{
                              background: "#6F94B0",
                              borderRadius: 1,
                            }}
                          />
                        ) : (
                          <div
                            className="w-1.5 h-1.5 border border-white/10"
                            style={{ borderRadius: 1 }}
                          />
                        )}
                      </div>
                      <span
                        className="font-mono text-micro tracking-[0.12em] uppercase"
                        style={{
                          color: isSubCurrent
                            ? "#E5E5E5"
                            : isSubCompleted
                              ? "#6F94B0"
                              : "#444",
                        }}
                      >
                        {sub.label}
                      </span>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

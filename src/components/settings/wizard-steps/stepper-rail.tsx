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
    <nav className="flex flex-col gap-0.5 w-[160px] flex-shrink-0 pr-4 border-r border-border-subtle">
      {steps.map((step) => {
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        const isPast = isCompleted && !isCurrent;

        return (
          <div key={step.key}>
            {/* Main step row */}
            <div className="flex items-center gap-2 py-1.5">
              {/* Indicator — neutral wayfinding marks, never accent. The
                  completed tick is a small mono-weight glyph sized to the 14px
                  well; the current/future marks are filled/outlined squares in
                  the text ladder. Accent (#6F94B0) is reserved for CTAs + focus. */}
              <div
                className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0"
                style={{ borderRadius: 2 }}
              >
                {isCompleted ? (
                  <Check size={14} className="text-text-2" />
                ) : isCurrent ? (
                  <div
                    className="w-2 h-2 bg-text"
                    style={{ borderRadius: 1 }}
                  />
                ) : (
                  <div
                    className="w-2 h-2 border border-border-medium"
                    style={{ borderRadius: 1 }}
                  />
                )}
              </div>

              {/* Label */}
              <span
                className={`font-mono text-micro tracking-[0.15em] uppercase ${
                  isCurrent
                    ? "text-text"
                    : isPast
                      ? "text-text-2"
                      : "text-text-mute"
                }`}
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
                          // Dense sub-indicator: the 10px well can't hold the
                          // 14px text floor, so the tick stays small — sanctioned
                          // for a decorative wayfinding glyph (not a label).
                          <Check size={10} className="text-text-2" />
                        ) : isSubCurrent ? (
                          <div
                            className="w-1.5 h-1.5 bg-text"
                            style={{ borderRadius: 1 }}
                          />
                        ) : (
                          <div
                            className="w-1.5 h-1.5 border border-border"
                            style={{ borderRadius: 1 }}
                          />
                        )}
                      </div>
                      <span
                        className={`font-mono text-micro tracking-[0.12em] uppercase ${
                          isSubCurrent
                            ? "text-text"
                            : isSubCompleted
                              ? "text-text-2"
                              : "text-text-mute"
                        }`}
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

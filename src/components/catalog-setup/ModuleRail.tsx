"use client";

/**
 * ModuleRail — the horizontal progress rail across the top of the canvas:
 *   SELL → STOCK → TYPES → REVIEW
 *
 * Intent: the owner mid-build needs a one-glance read of where they are in the
 * assembly and how much is staged in each module — without the rail ever shouting.
 * It's a status line, not navigation chrome, so it stays NEUTRAL: no steel accent
 * anywhere (accent is reserved for the single primary CTA). Done segments carry an
 * olive check (positive/complete). The active segment is a surface-active pill
 * (white label, no accent). Upcoming segments dim to text-3 with a hollow count.
 *
 * STATE-AWARE: STOCK is OMITTED entirely when inventory isn't tracked — the rail
 * shows the operator's actual reality (SELL → TYPES → REVIEW), never a step they'll
 * never touch (root CLAUDE.md design-judgment law; step-machine buildStepPlan).
 *
 * Beneath the segments: a 2px fill-neutral track that fills to current progress —
 * the TRANSITION beat (railAdvance: the fill grows 0→1 as the rail advances).
 *
 * Counts are mono (tabular-lining). Labels are Cake Mono Light uppercase. Strings
 * via useDictionary("catalog-setup").
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { WizardStep, StepContext } from "@/lib/catalog-setup/step-machine";
import { buildStepPlan } from "@/lib/catalog-setup/step-machine";
import { useCatalogSetupMotion } from "@/lib/catalog-setup/motion";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/** Proposed-count keys per step (drives the hollow upcoming count). */
const STEP_LABEL_KEY: Record<WizardStep, string> = {
  sell: "section.sell",
  stock: "section.stock",
  types: "section.types",
  review: "section.review",
};
const STEP_LABEL_FALLBACK: Record<WizardStep, string> = {
  sell: "SELL",
  stock: "STOCK",
  types: "TYPES",
  review: "REVIEW",
};

type SegState = "done" | "active" | "upcoming";

export interface ModuleRailProps {
  /** The rail step the operator is on (from the store). */
  currentStep: WizardStep;
  /** Gates which steps appear — STOCK omitted when !inventoryTracked. */
  context: StepContext;
  /** Proposed count per module, for the hollow upcoming-circle readout. */
  counts: Partial<Record<WizardStep, number>>;
  className?: string;
}

function segStateFor(
  step: WizardStep,
  current: WizardStep,
  plan: WizardStep[],
): SegState {
  const i = plan.indexOf(step);
  const ci = plan.indexOf(current);
  if (i < ci) return "done";
  if (i === ci) return "active";
  return "upcoming";
}

export function ModuleRail({ currentStep, context, counts, className }: ModuleRailProps) {
  const { t } = useDictionary("catalog-setup");
  const m = useCatalogSetupMotion();

  // STATE-AWARE plan: STOCK drops out entirely when inventory isn't tracked.
  const plan = buildStepPlan(context);
  const currentIdx = Math.max(0, plan.indexOf(currentStep));
  // Progress: fraction of steps completed (active counts as "in progress" at its
  // own index / last index). REVIEW at the end reads full.
  const progress = plan.length <= 1 ? 1 : currentIdx / (plan.length - 1);

  return (
    <div data-testid="module-rail" className={cn("flex w-full flex-col gap-2", className)}>
      <div className="flex items-center">
        {plan.map((step, idx) => {
          const seg = segStateFor(step, currentStep, plan);
          const label = t(STEP_LABEL_KEY[step], STEP_LABEL_FALLBACK[step]);
          const count = counts[step] ?? 0;
          const isStock = step === "stock";

          return (
            <div key={step} className="flex items-center" data-segment={step}>
              <div
                data-testid={`rail-segment-${step}`}
                data-seg-state={seg}
                className={cn(
                  "flex items-center gap-[8px] rounded-[5px] px-[10px] py-[6px]",
                  // Active = surface-active pill (white label), NO accent.
                  seg === "active" &&
                    "bg-surface-active border border-[rgba(255,255,255,0.18)]",
                )}
              >
                {/* Status glyph: olive check (done) / hollow count circle (else) */}
                {seg === "done" ? (
                  <span
                    data-testid={`rail-check-${step}`}
                    className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-olive-soft text-olive"
                  >
                    <Check size={11} strokeWidth={2.25} aria-hidden />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[18px] w-[18px] items-center justify-center rounded-full border font-mono text-[11px]",
                      seg === "active"
                        ? "border-[rgba(255,255,255,0.30)] text-text"
                        : "border-glass-border text-text-3",
                    )}
                    style={MONO_NUM}
                  >
                    {count}
                  </span>
                )}

                {/* Label — Cake Mono Light uppercase */}
                <span
                  className={cn(
                    "font-cakemono text-[12px] font-light uppercase leading-none",
                    seg === "active"
                      ? "text-text"
                      : seg === "done"
                        ? "text-text-2"
                        : "text-text-3",
                  )}
                >
                  {label}
                </span>

                {/* STOCK carries a TRACKED tag (only renders when STOCK is present) */}
                {isStock ? (
                  <span
                    data-testid="rail-tracked-tag"
                    className="rounded-chip border border-glass-border px-[5px] py-[1px] font-mono text-[10px] uppercase tracking-wider text-text-3"
                  >
                    {t("state.tracked", "tracked")}
                  </span>
                ) : null}
              </div>

              {/* Thin connector line between segments */}
              {idx < plan.length - 1 ? (
                <span
                  data-testid="rail-connector"
                  aria-hidden
                  className="mx-[4px] h-px w-[20px] bg-glass-border"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* 2px progress track — fill-neutral, grows to current progress (TRANSITION) */}
      <div
        data-testid="rail-progress-track"
        className="h-[2px] w-full overflow-hidden rounded-bar bg-fill-neutral-dim"
      >
        <motion.div
          data-testid="rail-progress-fill"
          className="h-full origin-left rounded-bar bg-fill-neutral"
          style={{ width: `${Math.round(progress * 100)}%` }}
          variants={m.railAdvance}
          initial="inactive"
          animate="active"
        />
      </div>
    </div>
  );
}

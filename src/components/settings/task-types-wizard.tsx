"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { IndustryStep } from "./wizard/industry-step";
import { TaskTypesStep, type WizardTaskType } from "./wizard/task-types-step";
import { DependenciesGateStep } from "./wizard/dependencies-gate-step";
import {
  DependencyTimelineStep,
  type TimelineItem,
} from "./wizard/dependency-timeline-step";
import { ReviewStep } from "./wizard/review-step";
import { useCreateTaskType } from "@/lib/hooks/use-task-types";
import { useCreateTaskTemplate } from "@/lib/hooks/use-task-templates";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Constants ────────────────────────────────────────────────────────────────

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

const TOTAL_STEPS = 5;

// ─── Props ────────────────────────────────────────────────────────────────────

interface TaskTypesWizardProps {
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskTypesWizard({ onComplete }: TaskTypesWizardProps) {
  // ── Wizard state ──────────────────────────────────────────────────────────

  const [step, setStep] = useState(1);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [wizardTaskTypes, setWizardTaskTypes] = useState<WizardTaskType[]>([]);
  const [useDependencies, setUseDependencies] = useState(false);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createTaskType = useCreateTaskType();
  const createTaskTemplate = useCreateTaskTemplate();

  // ── Step handlers ─────────────────────────────────────────────────────────

  const handleIndustryNext = useCallback((industries: string[]) => {
    setSelectedIndustries(industries);
    setStep(2);
  }, []);

  const handleTaskTypesNext = useCallback((taskTypes: WizardTaskType[]) => {
    setWizardTaskTypes(taskTypes);

    // Initialize timeline items from enabled types
    const enabledTypes = taskTypes.filter((tt) => tt.enabled);
    const items: TimelineItem[] = enabledTypes.map((tt) => ({
      id: tt.id,
      name: tt.name,
      color: tt.color,
      overlapPercent: 0,
    }));
    setTimelineItems(items);

    setStep(3);
  }, []);

  const handleTaskTypesBack = useCallback(() => {
    setStep(1);
  }, []);

  const handleDependenciesYes = useCallback(() => {
    setUseDependencies(true);
    setStep(4);
  }, []);

  const handleDependenciesNo = useCallback(() => {
    setUseDependencies(false);
    setStep(5);
  }, []);

  const handleTimelineDone = useCallback(() => {
    setStep(5);
  }, []);

  const handleReviewBack = useCallback(() => {
    if (useDependencies) {
      setStep(4);
    } else {
      setStep(3);
    }
  }, [useDependencies]);

  // ── Create all ────────────────────────────────────────────────────────────

  const handleCreateAll = useCallback(async () => {
    const companyId = useAuthStore.getState().company?.id;
    if (!companyId) throw new Error("No company");

    const enabled = wizardTaskTypes.filter((tt) => tt.enabled);

    for (const tt of enabled) {
      const taskTypeId = await createTaskType.mutateAsync({
        display: tt.name,
        color: tt.color,
        companyId,
      });

      for (let i = 0; i < tt.templates.length; i++) {
        const tmpl = tt.templates[i];
        await createTaskTemplate.mutateAsync({
          taskTypeId,
          title: tmpl.title,
          estimatedHours: tmpl.estimatedHours,
          companyId,
          displayOrder: i,
        });
      }
    }

    // Success — wait 2s for the success animation, then transition out
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    onComplete();
  }, [wizardTaskTypes, createTaskType, createTaskTemplate, onComplete]);

  // ── Review data ───────────────────────────────────────────────────────────

  const reviewTaskTypes = wizardTaskTypes.map((tt) => ({
    name: tt.name,
    color: tt.color,
    templateCount: tt.templates.length,
    enabled: tt.enabled,
  }));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full">
      {/* Step indicator */}
      <div className="px-4 pt-4 pb-2">
        <span className="font-kosugi text-[11px] text-text-disabled">
          Step {step} of {TOTAL_STEPS}
        </span>
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key={1}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: EASE_SMOOTH }}
          >
            <IndustryStep onNext={handleIndustryNext} />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key={2}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: EASE_SMOOTH }}
          >
            <TaskTypesStep
              industries={selectedIndustries}
              onNext={handleTaskTypesNext}
              onBack={handleTaskTypesBack}
            />
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key={3}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: EASE_SMOOTH }}
          >
            <DependenciesGateStep
              onYes={handleDependenciesYes}
              onNo={handleDependenciesNo}
            />
          </motion.div>
        )}

        {step === 4 && (
          <motion.div
            key={4}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: EASE_SMOOTH }}
          >
            <DependencyTimelineStep
              items={timelineItems}
              onItemsChange={setTimelineItems}
              onDone={handleTimelineDone}
            />
          </motion.div>
        )}

        {step === 5 && (
          <motion.div
            key={5}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: EASE_SMOOTH }}
          >
            <ReviewStep
              taskTypes={reviewTaskTypes}
              hasDependencies={useDependencies}
              onBack={handleReviewBack}
              onCreateAll={handleCreateAll}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

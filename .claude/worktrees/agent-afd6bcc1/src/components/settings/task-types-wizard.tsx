"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";

import { IndustryStep } from "./wizard/industry-step";
import { TaskTypesStep, type WizardTaskType } from "./wizard/task-types-step";
import { DependenciesGateStep } from "./wizard/dependencies-gate-step";
import {
  DependencyTimelineStep,
  type TimelineItem,
} from "./wizard/dependency-timeline-step";
import { ReviewStep } from "./wizard/review-step";
import { TaskTypeService, TaskTemplateService, CompanyService } from "@/lib/api/services";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import type { TaskTypeDependency } from "@/lib/types/scheduling";

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
  const [wizardStartTime] = useState(() => Date.now());

  // ── Refs for idempotent batch creation (#2) ─────────────────────────────

  const createdIdsRef = useRef<Map<string, string>>(new Map());
  const queryClient = useQueryClient();

  // ── Step handlers ─────────────────────────────────────────────────────────

  const handleIndustryNext = useCallback((industries: string[]) => {
    setSelectedIndustries(industries);
    setStep(2);
  }, []);

  const handleTaskTypesNext = useCallback((taskTypes: WizardTaskType[]) => {
    setWizardTaskTypes(taskTypes);

    // Initialize timeline items (taskTypes already contains only enabled)
    const items: TimelineItem[] = taskTypes.map((tt) => ({
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
    const store = useAuthStore.getState();
    const companyId = store.company?.id;
    if (!companyId) throw new Error("No company");

    // (#3) Update company industries if changed
    const originalIndustries = store.company?.industries ?? [];
    const industriesChanged =
      selectedIndustries.length !== originalIndustries.length ||
      selectedIndustries.some((ind) => !originalIndustries.includes(ind));

    if (industriesChanged) {
      await CompanyService.updateCompany(companyId, {
        industries: selectedIndustries,
      });
    }

    // (#2) Idempotent: skip already-created types on retry
    const createdIds = createdIdsRef.current;

    // (#11) Call services directly — invalidate once at the end
    for (const tt of wizardTaskTypes) {
      if (createdIds.has(tt.id)) continue;

      const taskTypeId = await TaskTypeService.createTaskType({
        display: tt.name,
        color: tt.color,
        companyId,
      });

      createdIds.set(tt.id, taskTypeId);

      for (let i = 0; i < tt.templates.length; i++) {
        const tmpl = tt.templates[i];
        await TaskTemplateService.createTaskTemplate({
          taskTypeId,
          title: tmpl.title,
          estimatedHours: tmpl.estimatedHours,
          companyId,
          displayOrder: i,
        });
      }
    }

    // (#1) Persist dependencies from timeline
    if (useDependencies && timelineItems.length > 1) {
      for (let i = 1; i < timelineItems.length; i++) {
        const item = timelineItems[i];
        const prevItem = timelineItems[i - 1];
        const serverId = createdIds.get(item.id);
        const prevServerId = createdIds.get(prevItem.id);

        if (serverId && prevServerId) {
          const dep: TaskTypeDependency = {
            depends_on_task_type_id: prevServerId,
            overlap_percentage: item.overlapPercent,
          };
          await TaskTypeService.updateTaskType(serverId, {
            dependencies: [dep],
          });
        }
      }
    }

    // (#11) Single invalidation at the end
    await queryClient.invalidateQueries({ queryKey: queryKeys.taskTypes.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates.all });
    if (industriesChanged) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.company.detail(companyId),
      });
    }

    // Success — wait 2s for the success animation, then transition out
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    onComplete();
  }, [
    wizardTaskTypes,
    selectedIndustries,
    useDependencies,
    timelineItems,
    queryClient,
    onComplete,
  ]);

  // ── Review data (#13: wizardTaskTypes already contains only enabled) ─────

  const reviewTaskTypes = wizardTaskTypes.map((tt) => ({
    name: tt.name,
    color: tt.color,
    templateCount: tt.templates.length,
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
              dependencyTimeline={useDependencies ? timelineItems : undefined}
              wizardStartTime={wizardStartTime}
              onBack={handleReviewBack}
              onCreateAll={handleCreateAll}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewTaskType {
  name: string;
  color: string;
  templateCount: number;
}

interface DependencyTimelineItem {
  id: string;
  name: string;
  color: string;
  overlapPercent: number;
}

interface ReviewStepProps {
  taskTypes: ReviewTaskType[];
  hasDependencies: boolean;
  dependencyTimeline?: DependencyTimelineItem[];
  wizardStartTime: number;
  onBack: () => void;
  onCreateAll: () => Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─── Component ────────────────────────────────────────────────────────────────

export function ReviewStep({
  taskTypes,
  hasDependencies,
  dependencyTimeline,
  wizardStartTime,
  onBack,
  onCreateAll,
}: ReviewStepProps) {
  const { t } = useDictionary("settings");
  const [status, setStatus] = useState<"idle" | "creating" | "success">("idle");

  const totalTemplates = taskTypes.reduce((sum, tt) => sum + tt.templateCount, 0);

  async function handleCreate() {
    setStatus("creating");
    try {
      await onCreateAll();
      setStatus("success");
    } catch (err) {
      // (#8) Show error toast on failure
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      toast.error(message);
      setStatus("idle");
    }
  }

  // (#4) Elapsed time for success screen
  if (status === "success") {
    const elapsedSeconds = Math.round((Date.now() - wizardStartTime) / 1000);

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: EASE_SMOOTH }}
        className="flex flex-col items-center justify-center min-h-[320px] px-4"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: EASE_SMOOTH }}
          className="w-[48px] h-[48px] rounded-full bg-[rgba(89,119,148,0.15)] flex items-center justify-center mb-[16px]"
        >
          <Check className="w-[24px] h-[24px] text-[#597794]" />
        </motion.div>
        <p className="font-mohave text-body text-text-primary">
          {t("wizard.review.success")}
        </p>
        <p className="font-kosugi text-[11px] text-text-disabled mt-[6px]">
          {t("wizard.review.elapsed").replace("{seconds}", String(elapsedSeconds))}
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3, ease: EASE_SMOOTH }}
      className="flex flex-col px-4"
    >
      <h2 className="font-mohave text-[28px] font-bold text-text-primary tracking-tight uppercase mb-[8px]">
        {t("wizard.review.headline")}
      </h2>

      {/* Summary line */}
      <p className="font-mohave text-body text-text-secondary mb-[4px]">
        {t("wizard.review.summary")
          .replace("{count}", String(taskTypes.length))
          .replace("{templateCount}", String(totalTemplates))}
      </p>
      {hasDependencies && (
        <p className="font-kosugi text-[11px] text-text-disabled mb-[16px]">
          {t("wizard.review.withDeps")}
        </p>
      )}

      {/* Task type list */}
      <div className="space-y-[6px] mb-[16px] max-h-[280px] overflow-y-auto scrollbar-hide">
        {taskTypes.map((tt) => (
          <div
            key={tt.name}
            className="flex items-center gap-[8px] px-[10px] py-[8px] rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"
          >
            <div
              className="w-[10px] h-[10px] rounded-sm shrink-0"
              style={{ backgroundColor: tt.color }}
            />
            <span className="font-mohave text-body-sm text-text-primary flex-1">
              {tt.name}
            </span>
            {tt.templateCount > 0 && (
              <span className="font-mono text-[10px] text-text-disabled">
                {tt.templateCount} {t("wizard.taskTypes.templates")}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* (#9) Mini dependency timeline */}
      {hasDependencies && dependencyTimeline && dependencyTimeline.length > 1 && (
        <div className="mb-[24px]">
          <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest mb-[6px] block">
            {t("wizard.review.depOrder")}
          </span>
          <div className="flex items-center gap-[4px] flex-wrap">
            {dependencyTimeline.map((item, i) => (
              <div key={item.id} className="flex items-center gap-[4px]">
                <div className="flex items-center gap-[4px] px-[6px] py-[3px] rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                  <div
                    className="w-[8px] h-[8px] rounded-sm shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-kosugi text-[10px] text-text-secondary whitespace-nowrap">
                    {item.name}
                  </span>
                  {item.overlapPercent > 0 && (
                    <span className="font-mono text-[9px] text-text-disabled">
                      {item.overlapPercent}%
                    </span>
                  )}
                </div>
                {i < dependencyTimeline.length - 1 && (
                  <span className="text-text-disabled text-[10px]">&rarr;</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={status === "creating"}
          className="flex items-center gap-[6px] text-text-disabled hover:text-text-secondary font-mohave text-body-sm transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-[14px] h-[14px]" />
          {t("wizard.review.back")}
        </button>

        <button
          type="button"
          onClick={handleCreate}
          disabled={status === "creating" || taskTypes.length === 0}
          className="flex items-center gap-[8px] px-[24px] py-[10px] rounded bg-[#597794] hover:bg-[#6a8ba8] text-white font-mohave text-body-sm transition-colors disabled:opacity-50"
        >
          {status === "creating" ? (
            <>
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
              {t("wizard.review.creating")}
            </>
          ) : (
            t("wizard.review.create")
          )}
        </button>
      </div>
    </motion.div>
  );
}

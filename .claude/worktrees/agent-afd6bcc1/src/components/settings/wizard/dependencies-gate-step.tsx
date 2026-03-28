"use client";

import { motion } from "framer-motion";
import { ArrowRight, SkipForward } from "lucide-react";
import { useDictionary } from "@/i18n/client";

interface DependenciesGateStepProps {
  onYes: () => void;
  onNo: () => void;
}

export function DependenciesGateStep({ onYes, onNo }: DependenciesGateStepProps) {
  const { t } = useDictionary("settings");

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center min-h-[320px] px-4"
    >
      <h2 className="font-mohave text-[28px] font-bold text-text-primary tracking-tight uppercase mb-[8px]">
        {t("wizard.dependencies.headline")}
      </h2>
      <p className="font-mohave text-body text-text-secondary text-center max-w-[400px] mb-[4px]">
        {t("wizard.dependencies.body")}
      </p>
      <p className="font-kosugi text-[11px] text-text-disabled mb-[32px]">
        {t("wizard.dependencies.subtitle")}
      </p>

      <div className="flex gap-[12px]">
        <button
          type="button"
          onClick={onYes}
          className="flex items-center gap-[8px] px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(89,119,148,0.12)] hover:bg-[rgba(89,119,148,0.2)] text-text-primary font-mohave text-body-sm transition-colors"
        >
          {t("wizard.dependencies.yes")}
          <ArrowRight className="w-[14px] h-[14px]" />
        </button>
        <button
          type="button"
          onClick={onNo}
          className="flex items-center gap-[8px] px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] text-text-disabled hover:text-text-secondary font-mohave text-body-sm transition-colors"
        >
          {t("wizard.dependencies.no")}
          <SkipForward className="w-[14px] h-[14px]" />
        </button>
      </div>
    </motion.div>
  );
}

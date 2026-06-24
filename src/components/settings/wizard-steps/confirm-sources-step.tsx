"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, Plus, Mail, Globe, Users, Zap, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import type { AnalysisResult } from "@/lib/types/email-import";
import type { DetectedSource } from "@/lib/api/services/pattern-detection-service";

const EASE = [0.22, 1, 0.36, 1] as const;
const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const staggerItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } } };

const SOURCE_ICONS: Record<string, typeof Mail> = {
  estimate_pattern: Mail,
  platform: Globe,
  forwarder: Users,
  ai_detected: Zap,
};

const SOURCE_DESCRIPTION_KEYS: Record<string, string> = {
  platform: "confirmSources.desc.platform",
  forwarder: "confirmSources.desc.forwarder",
  ai_detected: "confirmSources.desc.ai_detected",
  estimate_pattern: "confirmSources.desc.estimate_pattern",
};

interface ConfirmSourcesStepProps {
  analysisResult: AnalysisResult["result"];
  confirmedSources: DetectedSource[];
  onSourcesChanged: (sources: DetectedSource[]) => void;
  estimatePattern: string;
  onEstimatePatternChanged: (pattern: string) => void;
  onNext: () => void;
}

export function ConfirmSourcesStep({
  analysisResult,
  confirmedSources,
  onSourcesChanged,
  estimatePattern,
  onEstimatePatternChanged,
  onNext,
}: ConfirmSourcesStepProps) {
  const { t } = useDictionary("import-wizard");
  const [editingPattern, setEditingPattern] = useState(false);
  const [patternDraft, setPatternDraft] = useState(estimatePattern);

  if (!analysisResult) return null;

  const toggleSource = (index: number) => {
    const updated = [...confirmedSources];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    onSourcesChanged(updated);
  };

  const enabledCount = confirmedSources.filter((s) => s.enabled).length;
  const totalLeads = analysisResult.leads.length;

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      <motion.p variants={staggerItem} className="font-mohave text-[15px] text-text-2 mb-2">
        {t("confirmSources.summary", { sources: confirmedSources.length, leads: totalLeads })}
      </motion.p>
      <motion.p variants={staggerItem} className="font-mohave text-[12px] text-text-3 mb-6">
        {t("confirmSources.toggleHint")}
      </motion.p>

      {/* Estimate pattern card */}
      {analysisResult.estimatePattern && (
        <motion.div
          variants={staggerItem}
          className="mb-4 p-4 glass-surface border-border rounded-panel"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center bg-surface-hover border border-border rounded">
                <Mail size={14} className="text-text-2" />
              </div>
              <div>
                <p className="font-mono text-micro tracking-[0.15em] uppercase text-text-3">
                  {t("confirmSources.estimatePatternLabel")}
                </p>
                {editingPattern ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={patternDraft}
                      onChange={(e) => setPatternDraft(e.target.value)}
                      className="font-mohave text-[14px] text-text bg-transparent border-b border-border-medium focus:border-ops-accent outline-none py-0.5 w-[280px]"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        onEstimatePatternChanged(patternDraft);
                        setEditingPattern(false);
                      }}
                      className="p-1 text-olive hover:text-text transition-colors"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <p className="font-mohave text-[14px] text-text mt-0.5">
                    &ldquo;{estimatePattern}&rdquo;
                    <span className="text-text-3 text-[12px] ml-2">
                      {t("confirmSources.threads", { count: analysisResult.estimateThreadCount })}
                    </span>
                  </p>
                )}
                <p className="font-mohave text-micro text-text-mute mt-0.5">
                  {t("confirmSources.estimateHelp")}
                </p>
              </div>
            </div>
            {!editingPattern && (
              <button
                onClick={() => setEditingPattern(true)}
                className="p-1.5 text-text-3 hover:text-text transition-colors"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Source cards */}
      <div className="space-y-2">
        {confirmedSources.map((source, i) => {
          const Icon = SOURCE_ICONS[source.type] || Mail;

          return (
            <motion.div
              key={`${source.type}-${source.pattern}-${i}`}
              variants={staggerItem}
              className="flex items-center gap-3 p-3 glass-surface border-border cursor-pointer select-none rounded-panel"
              animate={{ opacity: source.enabled ? 1 : 0.4 }}
              transition={{ duration: 0.2 }}
              onClick={() => toggleSource(i)}
            >
              <div className="w-7 h-7 flex items-center justify-center border border-border rounded">
                <Icon size={14} className="text-text-2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mohave text-[13px] text-text truncate">
                  {source.label}
                </p>
                <p className="font-mohave text-[11px] text-text-3">
                  {t("confirmSources.emailsFound", { count: source.count })}
                </p>
                <p className="font-mohave text-micro text-text-mute mt-0.5">
                  {SOURCE_DESCRIPTION_KEYS[source.type] ? t(SOURCE_DESCRIPTION_KEYS[source.type]) : ""}
                </p>
              </div>
              {source.enabled ? (
                <ToggleRight className="w-[28px] h-[28px] text-text shrink-0" />
              ) : (
                <ToggleLeft className="w-[28px] h-[28px] text-text-mute shrink-0" />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Continue button */}
      <motion.div variants={staggerItem} className="mt-6 flex items-center justify-between">
        <p className="font-mohave text-[12px] text-text-3">
          {t("confirmSources.enabledCount", { enabled: enabledCount, total: confirmedSources.length })}
        </p>
        <Button onClick={onNext} variant="primary" size="default">
          {t("confirmSources.reviewLeads")}
        </Button>
      </motion.div>
    </motion.div>
  );
}

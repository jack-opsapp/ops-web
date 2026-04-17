"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, Plus, Mail, Globe, Users, Zap, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  platform: "Emails from this platform that may contain leads or bid invitations",
  forwarder: "This team member forwards customer inquiries to you",
  ai_detected: "These emails were identified by AI as likely customer conversations",
  estimate_pattern: "Threads where you've sent estimates to potential clients",
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
      <motion.p variants={staggerItem} className="font-mohave text-[15px] text-[#999] mb-2">
        We found {confirmedSources.length} sources and {totalLeads} potential leads.
      </motion.p>
      <motion.p variants={staggerItem} className="font-mohave text-[12px] text-[#666] mb-6">
        Toggle off any sources you want to exclude from the import.
      </motion.p>

      {/* Estimate pattern card */}
      {analysisResult.estimatePattern && (
        <motion.div
          variants={staggerItem}
          className="mb-4 p-4 border border-white/10 bg-glass glass-surface"
          style={{ borderRadius: 3 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center bg-[rgba(255,255,255,0.05)] border border-[#6F94B0]/30" style={{ borderRadius: 2 }}>
                <Mail size={14} className="text-[#6F94B0]" />
              </div>
              <div>
                <p className="font-kosugi text-micro tracking-[0.15em] uppercase text-[#6F94B0]">
                  Estimate Pattern Detected
                </p>
                {editingPattern ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={patternDraft}
                      onChange={(e) => setPatternDraft(e.target.value)}
                      className="font-mohave text-[14px] text-white bg-transparent border-b border-white/20 focus:border-[#6F94B0] outline-none py-0.5 w-[280px]"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        onEstimatePatternChanged(patternDraft);
                        setEditingPattern(false);
                      }}
                      className="p-1 text-[#9DB582] hover:text-white transition-colors"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <p className="font-mohave text-[14px] text-white mt-0.5">
                    &ldquo;{estimatePattern}&rdquo;
                    <span className="text-[#666] text-[12px] ml-2">
                      {analysisResult.estimateThreadCount} threads
                    </span>
                  </p>
                )}
                <p className="font-mohave text-micro text-[#555] mt-0.5">
                  This is the subject line you use when sending estimates to clients. We&apos;ll use it to identify your pipeline conversations.
                </p>
              </div>
            </div>
            {!editingPattern && (
              <button
                onClick={() => setEditingPattern(true)}
                className="p-1.5 text-[#666] hover:text-white transition-colors"
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
              className="flex items-center gap-3 p-3 border border-white/10 bg-glass glass-surface cursor-pointer select-none"
              style={{ borderRadius: 3 }}
              animate={{ opacity: source.enabled ? 1 : 0.4 }}
              transition={{ duration: 0.2 }}
              onClick={() => toggleSource(i)}
            >
              <div
                className="w-7 h-7 flex items-center justify-center border border-white/10"
                style={{ borderRadius: 2 }}
              >
                <Icon size={14} className="text-[#999]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mohave text-[13px] text-white truncate">
                  {source.label}
                </p>
                <p className="font-mohave text-[11px] text-[#666]">
                  {source.count} email{source.count !== 1 ? "s" : ""} found
                </p>
                <p className="font-mohave text-micro text-[#555] mt-0.5">
                  {SOURCE_DESCRIPTIONS[source.type]}
                </p>
              </div>
              {source.enabled ? (
                <ToggleRight className="w-[28px] h-[28px] text-[#6F94B0] shrink-0" />
              ) : (
                <ToggleLeft className="w-[28px] h-[28px] text-[#555] shrink-0" />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Continue button */}
      <motion.div variants={staggerItem} className="mt-6 flex items-center justify-between">
        <p className="font-mohave text-[12px] text-[#666]">
          {enabledCount} of {confirmedSources.length} sources enabled
        </p>
        <Button
          onClick={onNext}
          className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-ops-accent hover:bg-[#6A88A5] text-white px-6 py-2"
          style={{ borderRadius: 3 }}
        >
          Review Leads
        </Button>
      </motion.div>
    </motion.div>
  );
}

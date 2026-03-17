"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalyzedLead } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;
const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const staggerItem = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } } };

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new_lead: { label: "New Lead", color: "#BCBCBC" },
  qualifying: { label: "Qualifying", color: "#8195B5" },
  quoting: { label: "Quoting", color: "#C4A868" },
  quoted: { label: "Quoted", color: "#B5A381" },
  follow_up: { label: "Follow Up", color: "#A182B5" },
  negotiation: { label: "Negotiation", color: "#B58289" },
};

const ALL_STAGES = Object.keys(STAGE_CONFIG);

interface ReviewImportStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  onImport: () => Promise<void>;
  importing: boolean;
}

export function ReviewImportStep({
  leads,
  onLeadsChanged,
  onImport,
  importing,
}: ReviewImportStepProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(
    new Set(ALL_STAGES)
  );

  const grouped = useMemo(() => {
    const groups: Record<string, AnalyzedLead[]> = {};
    for (const stage of ALL_STAGES) {
      groups[stage] = leads.filter((l) => l.stage === stage);
    }
    return groups;
  }, [leads]);

  const enabledCount = leads.filter((l) => l.enabled).length;

  const toggleLead = (leadId: string) => {
    onLeadsChanged(
      leads.map((l) =>
        l.id === leadId ? { ...l, enabled: !l.enabled } : l
      )
    );
  };

  const toggleStage = (stage: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const changeLeadStage = (leadId: string, newStage: string) => {
    onLeadsChanged(
      leads.map((l) =>
        l.id === leadId ? { ...l, stage: newStage } : l
      )
    );
  };

  return (
    <div>
      <p className="font-mohave text-[15px] text-[#999] mb-1">
        {enabledCount} lead{enabledCount !== 1 ? "s" : ""} ready to import
      </p>
      <p className="font-mohave text-[12px] text-[#666] mb-5">
        Toggle off leads you don&apos;t want to import. Change stages if needed.
      </p>

      <div className="relative">
        <div className="space-y-3 max-h-[340px] overflow-y-auto scrollbar-hide pb-8">
          {ALL_STAGES.map((stage) => {
            const stageLeads = grouped[stage];
            if (!stageLeads || stageLeads.length === 0) return null;

            const config = STAGE_CONFIG[stage];
            const isExpanded = expandedStages.has(stage);
            const enabledInStage = stageLeads.filter((l) => l.enabled).length;

            return (
              <div key={stage}>
                {/* Stage header */}
                <button
                  onClick={() => toggleStage(stage)}
                  className="flex items-center gap-2 w-full py-1.5 group"
                >
                  <div
                    className="w-2 h-2"
                    style={{ background: config.color, borderRadius: 1 }}
                  />
                  <span className="font-kosugi text-[9px] tracking-[0.15em] uppercase" style={{ color: config.color }}>
                    {config.label}
                  </span>
                  <span className="font-mohave text-[11px] text-[#666]">
                    ({enabledInStage}/{stageLeads.length})
                  </span>
                  <ChevronDown
                    size={12}
                    className="ml-auto text-[#666] transition-transform duration-200"
                    style={{
                      transform: isExpanded ? "rotate(0)" : "rotate(-90deg)",
                    }}
                  />
                </button>

                {/* Lead cards */}
                {isExpanded && (
                  <motion.div
                    variants={staggerContainer}
                    initial="hidden"
                    animate="show"
                    className="space-y-1 mt-1 ml-4"
                  >
                    {stageLeads.map((lead) => (
                      <motion.div
                        key={lead.id}
                        variants={staggerItem}
                        className="flex items-center gap-3 p-2.5 border border-white/8 bg-[#111] transition-all"
                        style={{
                          borderRadius: 2,
                          opacity: lead.enabled ? 1 : 0.35,
                        }}
                      >
                        {/* Toggle */}
                        <button
                          onClick={() => toggleLead(lead.id)}
                          className="flex-shrink-0 w-4 h-4 border border-white/20 flex items-center justify-center transition-all"
                          style={{
                            borderRadius: 2,
                            background: lead.enabled ? "#597794" : "transparent",
                            borderColor: lead.enabled ? "#597794" : "rgba(255,255,255,0.2)",
                          }}
                        >
                          {lead.enabled && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>

                        {/* Lead info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-mohave text-[13px] text-white truncate">
                            {lead.client.name}
                          </p>
                          <p className="font-mohave text-[11px] text-[#666] truncate">
                            {lead.client.email}
                            {lead.correspondenceCount > 1 && (
                              <span className="ml-2">{lead.correspondenceCount} emails</span>
                            )}
                          </p>
                        </div>

                        {/* Match indicator */}
                        {lead.matchResult.existingClientName && (
                          <span className="font-mohave text-[10px] text-[#C4A868] flex-shrink-0">
                            → {lead.matchResult.existingClientName}
                          </span>
                        )}

                        {/* Stage selector */}
                        <select
                          value={lead.stage}
                          onChange={(e) => changeLeadStage(lead.id, e.target.value)}
                          className="font-mohave text-[11px] text-[#999] bg-transparent border border-white/10 px-1.5 py-0.5 outline-none focus:border-[#597794] flex-shrink-0"
                          style={{ borderRadius: 2 }}
                        >
                          {ALL_STAGES.map((s) => (
                            <option key={s} value={s} className="bg-[#1a1a1a]">
                              {STAGE_CONFIG[s].label}
                            </option>
                          ))}
                        </select>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
        {/* Gradient fade at bottom */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0D0D0D] to-transparent" />
      </div>

      {/* Floating import bar */}
      <div
        className="sticky bottom-0 mt-4 -mx-6 px-6 py-3 flex items-center justify-between border-t border-white/8"
        style={{
          background: 'rgba(13, 13, 13, 0.85)',
          backdropFilter: 'blur(20px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
        }}
      >
        <p className="font-mohave text-[13px] text-[#999]">
          {enabledCount} lead{enabledCount !== 1 ? "s" : ""} selected
        </p>
        <Button
          onClick={onImport}
          disabled={importing || enabledCount === 0}
          className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6 py-2 disabled:opacity-40"
          style={{ borderRadius: 3 }}
        >
          {importing ? (
            <>
              <Loader2 size={14} className="animate-spin mr-2" />
              Importing...
            </>
          ) : (
            `Import ${enabledCount} Lead${enabledCount !== 1 ? "s" : ""}`
          )}
        </Button>
      </div>
    </div>
  );
}

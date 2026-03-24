"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { Button } from "@/components/ui/button";
import { EmailThreadView } from "./email-thread-view";
import { useDictionary } from "@/i18n/client";
import type { AnalyzedLead, ConsolidationGroup, TriageDecision } from "@/lib/types/email-import";

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new_lead: { label: "New Lead", color: "#BCBCBC" },
  qualifying: { label: "Qualifying", color: "#8195B5" },
  quoting: { label: "Quoting", color: "#C4A868" },
  quoted: { label: "Quoted", color: "#B5A381" },
  follow_up: { label: "Follow Up", color: "#A182B5" },
  negotiation: { label: "Negotiation", color: "#B58289" },
  won: { label: "Won", color: "#9DB582" },
  lost: { label: "Lost", color: "#6B7280" },
};

const ALL_STAGES = [
  "new_lead", "qualifying", "quoting", "quoted",
  "follow_up", "negotiation", "won", "lost",
];

const ACTIVE_STAGES = [
  "new_lead", "qualifying", "quoting", "quoted",
  "follow_up", "negotiation",
];

// ─── Component ────────────────────────────────────────────────────────────────

interface ConfirmPipelineStepProps {
  leads: AnalyzedLead[];
  triageDecisions: Map<string, TriageDecision>;
  consolidationGroups: ConsolidationGroup[];
  onStageChange: (leadId: string, stage: string) => void;
  onBack: () => void;
  onImport: () => void;
}

export function ConfirmPipelineStep({
  leads,
  triageDecisions,
  consolidationGroups,
  onStageChange,
  onBack,
  onImport,
}: ConfirmPipelineStepProps) {
  const prefersReduced = useReducedMotion();
  const { t } = useDictionary("import-wizard");

  // Collapsible stage sections
  const [expandedStages, setExpandedStages] = useState<Set<string>>(
    new Set(ACTIVE_STAGES)
  );

  const toggleStage = (stage: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  // Consolidation lookup for display names
  const consolidationLookup = useMemo(() => {
    const map = new Map<string, { companyName: string; title: string }>();
    for (const group of consolidationGroups) {
      if (group.leads.length > 1) {
        for (const gl of group.leads) {
          map.set(gl.leadId, { companyName: group.companyName, title: gl.title });
        }
      }
    }
    return map;
  }, [consolidationGroups]);

  // Compute summary counts
  const counts = useMemo(() => {
    let active = 0;
    let won = 0;
    let lost = 0;
    let discarded = 0;

    for (const lead of leads) {
      if (!lead.enabled) {
        discarded++;
        continue;
      }
      const decision = triageDecisions.get(lead.id);
      if (decision === "discard") {
        discarded++;
      } else if (decision === "won" || lead.stage === "won") {
        won++;
      } else if (decision === "lost" || lead.stage === "lost") {
        lost++;
      } else if (!lead.needsReview) {
        active++;
      }
    }

    return { active, won, lost, discarded, importTotal: active + won + lost };
  }, [leads, triageDecisions]);

  // Active leads grouped by stage (for the list view)
  const activeLeads = useMemo(() => {
    return leads.filter((l) => {
      if (!l.enabled) return false;
      const decision = triageDecisions.get(l.id);
      return decision === "active" || (!decision && !l.needsReview && l.stage !== "won" && l.stage !== "lost");
    });
  }, [leads, triageDecisions]);

  const activeGrouped = useMemo(() => {
    const groups: Record<string, AnalyzedLead[]> = {};
    for (const stage of ACTIVE_STAGES) {
      groups[stage] = activeLeads.filter((l) => l.stage === stage);
    }
    return groups;
  }, [activeLeads]);

  const getDisplayName = (lead: AnalyzedLead) => {
    const consolidated = consolidationLookup.get(lead.id);
    if (consolidated) {
      return consolidated.title
        ? `${consolidated.companyName} — ${consolidated.title}`
        : consolidated.companyName;
    }
    return lead.client.name;
  };

  // ─── Empty state ─────────────────────────────────────────────────────────

  if (counts.importTotal === 0) {
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <p className="font-mohave text-[15px] text-[#999]">
          {t("confirm.noLeads")}
        </p>
        <p className="font-mohave text-[12px] text-[#666]">
          {t("confirm.noLeadsDesc")}
        </p>
        <Button
          onClick={onBack}
          variant="ghost"
          className="font-kosugi text-[10px] tracking-[0.1em] uppercase text-[#666]"
        >
          ← {t("confirm.backToTriage")}
        </Button>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ maxHeight: "calc(85vh - 180px)" }}>
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <h3 className="font-kosugi text-[10px] tracking-[0.15em] uppercase text-[#999]">
          {t("confirm.title")}
        </h3>
        <p className="font-mohave text-[12px] text-[#666] mt-1">
          {t("confirm.description")}
        </p>
      </div>

      {/* Scrollable stage groups */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide relative pb-20">
        <div className="space-y-2">
          {ACTIVE_STAGES.map((stage) => {
            const stageLeads = activeGrouped[stage];
            if (!stageLeads || stageLeads.length === 0) return null;

            const config = STAGE_CONFIG[stage];
            const isExpanded = expandedStages.has(stage);

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
                  <span
                    className="font-kosugi text-[9px] tracking-[0.15em] uppercase"
                    style={{ color: config.color }}
                  >
                    {config.label}
                  </span>
                  <span className="font-mohave text-[11px] text-[#666]">
                    ({stageLeads.length})
                  </span>
                  <ChevronDown
                    size={12}
                    className="ml-auto text-[#666] transition-transform duration-200"
                    style={{
                      transform: isExpanded ? "rotate(0)" : "rotate(-90deg)",
                    }}
                  />
                </button>

                {/* Lead rows */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={prefersReduced ? false : { opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: prefersReduced ? 0 : 0.2, ease: EASE_SMOOTH } }}
                      exit={{ opacity: 0, transition: { duration: prefersReduced ? 0 : 0.15 } }}
                      className="space-y-1 ml-4"
                    >
                      {stageLeads.map((lead) => (
                        <LeadRow
                          key={lead.id}
                          lead={lead}
                          displayName={getDisplayName(lead)}
                          onStageChange={(s) => onStageChange(lead.id, s)}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Sticky summary bar */}
        <div
          className="sticky bottom-0 -mx-4 px-4 py-3 flex items-center justify-between border-t border-white/8 mt-4"
          style={{
            background: "rgba(10, 10, 10, 0.90)",
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
            zIndex: 10,
          }}
        >
          <div className="flex items-center gap-3">
            <span className="font-mohave text-[12px] text-[#999]">
              {counts.active} {t("summary.active")}
            </span>
            <span className="font-mohave text-[12px] text-[#9DB582]">
              {counts.won} {t("summary.won")}
            </span>
            <span className="font-mohave text-[12px] text-[#6B7280]">
              {counts.lost} {t("summary.lost")}
            </span>
            <span className="font-mohave text-[12px] text-[#444]">
              {counts.discarded} {t("summary.discarded")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={onBack}
              variant="ghost"
              className="font-kosugi text-[10px] tracking-[0.1em] uppercase text-[#666] px-3 py-1.5"
            >
              ← {t("confirm.back")}
            </Button>
            <Button
              onClick={onImport}
              disabled={counts.importTotal === 0}
              className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6 py-2 disabled:opacity-40"
              style={{ borderRadius: 3 }}
            >
              {t("confirm.import")} {counts.importTotal} LEAD{counts.importTotal !== 1 ? "S" : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lead row ─────────────────────────────────────────────────────────────────

function LeadRow({
  lead,
  displayName,
  onStageChange,
}: {
  lead: AnalyzedLead;
  displayName: string;
  onStageChange: (stage: string) => void;
}) {
  return (
    <div
      className="py-2 px-2.5 border border-white/5"
      style={{ borderRadius: 2 }}
    >
      <div className="flex items-center gap-3">
        {/* Name */}
        <span className="font-mohave text-[12px] text-white flex-1 truncate">
          {displayName}
        </span>

        {/* Stage dropdown — includes won/lost for reclassification */}
        <select
          value={lead.stage}
          onChange={(e) => onStageChange(e.target.value)}
          className="font-mohave text-[11px] bg-transparent border border-white/10 px-1.5 py-0.5 outline-none focus:border-[#597794] flex-shrink-0"
          style={{
            borderRadius: 4,
            color: STAGE_CONFIG[lead.stage]?.color || "#999",
          }}
        >
          {ALL_STAGES.map((s) => (
            <option key={s} value={s} className="bg-[#1a1a1a]">
              {STAGE_CONFIG[s].label}
            </option>
          ))}
        </select>
      </div>

      {/* Expandable thread */}
      <div className="mt-1.5">
        <EmailThreadView lead={lead} />
      </div>
    </div>
  );
}

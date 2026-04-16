"use client";

import { useState, useMemo, useRef, useEffect } from "react";
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
  discarded: { label: "Discarded", color: "#444444" },
};

const ALL_STAGES = [
  "new_lead", "qualifying", "quoting", "quoted",
  "follow_up", "negotiation", "won", "lost", "discarded",
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
  onNameChange: (leadId: string, name: string) => void;
  onBack: () => void;
  onImport: () => void;
}

export function ConfirmPipelineStep({
  leads,
  triageDecisions,
  consolidationGroups,
  onStageChange,
  onNameChange,
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

  // Consolidation lookup for display names and sibling leads
  const consolidationLookup = useMemo(() => {
    const map = new Map<string, { companyName: string; title: string; siblingLeadIds: string[] }>();
    for (const group of consolidationGroups) {
      if (group.leads.length > 1) {
        const allLeadIds = group.leads.map((gl) => gl.leadId);
        for (const gl of group.leads) {
          map.set(gl.leadId, { companyName: group.companyName, title: gl.title, siblingLeadIds: allLeadIds });
        }
      }
    }
    return map;
  }, [consolidationGroups]);

  // Lookup from lead ID → full lead data (for resolving sibling threads)
  const leadsById = useMemo(() => {
    const map = new Map<string, AnalyzedLead>();
    for (const lead of leads) map.set(lead.id, lead);
    return map;
  }, [leads]);

  // Resolve effective stage: triage decision overrides AI's original assessment
  const getEffectiveStage = (lead: AnalyzedLead): string => {
    if (!lead.enabled) return "discarded";
    const decision = triageDecisions.get(lead.id);
    if (decision === "discard") return "discarded";
    if (decision === "won") return "won";
    if (decision === "lost") return "lost";
    if (decision === "active") {
      // "active" triage means keep the AI stage, but ensure it's not terminal
      return lead.stage === "won" || lead.stage === "lost" || lead.stage === "discarded"
        ? "new_lead"
        : lead.stage;
    }
    // No triage decision — use lead's own stage
    return lead.stage;
  };

  // Compute summary counts
  const counts = useMemo(() => {
    let active = 0;
    let won = 0;
    let lost = 0;
    let discarded = 0;

    for (const lead of leads) {
      if (lead.needsReview && !triageDecisions.has(lead.id)) continue;
      const effective = getEffectiveStage(lead);
      if (effective === "discarded") discarded++;
      else if (effective === "won") won++;
      else if (effective === "lost") lost++;
      else active++;
    }

    return { active, won, lost, discarded, importTotal: active + won + lost + discarded };
  }, [leads, triageDecisions]); // eslint-disable-line react-hooks/exhaustive-deps

  // All leads grouped by their effective stage (including discarded)
  const stageGrouped = useMemo(() => {
    const groups: Record<string, AnalyzedLead[]> = {};
    for (const stage of ALL_STAGES) {
      groups[stage] = [];
    }
    for (const lead of leads) {
      if (!lead.enabled && getEffectiveStage(lead) !== "discarded") continue;
      if (lead.needsReview && !triageDecisions.has(lead.id)) continue;
      const effective = getEffectiveStage(lead);
      if (groups[effective]) {
        groups[effective].push(lead);
      }
    }
    return groups;
  }, [leads, triageDecisions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discarded leads for the separate section
  const discardedLeads = useMemo(() => {
    return stageGrouped["discarded"] ?? [];
  }, [stageGrouped]);

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
      <div
        className="flex-1 min-h-0 overflow-y-auto scrollbar-hide overscroll-contain"
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0%, black 8px, black calc(100% - 8px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 8px, black calc(100% - 8px), transparent 100%)",
        }}
      >
        <div className="space-y-2 pb-2">
          {ALL_STAGES.filter((s) => s !== "discarded").map((stage) => {
            const stageLeads = stageGrouped[stage];
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
                      <AnimatePresence initial={false}>
                        {stageLeads.map((lead) => (
                          <motion.div
                            key={lead.id}
                            layout={!prefersReduced}
                            initial={prefersReduced ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto", transition: { height: { duration: 0.25, ease: EASE_SMOOTH }, opacity: { duration: 0.2, ease: EASE_SMOOTH, delay: 0.05 } } }}
                            exit={{ opacity: 0, height: 0, transition: { opacity: { duration: 0.15, ease: EASE_SMOOTH }, height: { duration: 0.2, ease: EASE_SMOOTH, delay: 0.08 } } }}
                            className="overflow-hidden"
                          >
                            <LeadRow
                              lead={lead}
                              displayName={getDisplayName(lead)}
                              effectiveStage={getEffectiveStage(lead)}
                              onStageChange={(s) => onStageChange(lead.id, s)}
                              onNameChange={(name) => onNameChange(lead.id, name)}
                              siblingLeads={(() => {
                                const c = consolidationLookup.get(lead.id);
                                if (!c) return undefined;
                                return c.siblingLeadIds
                                  .filter((id) => id !== lead.id)
                                  .map((id) => leadsById.get(id))
                                  .filter((l): l is AnalyzedLead => !!l);
                              })()}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Discarded section — separated from active stages */}
          {discardedLeads.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <button
                onClick={() => toggleStage("_discarded")}
                className="flex items-center gap-2 w-full py-1.5 group"
              >
                <div
                  className="w-2 h-2"
                  style={{ background: "#444", borderRadius: 1, opacity: 0.6 }}
                />
                <span className="font-kosugi text-[9px] tracking-[0.15em] uppercase text-[#555]">
                  Discarded
                </span>
                <span className="font-mohave text-[11px] text-[#444]">
                  ({discardedLeads.length})
                </span>
                <span className="font-mohave text-[10px] text-[#444] ml-1">
                  — won&apos;t be imported
                </span>
                <ChevronDown
                  size={12}
                  className="ml-auto text-[#444] transition-transform duration-200"
                  style={{
                    transform: expandedStages.has("_discarded") ? "rotate(0)" : "rotate(-90deg)",
                  }}
                />
              </button>

              <AnimatePresence>
                {expandedStages.has("_discarded") && (
                  <motion.div
                    initial={prefersReduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: prefersReduced ? 0 : 0.2, ease: EASE_SMOOTH } }}
                    exit={{ opacity: 0, transition: { duration: prefersReduced ? 0 : 0.15 } }}
                    className="space-y-1 ml-4"
                  >
                    <AnimatePresence initial={false}>
                    {discardedLeads.map((lead) => (
                      <motion.div
                        key={lead.id}
                        layout={!prefersReduced}
                        initial={prefersReduced ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 0.5, height: "auto", transition: { height: { duration: 0.25, ease: EASE_SMOOTH }, opacity: { duration: 0.2, ease: EASE_SMOOTH, delay: 0.05 } } }}
                        exit={{ opacity: 0, height: 0, transition: { opacity: { duration: 0.15, ease: EASE_SMOOTH }, height: { duration: 0.2, ease: EASE_SMOOTH, delay: 0.08 } } }}
                        className="overflow-hidden"
                      >
                      <div
                        className="py-2 px-3 border border-white/[0.03]"
                        style={{ borderRadius: 2 }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <span className="font-mohave text-[13px] text-[#666] truncate block">
                              {getDisplayName(lead)}
                            </span>
                            {lead.client.email && (
                              <span className="font-mohave text-[11px] text-[#444] truncate block mt-0.5">
                                {lead.client.email}
                              </span>
                            )}
                          </div>
                          {/* Allow restoring — changing stage removes from discarded */}
                          <select
                            value="discarded"
                            onChange={(e) => {
                              // Re-enable the lead and set its stage
                              onStageChange(lead.id, e.target.value);
                            }}
                            className="font-mohave text-[11px] bg-transparent border border-white/[0.06] px-1.5 py-0.5 outline-none focus:border-[#597794] flex-shrink-0 text-[#555]"
                            style={{ borderRadius: 4 }}
                          >
                            <option value="discarded" className="bg-[#1a1a1a]">
                              Discarded
                            </option>
                            {ALL_STAGES.filter((s) => s !== "discarded").map((s) => (
                              <option key={s} value={s} className="bg-[#1a1a1a]">
                                {STAGE_CONFIG[s].label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      </motion.div>
                    ))}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Footer — outside scroll container, always anchored at bottom */}
      <div
        className="flex-shrink-0 border-t border-white/8 pt-3 mt-1"
      >
        {/* Summary counts */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#999]" />
            <span className="font-mohave text-[12px] text-[#999]">
              {counts.active} {t("summary.active")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#9DB582]" />
            <span className="font-mohave text-[12px] text-[#9DB582]">
              {counts.won} {t("summary.won")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#6B7280]" />
            <span className="font-mohave text-[12px] text-[#6B7280]">
              {counts.lost} {t("summary.lost")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#444]" />
            <span className="font-mohave text-[12px] text-[#444]">
              {counts.discarded} {t("summary.discarded")}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="font-kosugi text-[10px] tracking-[0.1em] uppercase text-[#666] hover:text-[#999] transition-colors"
          >
            ← {t("confirm.back")}
          </button>
          <button
            onClick={onImport}
            disabled={counts.importTotal === 0}
            className="font-kosugi text-[10px] tracking-[0.1em] uppercase border border-[#597794] text-[#597794] hover:bg-ops-accent hover:text-white px-4 py-1.5 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            style={{ borderRadius: 3 }}
          >
            {t("confirm.import")} {counts.importTotal}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lead row ─────────────────────────────────────────────────────────────────

function LeadRow({
  lead,
  displayName,
  effectiveStage,
  onStageChange,
  onNameChange,
  siblingLeads,
}: {
  lead: AnalyzedLead;
  displayName: string;
  effectiveStage: string;
  onStageChange: (stage: string) => void;
  onNameChange: (name: string) => void;
  siblingLeads?: AnalyzedLead[];
}) {
  return (
    <div
      className="py-2.5 px-3 border border-white/5"
      style={{ borderRadius: 2 }}
    >
      <div className="flex items-center gap-3">
        {/* Name + metadata */}
        <div className="flex-1 min-w-0">
          <InlineEditableName
            value={displayName}
            onChange={onNameChange}
          />
          {(lead.client.address || lead.client.description) && (
            <span className="font-mohave text-[11px] text-[#777] truncate block mt-0.5">
              {lead.client.address && <span>{lead.client.address}</span>}
              {lead.client.address && lead.client.description && <span> · </span>}
              {lead.client.description && <span>{lead.client.description}</span>}
            </span>
          )}
        </div>

        {/* Stage dropdown — uses effective stage (triage decision overrides AI) */}
        <select
          value={effectiveStage}
          onChange={(e) => onStageChange(e.target.value)}
          className="font-mohave text-[11px] bg-transparent border border-white/10 px-1.5 py-0.5 outline-none focus:border-[#597794] flex-shrink-0"
          style={{
            borderRadius: 4,
            color: STAGE_CONFIG[effectiveStage]?.color || "#999",
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
        <EmailThreadView lead={lead} siblingLeads={siblingLeads} />
      </div>
    </div>
  );
}

// ─── Inline editable name ────────────────────────────────────────────────────

function InlineEditableName({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
          e.stopPropagation();
        }}
        className="font-mohave text-[13px] text-white bg-transparent border-b border-[#597794] outline-none w-full truncate"
        style={{ borderRadius: 0 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-mohave text-[13px] text-white text-left hover:text-[#597794] transition-colors cursor-text truncate block w-full"
      title="Click to edit"
    >
      {value}
    </button>
  );
}

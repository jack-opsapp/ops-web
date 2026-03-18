"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Loader2,
  AlertTriangle,
  Trophy,
  XCircle,
  Scale,
  Briefcase,
  Receipt,
  Hammer,
  Wrench,
  HelpCircle,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalyzedLead } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;
const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

// ─── Stage configuration ─────────────────────────────────────────────────────

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

const ACTIVE_STAGES = ["new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation"];
const ALL_STAGES_WITH_TERMINAL = [...ACTIVE_STAGES, "won", "lost"];

// ─── Review reason configuration ─────────────────────────────────────────────

const REVIEW_REASON_CONFIG: Record<string, { label: string; description: string; icon: typeof Scale }> = {
  legal: {
    label: "Legal",
    description: "Settlement, dispute, or lawyer correspondence",
    icon: Scale,
  },
  job_seeker: {
    label: "Job Seeker",
    description: "Someone looking for work or employment",
    icon: Briefcase,
  },
  collections: {
    label: "Collections",
    description: "Invoice dispute or overdue payment follow-up",
    icon: Receipt,
  },
  platform_bid: {
    label: "Platform Bid",
    description: "Bid invitation from Procore, Buildertrend, etc.",
    icon: Globe,
  },
  warranty: {
    label: "Warranty",
    description: "Past client reporting an issue after completion",
    icon: Wrench,
  },
  ambiguous: {
    label: "Ambiguous",
    description: "Relationship direction is unclear",
    icon: HelpCircle,
  },
};

// ─── Lead card (shared across all sections) ──────────────────────────────────

interface LeadCardProps {
  lead: AnalyzedLead;
  onToggle: () => void;
  onStageChange: (stage: string) => void;
  variant?: "active" | "review" | "terminal";
}

function LeadCard({ lead, onToggle, onStageChange, variant = "active" }: LeadCardProps) {
  const isReview = variant === "review";
  const isTerminal = variant === "terminal";

  // Border tint for review/terminal cards
  const borderColor = isReview
    ? "rgba(196, 168, 104, 0.15)"
    : isTerminal
      ? lead.stage === "won"
        ? "rgba(157, 181, 130, 0.15)"
        : "rgba(107, 114, 128, 0.15)"
      : "rgba(255, 255, 255, 0.08)";

  return (
    <motion.div
      variants={staggerItem}
      className="p-2.5 bg-[#111] transition-all"
      style={{
        borderRadius: 2,
        opacity: lead.enabled ? 1 : 0.35,
        border: `1px solid ${borderColor}`,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Toggle checkbox */}
        <button
          onClick={onToggle}
          className="flex-shrink-0 w-4 h-4 border flex items-center justify-center transition-all"
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
          <div className="flex items-center gap-2">
            <p className="font-mohave text-[13px] text-white truncate">
              {lead.client.name}
            </p>
            {lead.subContacts && lead.subContacts.length > 0 && (
              <span className="font-mohave text-[10px] text-[#555]">
                +{lead.subContacts.length} contact{lead.subContacts.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
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
            &rarr; {lead.matchResult.existingClientName}
          </span>
        )}

        {/* Stage selector — show all stages including won/lost */}
        <select
          value={lead.stage}
          onChange={(e) => onStageChange(e.target.value)}
          className="font-mohave text-[11px] bg-transparent border border-white/10 px-1.5 py-0.5 outline-none focus:border-[#597794] flex-shrink-0"
          style={{
            borderRadius: 2,
            color: STAGE_CONFIG[lead.stage]?.color || "#999",
          }}
        >
          {ALL_STAGES_WITH_TERMINAL.map((s) => (
            <option key={s} value={s} className="bg-[#1a1a1a]">
              {STAGE_CONFIG[s].label}
            </option>
          ))}
        </select>
      </div>

      {/* Review reason badge */}
      {isReview && lead.reviewReason && REVIEW_REASON_CONFIG[lead.reviewReason] && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2">
            {(() => {
              const config = REVIEW_REASON_CONFIG[lead.reviewReason!];
              const Icon = config.icon;
              return (
                <>
                  <Icon size={11} className="text-[#C4A868] flex-shrink-0" />
                  <span className="font-kosugi text-[8px] tracking-[0.1em] uppercase text-[#C4A868]">
                    {config.label}
                  </span>
                  <span className="font-mohave text-[10px] text-[#666]">
                    {config.description}
                  </span>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Terminal flag indicator */}
      {isTerminal && lead.terminalFlag && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2">
            {lead.terminalFlag === "likely_won" ? (
              <>
                <Trophy size={11} className="text-[#9DB582] flex-shrink-0" />
                <span className="font-mohave text-[10px] text-[#9DB582]">
                  Agent detected likely won — correspondence suggests work was completed
                </span>
              </>
            ) : (
              <>
                <XCircle size={11} className="text-[#6B7280] flex-shrink-0" />
                <span className="font-mohave text-[10px] text-[#6B7280]">
                  Agent detected likely lost — client appears to have gone elsewhere
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

interface SectionHeaderProps {
  icon: typeof AlertTriangle;
  iconColor: string;
  label: string;
  count: number;
  enabledCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionHeader({ icon: Icon, iconColor, label, count, enabledCount, isExpanded, onToggle }: SectionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full py-2 group"
    >
      <Icon size={13} style={{ color: iconColor }} className="flex-shrink-0" />
      <span className="font-kosugi text-[9px] tracking-[0.15em] uppercase" style={{ color: iconColor }}>
        {label}
      </span>
      <span className="font-mohave text-[11px] text-[#666]">
        ({enabledCount}/{count})
      </span>
      <ChevronDown
        size={12}
        className="ml-auto text-[#666] transition-transform duration-200"
        style={{
          transform: isExpanded ? "rotate(0)" : "rotate(-90deg)",
        }}
      />
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

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
  // Track which sections/stages are expanded
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["review", "terminal", ...ACTIVE_STAGES])
  );

  // ─── Partition leads into 3 groups ────────────────────────────────────────

  const { reviewLeads, terminalLeads, activeLeads } = useMemo(() => {
    const review: AnalyzedLead[] = [];
    const terminal: AnalyzedLead[] = [];
    const active: AnalyzedLead[] = [];

    for (const lead of leads) {
      if (lead.needsReview) {
        review.push(lead);
      } else if (lead.terminalFlag || lead.stage === "won" || lead.stage === "lost") {
        terminal.push(lead);
      } else {
        active.push(lead);
      }
    }

    return { reviewLeads: review, terminalLeads: terminal, activeLeads: active };
  }, [leads]);

  // Group active leads by stage
  const activeGrouped = useMemo(() => {
    const groups: Record<string, AnalyzedLead[]> = {};
    for (const stage of ACTIVE_STAGES) {
      groups[stage] = activeLeads.filter((l) => l.stage === stage);
    }
    return groups;
  }, [activeLeads]);

  const enabledCount = leads.filter((l) => l.enabled).length;

  // ─── Actions ──────────────────────────────────────────────────────────────

  const toggleLead = (leadId: string) => {
    onLeadsChanged(
      leads.map((l) =>
        l.id === leadId ? { ...l, enabled: !l.enabled } : l
      )
    );
  };

  const changeLeadStage = (leadId: string, newStage: string) => {
    onLeadsChanged(
      leads.map((l) =>
        l.id === leadId ? { ...l, stage: newStage } : l
      )
    );
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <p className="font-mohave text-[15px] text-[#999] mb-1">
        {enabledCount} lead{enabledCount !== 1 ? "s" : ""} ready to import
      </p>
      <p className="font-mohave text-[12px] text-[#666] mb-5">
        Review flagged items first, then confirm your leads. Toggle off anything you don&apos;t want.
      </p>

      <div className="relative">
        <div className="space-y-3 max-h-[340px] overflow-y-auto scrollbar-hide pb-8">

          {/* ─── Section 1: Review Items ──────────────────────────────────── */}
          {reviewLeads.length > 0 && (
            <div>
              <SectionHeader
                icon={AlertTriangle}
                iconColor="#C4A868"
                label="Needs your review"
                count={reviewLeads.length}
                enabledCount={reviewLeads.filter((l) => l.enabled).length}
                isExpanded={expandedSections.has("review")}
                onToggle={() => toggleSection("review")}
              />
              <p className="font-mohave text-[10px] text-[#666] ml-5 -mt-1 mb-1.5">
                Flagged by the agent — not standard client leads but may be worth importing
              </p>

              {expandedSections.has("review") && (
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                  className="space-y-1 mt-1 ml-5"
                >
                  {reviewLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onToggle={() => toggleLead(lead.id)}
                      onStageChange={(s) => changeLeadStage(lead.id, s)}
                      variant="review"
                    />
                  ))}
                </motion.div>
              )}
            </div>
          )}

          {/* ─── Section 2: Terminal Leads (Won/Lost) ─────────────────────── */}
          {terminalLeads.length > 0 && (
            <div>
              <SectionHeader
                icon={Hammer}
                iconColor="#9DB582"
                label="Already won or lost"
                count={terminalLeads.length}
                enabledCount={terminalLeads.filter((l) => l.enabled).length}
                isExpanded={expandedSections.has("terminal")}
                onToggle={() => toggleSection("terminal")}
              />
              <p className="font-mohave text-[10px] text-[#666] ml-5 -mt-1 mb-1.5">
                The agent identified these as already closed — confirm or change the stage
              </p>

              {expandedSections.has("terminal") && (
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                  className="space-y-1 mt-1 ml-5"
                >
                  {terminalLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onToggle={() => toggleLead(lead.id)}
                      onStageChange={(s) => changeLeadStage(lead.id, s)}
                      variant="terminal"
                    />
                  ))}
                </motion.div>
              )}
            </div>
          )}

          {/* ─── Divider between flagged sections and active leads ─────────── */}
          {(reviewLeads.length > 0 || terminalLeads.length > 0) && activeLeads.length > 0 && (
            <div className="border-t border-white/5 my-1" />
          )}

          {/* ─── Section 3: Active Leads (grouped by stage) ───────────────── */}
          {ACTIVE_STAGES.map((stage) => {
            const stageLeads = activeGrouped[stage];
            if (!stageLeads || stageLeads.length === 0) return null;

            const config = STAGE_CONFIG[stage];
            const isExpanded = expandedSections.has(stage);
            const enabledInStage = stageLeads.filter((l) => l.enabled).length;

            return (
              <div key={stage}>
                <button
                  onClick={() => toggleSection(stage)}
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

                {isExpanded && (
                  <motion.div
                    variants={staggerContainer}
                    initial="hidden"
                    animate="show"
                    className="space-y-1 mt-1 ml-4"
                  >
                    {stageLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onToggle={() => toggleLead(lead.id)}
                        onStageChange={(s) => changeLeadStage(lead.id, s)}
                        variant="active"
                      />
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

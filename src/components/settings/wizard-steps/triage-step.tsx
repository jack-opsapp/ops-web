"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { CardCarousel, type CarouselItem, type CarouselDecision } from "./card-carousel";
import { EmailThreadView, formatRelativeDate } from "./email-thread-view";
import { useDictionary } from "@/i18n/client";
import type { AnalyzedLead, ConsolidationGroup, TriageDecision } from "@/lib/types/email-import";

// ─── Heuristics ───────────────────────────────────────────────────────────────
//
// The spec describes heuristics in terms of email content analysis (quote/price
// language, booking language). The scan data does NOT contain full bodies — only
// metadata (dates, counts, direction) and estimatedValue. These heuristics are
// approximations using available data:
// - estimatedValue → proxy for "quote was sent"
// - outboundCount >= 2 → proxy for "ongoing engagement that likely concluded"

function computeTriageDefault(lead: AnalyzedLead): TriageDecision {
  // High confidence: AI terminal flags
  if (lead.terminalFlag === "likely_won" || lead.stage === "won") return "won";
  if (lead.terminalFlag === "likely_lost" || lead.stage === "lost") return "lost";

  const lastDate = lead.lastMessageDate ? new Date(lead.lastMessageDate) : null;
  if (!lastDate || isNaN(lastDate.getTime())) return "active";
  const daysSinceLast = Math.floor(
    (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Medium confidence: time-based heuristics
  if (daysSinceLast > 30) {
    // Old thread with outbound quote → likely won (silence = acceptance in trades)
    if (lead.outboundCount > 0 && lead.estimatedValue) return "won";
    // Old thread, last message inbound with no reply → likely lost
    const lastExcerpt = [...(lead.emailExcerpts ?? [])].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];
    if (lastExcerpt?.direction === "inbound") return "lost";
  }

  if (daysSinceLast > 21 && lead.outboundCount >= 2) {
    return "won"; // likely booked and completed
  }

  return "active";
}

// ─── Decision colors ──────────────────────────────────────────────────────────

const DECISION_COLORS: Record<TriageDecision, string> = {
  won: "#9DB582",
  lost: "#6B7280",
  active: "#597794",
  discard: "#444",
};

const DECISION_LABELS: Record<TriageDecision, string> = {
  won: "WON",
  lost: "LOST",
  active: "ACTIVE",
  discard: "DISCARD",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface TriageStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  triageDecisions: Map<string, TriageDecision>;
  onTriageDecision: (leadId: string, decision: TriageDecision) => void;
  consolidationGroups: ConsolidationGroup[];
  onComplete: () => void;
  onBack?: () => void;
}

export function TriageStep({
  leads,
  onLeadsChanged,
  triageDecisions,
  onTriageDecision,
  consolidationGroups,
  onComplete,
  onBack,
}: TriageStepProps) {
  const { t } = useDictionary("import-wizard");

  // Only enabled, non-flagged leads (those that passed sub-step 1)
  const triageLeads = useMemo(
    () => leads.filter((l) => l.enabled && !l.needsReview),
    [leads]
  );

  // Build lookups for consolidated data: company name, title, all contacts, and sibling leads
  const consolidationLookup = useMemo(() => {
    const map = new Map<string, { companyName: string; title: string; allContacts: Array<{ name: string; email: string }>; siblingLeadIds: string[] }>();
    for (const group of consolidationGroups) {
      if (group.leads.length > 1) {
        const allContacts = group.contacts.map((c) => ({ name: c.name, email: c.email }));
        const allLeadIds = group.leads.map((gl) => gl.leadId);
        for (const gl of group.leads) {
          map.set(gl.leadId, {
            companyName: group.companyName,
            title: gl.title,
            allContacts,
            siblingLeadIds: allLeadIds,
          });
        }
      }
    }
    return map;
  }, [consolidationGroups]);

  // Build a lookup from lead ID → full lead data (for resolving sibling threads)
  const leadsById = useMemo(() => {
    const map = new Map<string, AnalyzedLead>();
    for (const lead of leads) {
      map.set(lead.id, lead);
    }
    return map;
  }, [leads]);

  // Build carousel items with AI defaults
  const items: CarouselItem<AnalyzedLead>[] = useMemo(
    () =>
      triageLeads.map((lead) => {
        const aiDefault = computeTriageDefault(lead);
        const existing = triageDecisions.get(lead.id);
        // defaultAction = user's pick if revisiting, otherwise AI suggestion
        const effectiveDecision = existing || aiDefault;
        const actionKey =
          effectiveDecision === "won"
            ? "1"
            : effectiveDecision === "lost"
              ? "2"
              : effectiveDecision === "discard"
                ? "4"
                : "3"; // active
        // aiDefaultAction = always the AI's original suggestion (never overwritten)
        const aiActionKey =
          aiDefault === "won"
            ? "1"
            : aiDefault === "lost"
              ? "2"
              : "3"; // active

        return {
          id: lead.id,
          data: lead,
          defaultAction: actionKey,
          aiDefaultAction: aiActionKey,
        };
      }),
    [triageLeads, triageDecisions]
  );

  const applyDecision = useCallback(
    (leadId: string, decision: TriageDecision): CarouselDecision => {
      onTriageDecision(leadId, decision);
      return { label: DECISION_LABELS[decision], color: DECISION_COLORS[decision] };
    },
    [onTriageDecision]
  );

  const actions = useMemo(
    () => ({
      "1": (item: CarouselItem<AnalyzedLead>): CarouselDecision =>
        applyDecision(item.id, "won"),
      "2": (item: CarouselItem<AnalyzedLead>): CarouselDecision =>
        applyDecision(item.id, "lost"),
      "3": (item: CarouselItem<AnalyzedLead>): CarouselDecision =>
        applyDecision(item.id, "active"),
      "4": (item: CarouselItem<AnalyzedLead>): CarouselDecision =>
        applyDecision(item.id, "discard"),
      Backspace: (item: CarouselItem<AnalyzedLead>): CarouselDecision =>
        applyDecision(item.id, "discard"),
    }),
    [applyDecision]
  );

  return (
    <CardCarousel
      title={t("triage.title")}
      items={items}
      actions={actions}
      onComplete={onComplete}
      onBack={onBack}
      keyboardHint={t("triage.hint")}
      wheelNavigation
      renderCard={(item, focused, _setDecision, triggerAction, highlightedKey, threadToggle, onThreadToggle, hideBadge) => {
        const lead = item.data;
        const consolidated = consolidationLookup.get(lead.id);
        const displayName = consolidated
          ? `${consolidated.companyName}${consolidated.title ? ` — ${consolidated.title}` : ""}`
          : lead.client.name;

        const defaultDecision = computeTriageDefault(lead);

        return (
          <div className="space-y-3">
            {/* Lead identity — inline editable name */}
            <div className="flex items-start justify-between gap-3">
            <div>
              <InlineEditableText
                value={displayName}
                onChange={(name) => {
                  onLeadsChanged(
                    leads.map((l) =>
                      l.id === lead.id
                        ? { ...l, client: { ...l.client, name: name } }
                        : l
                    )
                  );
                }}
                className="font-mohave text-[18px] text-white leading-tight"
              />
              {/* Show all contacts when consolidated, otherwise just the primary email */}
              {consolidated && consolidated.allContacts.length > 1 ? (
                <div className="mt-1 space-y-0.5">
                  {consolidated.allContacts.map((c) => (
                    <p key={c.email} className="font-mohave text-[13px] text-[#888]">
                      {c.name} · {c.email}
                    </p>
                  ))}
                  {lead.correspondenceCount > 1 && (
                    <p className="font-mohave text-[13px] text-[#666] mt-1">
                      {lead.correspondenceCount} emails total
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  <p className="font-mohave text-[14px] text-[#888]">
                    {lead.client.email}
                    {lead.correspondenceCount > 1 && (
                      <span className="ml-2">
                        · {lead.correspondenceCount} emails
                      </span>
                    )}
                  </p>
                  {lead.client.phone && (
                    <p className="font-mohave text-[13px] text-[#777]">
                      {lead.client.phone}
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2">
                {lead.client.address && (
                  <span className="font-mohave text-[13px] text-[#999]">
                    {lead.client.address}
                  </span>
                )}
                {lead.lastMessageDate && (
                  <span className="font-mohave text-[13px] text-[#777]">
                    Last: {formatRelativeDate(lead.lastMessageDate)}
                  </span>
                )}
                {lead.estimatedValue && (
                  <span className="font-mohave text-[13px] text-[#C4A868]">
                    ${lead.estimatedValue.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* AI suggestion badge — inline, top right (hidden on prev peek cards) */}
            {!hideBadge && defaultDecision !== "active" && (
              <div
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 border"
                style={{
                  borderRadius: 4,
                  borderColor: `${DECISION_COLORS[defaultDecision]}30`,
                  color: DECISION_COLORS[defaultDecision],
                }}
              >
                <span className="font-kosugi text-[9px] tracking-[0.1em] uppercase whitespace-nowrap">
                  {t("triage.agentSuggests")}: {DECISION_LABELS[defaultDecision]}
                </span>
              </div>
            )}
            </div>

            {/* Email thread */}
            <EmailThreadView
              lead={lead}
              siblingLeads={(() => {
                const consolidated = consolidationLookup.get(lead.id);
                if (!consolidated) return undefined;
                return consolidated.siblingLeadIds
                  .filter((id) => id !== lead.id)
                  .map((id) => leadsById.get(id))
                  .filter((l): l is AnalyzedLead => !!l);
              })()}
              keyboardEnabled
              toggleSignal={threadToggle}
              onToggle={onThreadToggle}
            />

            {/* Action buttons — only on focused card */}
            {focused && <div className="flex items-center gap-1.5 pt-3 pb-1 sticky bottom-0 -mx-4 px-2 -mb-4">
              <button
                onClick={() => triggerAction("1")}
                className="flex-1 py-1.5 font-kosugi text-[10px] tracking-[0.1em] uppercase border transition-colors flex items-center justify-center gap-1.5"
                style={{
                  borderRadius: 4,
                  borderColor: highlightedKey === "1" ? "#9DB582" : "rgba(157, 181, 130, 0.3)",
                  color: "#9DB582",
                  background: highlightedKey === "1" ? "rgb(20, 26, 18)" : "rgba(10, 10, 10, 0.90)",
                }}
              >
                <kbd className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-[2px] border border-current text-[9px] font-mono leading-none opacity-60">1</kbd>
                {t("triage.won")}
              </button>
              <button
                onClick={() => triggerAction("2")}
                className="flex-1 py-1.5 font-kosugi text-[10px] tracking-[0.1em] uppercase border transition-colors flex items-center justify-center gap-1.5"
                style={{
                  borderRadius: 4,
                  borderColor: highlightedKey === "2" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)",
                  color: highlightedKey === "2" ? "#aaa" : "#888",
                  background: highlightedKey === "2" ? "rgba(255, 255, 255, 0.08)" : "rgba(10, 10, 10, 0.90)",
                }}
              >
                <kbd className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-[2px] border border-current text-[9px] font-mono leading-none opacity-60">2</kbd>
                {t("triage.lost")}
              </button>
              <button
                onClick={() => triggerAction("3")}
                className="flex-1 py-1.5 font-kosugi text-[10px] tracking-[0.1em] uppercase border transition-colors flex items-center justify-center gap-1.5"
                style={{
                  borderRadius: 4,
                  borderColor: highlightedKey === "3" ? "#597794" : "rgba(89, 119, 148, 0.3)",
                  color: "#597794",
                  background: highlightedKey === "3" ? "rgb(18, 24, 30)" : "rgba(10, 10, 10, 0.90)",
                }}
              >
                <kbd className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-[2px] border border-current text-[9px] font-mono leading-none opacity-60">3</kbd>
                {t("triage.active")}
              </button>
              <button
                onClick={() => triggerAction("4")}
                className="py-1.5 px-2.5 font-kosugi text-[10px] tracking-[0.1em] uppercase border transition-colors flex-shrink-0 flex items-center justify-center gap-1.5"
                style={{
                  borderRadius: 4,
                  borderColor: highlightedKey === "4" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
                  color: highlightedKey === "4" ? "#888" : "#555",
                  background: highlightedKey === "4" ? "rgba(255, 255, 255, 0.06)" : "rgba(10, 10, 10, 0.90)",
                }}
              >
                <kbd className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-[2px] border border-current text-[9px] font-mono leading-none opacity-60">4</kbd>
                {t("triage.discard")}
              </button>
            </div>}
          </div>
        );
      }}
    />
  );
}

// ─── Inline editable text ────────────────────────────────────────────────────

function InlineEditableText({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

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
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          e.stopPropagation();
        }}
        className={`${className} bg-transparent border-b border-[#597794] outline-none w-full`}
        style={{ borderRadius: 0 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`${className} text-left hover:text-[#597794] transition-colors cursor-text block`}
      title="Click to edit"
    >
      {value}
    </button>
  );
}


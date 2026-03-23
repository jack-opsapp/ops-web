"use client";

import { useMemo, useCallback } from "react";
import { CardCarousel, type CarouselItem, type CarouselDecision } from "./card-carousel";
import { EmailThreadView, formatRelativeDate } from "./email-thread-view";
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

  const lastDate = new Date(lead.lastMessageDate);
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
  triageDecisions: Map<string, TriageDecision>;
  onTriageDecision: (leadId: string, decision: TriageDecision) => void;
  consolidationGroups: ConsolidationGroup[];
  onComplete: () => void;
}

export function TriageStep({
  leads,
  triageDecisions,
  onTriageDecision,
  consolidationGroups,
  onComplete,
}: TriageStepProps) {
  // Only enabled, non-flagged leads (those that passed sub-step 1)
  const triageLeads = useMemo(
    () => leads.filter((l) => l.enabled && !l.needsReview),
    [leads]
  );

  // Build a lookup for consolidated company names + lead titles
  const consolidationLookup = useMemo(() => {
    const map = new Map<string, { companyName: string; title: string }>();
    for (const group of consolidationGroups) {
      if (group.leads.length > 1) {
        for (const gl of group.leads) {
          map.set(gl.leadId, {
            companyName: group.companyName,
            title: gl.title,
          });
        }
      }
    }
    return map;
  }, [consolidationGroups]);

  // Build carousel items with AI defaults
  const items: CarouselItem<AnalyzedLead>[] = useMemo(
    () =>
      triageLeads.map((lead) => {
        const existing = triageDecisions.get(lead.id);
        const defaultDecision = existing || computeTriageDefault(lead);
        const actionKey =
          defaultDecision === "won"
            ? "1"
            : defaultDecision === "lost"
              ? "2"
              : "3"; // active

        return {
          id: lead.id,
          data: lead,
          defaultAction: actionKey,
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
      Backspace: (item: CarouselItem<AnalyzedLead>): CarouselDecision =>
        applyDecision(item.id, "discard"),
    }),
    [applyDecision]
  );

  return (
    <CardCarousel
      title="TRIAGE COMPLETED WORK"
      items={items}
      actions={actions}
      onComplete={onComplete}
      keyboardHint="↑↓ navigate · 1 won · 2 lost · 3 active · ⌫ discard · E thread"
      renderCard={(item) => {
        const lead = item.data;
        const consolidated = consolidationLookup.get(lead.id);
        const displayName = consolidated
          ? `${consolidated.companyName}${consolidated.title ? ` — ${consolidated.title}` : ""}`
          : lead.client.name;

        const defaultDecision = computeTriageDefault(lead);

        return (
          <div className="space-y-3">
            {/* Lead identity */}
            <div>
              <p className="font-mohave text-[13px] text-white">
                {displayName}
              </p>
              <p className="font-mohave text-[11px] text-[#666]">
                {lead.client.email}
                {lead.correspondenceCount > 1 && (
                  <span className="ml-2">
                    · {lead.correspondenceCount} emails
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3 mt-1">
                {lead.lastMessageDate && (
                  <span className="font-mohave text-[10px] text-[#555]">
                    Last: {formatRelativeDate(lead.lastMessageDate)}
                  </span>
                )}
                {lead.estimatedValue && (
                  <span className="font-mohave text-[10px] text-[#C4A868]">
                    ${lead.estimatedValue.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* AI suggestion badge */}
            {defaultDecision !== "active" && (
              <div
                className="inline-flex items-center gap-1.5 px-2 py-0.5 border"
                style={{
                  borderRadius: 4,
                  borderColor: `${DECISION_COLORS[defaultDecision]}30`,
                  color: DECISION_COLORS[defaultDecision],
                }}
              >
                <span className="font-kosugi text-[8px] tracking-[0.1em] uppercase">
                  Agent suggests: {DECISION_LABELS[defaultDecision]}
                </span>
              </div>
            )}

            {/* Email thread */}
            <EmailThreadView lead={lead} keyboardEnabled />

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button
                onClick={() => actions["1"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border transition-colors"
                style={{
                  borderRadius: 4,
                  borderColor: "rgba(157, 181, 130, 0.3)",
                  color: "#9DB582",
                }}
              >
                1: WON
              </button>
              <button
                onClick={() => actions["2"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border border-white/10 text-[#6B7280] transition-colors"
                style={{ borderRadius: 4 }}
              >
                2: LOST
              </button>
              <button
                onClick={() => actions["3"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border transition-colors"
                style={{
                  borderRadius: 4,
                  borderColor: "rgba(89, 119, 148, 0.3)",
                  color: "#597794",
                }}
              >
                3: ACTIVE
              </button>
            </div>
          </div>
        );
      }}
      renderPreview={(item) => {
        const consolidated = consolidationLookup.get(item.id);
        const name = consolidated
          ? `${consolidated.companyName}${consolidated.title ? ` — ${consolidated.title}` : ""}`
          : item.data.client.name;
        return (
          <span className="font-mohave text-[11px] text-[#777] truncate">
            {name}
          </span>
        );
      }}
    />
  );
}


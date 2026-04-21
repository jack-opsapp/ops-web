"use client";

import { useMemo, useCallback } from "react";
import {
  Scale,
  Briefcase,
  Receipt,
  Globe,
  Wrench,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { CardCarousel, type CarouselItem, type CarouselDecision } from "./card-carousel";
import { EmailThreadView } from "./email-thread-view";
import { useDictionary } from "@/i18n/client";
import type { AnalyzedLead } from "@/lib/types/email-import";

// ─── Flag configuration ──────────────────────────────────────────────────────

const FLAG_ICONS: Record<string, LucideIcon> = {
  legal: Scale,
  job_seeker: Briefcase,
  collections: Receipt,
  platform_bid: Globe,
  warranty: Wrench,
  ambiguous: HelpCircle,
};

/** AI default: "2" = discard, "1" = import */
const FLAG_DEFAULTS: Record<string, "1" | "2"> = {
  legal: "2",
  job_seeker: "2",
  collections: "1",
  platform_bid: "1",
  warranty: "1",
  ambiguous: "1",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface FilterFlaggedStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  onComplete: () => void;
  onBack?: () => void;
}

export function FilterFlaggedStep({
  leads,
  onLeadsChanged,
  onComplete,
  onBack,
}: FilterFlaggedStepProps) {
  const { t } = useDictionary("import-wizard");

  // Only flagged + enabled leads (disabled leads were already excluded in step 3)
  const flaggedLeads = useMemo(
    () => leads.filter((l) => l.needsReview && l.enabled),
    [leads]
  );

  // Build carousel items
  const items: CarouselItem<AnalyzedLead>[] = useMemo(
    () =>
      flaggedLeads.map((lead) => ({
        id: lead.id,
        data: lead,
        defaultAction: FLAG_DEFAULTS[lead.reviewReason || "ambiguous"] || "1",
      })),
    [flaggedLeads]
  );

  const setLeadFilterDecision = useCallback(
    (leadId: string, imported: boolean) => {
      onLeadsChanged(
        leads.map((l) =>
          l.id === leadId
            ? { ...l, enabled: imported, needsReview: imported ? false : l.needsReview }
            : l
        )
      );
    },
    [leads, onLeadsChanged]
  );

  const actions = useMemo(
    () => ({
      "1": (item: CarouselItem<AnalyzedLead>): CarouselDecision => {
        setLeadFilterDecision(item.id, true);
        return { label: "IMPORT", color: "#6F94B0" };
      },
      "2": (item: CarouselItem<AnalyzedLead>): CarouselDecision => {
        setLeadFilterDecision(item.id, false);
        return { label: "DISCARD", color: "#6B7280" };
      },
      Backspace: (item: CarouselItem<AnalyzedLead>): CarouselDecision => {
        setLeadFilterDecision(item.id, false);
        return { label: "DISCARD", color: "#6B7280" };
      },
    }),
    [setLeadFilterDecision]
  );

  return (
    <CardCarousel
      title={t("filter.title")}
      items={items}
      actions={actions}
      onComplete={onComplete}
      onBack={onBack}
      keyboardHint={t("filter.hint")}
      renderCard={(item, focused, _setDecision, triggerAction, highlightedKey, threadToggle) => {
        const lead = item.data;
        const reason = lead.reviewReason || "ambiguous";
        const Icon = FLAG_ICONS[reason] || HelpCircle;

        return (
          <div className="space-y-4">
            {/* Flag badge */}
            <div className="flex items-center gap-2">
              <Icon size={14} className="text-[#C4A868] flex-shrink-0" />
              <span className="font-mono text-micro tracking-[0.12em] uppercase text-[#C4A868]">
                {t(`filter.reason.${reason}`)}
              </span>
            </div>
            <p className="font-mohave text-[13px] text-[#888] -mt-2">
              {t(`filter.reason.${reason}_desc`)}
            </p>

            {/* Client info */}
            <div>
              <p className="font-mohave text-[18px] text-white leading-tight">
                {lead.client.name}
              </p>
              <p className="font-mohave text-[14px] text-[#888] mt-1">
                {lead.client.email}
                {lead.correspondenceCount > 1 && (
                  <span className="ml-2">
                    · {lead.correspondenceCount} emails
                  </span>
                )}
              </p>
              {lead.client.address && (
                <p className="font-mohave text-[13px] text-[#999] mt-1">
                  {lead.client.address}
                </p>
              )}
              {lead.emails[0] && (
                <p className="font-mohave text-[13px] text-[#777] mt-1 truncate">
                  &ldquo;{lead.emails[0].subject}&rdquo;
                </p>
              )}
            </div>

            {/* Email thread */}
            <EmailThreadView lead={lead} keyboardEnabled toggleSignal={threadToggle} />

            {/* Action buttons — only on focused card */}
            {focused && <div className="flex items-center gap-2 pt-3 border-t border-white/5">
              <button
                onClick={() => triggerAction("1")}
                className="flex-1 py-2.5 font-mono text-[11px] tracking-[0.1em] uppercase border transition-colors"
                style={{
                  borderRadius: 4,
                  borderColor: highlightedKey === "1" ? "#6F94B0" : "rgba(111, 148, 176, 0.3)",
                  color: "#6F94B0",
                  background: highlightedKey === "1" ? "rgb(18, 24, 30)" : "var(--surface-glass-dense)",
                }}
              >
                1: {t("filter.import")}
              </button>
              <button
                onClick={() => triggerAction("2")}
                className="flex-1 py-2.5 font-mono text-[11px] tracking-[0.1em] uppercase border transition-colors"
                style={{
                  borderRadius: 4,
                  borderColor: highlightedKey === "2" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
                  color: "#888",
                  background: highlightedKey === "2" ? "rgb(16, 16, 16)" : "var(--surface-glass-dense)",
                }}
              >
                2: {t("filter.discard")}
              </button>
            </div>}
          </div>
        );
      }}
    />
  );
}

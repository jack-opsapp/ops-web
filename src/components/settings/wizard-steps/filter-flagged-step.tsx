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
import { Button } from "@/components/ui/button";
import { KeyHint } from "@/components/ui/key-hint";
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
        // Neutral text-2 — the decision badge is not the primary CTA.
        return { label: t("filter.import"), color: "#B5B5B5" };
      },
      "2": (item: CarouselItem<AnalyzedLead>): CarouselDecision => {
        setLeadFilterDecision(item.id, false);
        return { label: t("filter.discard"), color: "#8A8A8A" };
      },
      Backspace: (item: CarouselItem<AnalyzedLead>): CarouselDecision => {
        setLeadFilterDecision(item.id, false);
        return { label: t("filter.discard"), color: "#8A8A8A" };
      },
    }),
    [setLeadFilterDecision, t]
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
              <Icon size={16} className="text-tan flex-shrink-0" />
              <span className="font-mono text-micro tracking-[0.12em] uppercase text-tan">
                {t(`filter.reason.${reason}`)}
              </span>
            </div>
            <p className="font-mohave text-[13px] text-text-3 -mt-2">
              {t(`filter.reason.${reason}_desc`)}
            </p>

            {/* Client info */}
            <div>
              <p className="font-mohave text-[18px] text-text leading-tight">
                {lead.client.name}
              </p>
              <p className="font-mohave text-[14px] text-text-3 mt-1">
                {lead.client.email}
                {lead.correspondenceCount > 1 && (
                  <span className="ml-2">
                    · {lead.correspondenceCount} {t("emails")}
                  </span>
                )}
              </p>
              {lead.client.address && (
                <p className="font-mohave text-[13px] text-text-2 mt-1">
                  {lead.client.address}
                </p>
              )}
              {lead.emails[0] && (
                <p className="font-mohave text-[13px] text-text-3 mt-1 truncate">
                  &ldquo;{lead.emails[0].subject}&rdquo;
                </p>
              )}
            </div>

            {/* Email thread */}
            <EmailThreadView lead={lead} keyboardEnabled toggleSignal={threadToggle} />

            {/* Action buttons — only on focused card. IMPORT is the step's
                single primary CTA (accent); DISCARD is the neutral secondary.
                Keyboard selection adds the same accent focus ring the kit uses
                for DOM focus, so highlight reads identically however it arrives. */}
            {focused && <div className="flex items-center gap-2 pt-3 border-t border-border-subtle">
              <Button
                variant="primary"
                onClick={() => triggerAction("1")}
                className={`flex-1 ${highlightedKey === "1" ? "ring-[1.5px] ring-ops-accent ring-offset-2 ring-offset-black" : ""}`}
              >
                <KeyHint keys="1" variant="inline" />
                {t("filter.import")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => triggerAction("2")}
                className={`flex-1 ${highlightedKey === "2" ? "ring-[1.5px] ring-border-strong ring-offset-2 ring-offset-black" : ""}`}
              >
                <KeyHint keys="2" variant="inline" />
                {t("filter.discard")}
              </Button>
            </div>}
          </div>
        );
      }}
    />
  );
}

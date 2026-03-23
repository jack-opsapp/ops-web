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
import { CardCarousel, type CarouselItem } from "./card-carousel";
import { EmailThreadView } from "./email-thread-view";
import type { AnalyzedLead } from "@/lib/types/email-import";

// ─── Flag configuration ──────────────────────────────────────────────────────

interface FlagConfig {
  label: string;
  description: string;
  icon: LucideIcon;
  /** AI default: "1" = import, "2" = discard */
  defaultAction: "1" | "2";
}

const FLAG_CONFIG: Record<string, FlagConfig> = {
  legal: {
    label: "Legal",
    description: "Settlement, dispute, or lawyer correspondence",
    icon: Scale,
    defaultAction: "2", // discard
  },
  job_seeker: {
    label: "Job Seeker",
    description: "Someone looking for work or employment",
    icon: Briefcase,
    defaultAction: "2", // discard
  },
  collections: {
    label: "Collections",
    description: "Invoice dispute or overdue payment follow-up",
    icon: Receipt,
    defaultAction: "1", // import
  },
  platform_bid: {
    label: "Platform Bid",
    description: "Bid invitation from Procore, BuilderTrend, etc.",
    icon: Globe,
    defaultAction: "1", // import
  },
  warranty: {
    label: "Warranty",
    description: "Past client reporting an issue after completion",
    icon: Wrench,
    defaultAction: "1", // import
  },
  ambiguous: {
    label: "Ambiguous",
    description: "Relationship direction is unclear",
    icon: HelpCircle,
    defaultAction: "1", // import
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface FilterFlaggedStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  onComplete: () => void;
}

export function FilterFlaggedStep({
  leads,
  onLeadsChanged,
  onComplete,
}: FilterFlaggedStepProps) {
  // Only flagged leads
  const flaggedLeads = useMemo(
    () => leads.filter((l) => l.needsReview),
    [leads]
  );

  // Build carousel items
  const items: CarouselItem<AnalyzedLead>[] = useMemo(
    () =>
      flaggedLeads.map((lead) => {
        const config = FLAG_CONFIG[lead.reviewReason || "ambiguous"];
        return {
          id: lead.id,
          data: lead,
          defaultAction: config?.defaultAction || "1",
        };
      }),
    [flaggedLeads]
  );

  const setLeadEnabled = useCallback(
    (leadId: string, enabled: boolean) => {
      onLeadsChanged(
        leads.map((l) =>
          l.id === leadId ? { ...l, enabled } : l
        )
      );
    },
    [leads, onLeadsChanged]
  );

  const actions = useMemo(
    () => ({
      "1": (item: CarouselItem<AnalyzedLead>) => {
        // Import
        item.decisionLabel = "IMPORT";
        item.decisionColor = "#597794";
        setLeadEnabled(item.id, true);
      },
      "2": (item: CarouselItem<AnalyzedLead>) => {
        // Discard
        item.decisionLabel = "DISCARD";
        item.decisionColor = "#6B7280";
        setLeadEnabled(item.id, false);
      },
      Backspace: (item: CarouselItem<AnalyzedLead>) => {
        // Discard (same as 2)
        item.decisionLabel = "DISCARD";
        item.decisionColor = "#6B7280";
        setLeadEnabled(item.id, false);
      },
    }),
    [setLeadEnabled]
  );

  return (
    <CardCarousel
      title="FILTER FLAGGED ITEMS"
      items={items}
      actions={actions}
      onComplete={onComplete}
      keyboardHint="↑↓ navigate · 1 import · 2 discard · ⏎ accept · E thread"
      renderCard={(item) => {
        const lead = item.data;
        const reason = lead.reviewReason || "ambiguous";
        const config = FLAG_CONFIG[reason];
        const Icon = config?.icon || HelpCircle;

        return (
          <div className="space-y-3">
            {/* Flag badge */}
            <div className="flex items-center gap-2">
              <Icon size={13} className="text-[#C4A868] flex-shrink-0" />
              <span className="font-kosugi text-[9px] tracking-[0.12em] uppercase text-[#C4A868]">
                {config?.label || reason}
              </span>
            </div>
            <p className="font-mohave text-[10px] text-[#666] -mt-1">
              {config?.description}
            </p>

            {/* Client info */}
            <div>
              <p className="font-mohave text-[13px] text-white">
                {lead.client.name}
              </p>
              <p className="font-mohave text-[11px] text-[#666]">
                {lead.client.email}
                {lead.correspondenceCount > 1 && (
                  <span className="ml-2">
                    · {lead.correspondenceCount} emails
                  </span>
                )}
              </p>
              {lead.emails[0] && (
                <p className="font-mohave text-[11px] text-[#555] mt-0.5 truncate">
                  &ldquo;{lead.emails[0].subject}&rdquo;
                </p>
              )}
            </div>

            {/* Email thread */}
            <EmailThreadView lead={lead} keyboardEnabled />

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button
                onClick={() => actions["1"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border border-[#597794]/30 text-[#597794] hover:bg-[#597794]/10 transition-colors"
                style={{ borderRadius: 4 }}
              >
                1: IMPORT
              </button>
              <button
                onClick={() => actions["2"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border border-white/10 text-[#666] hover:bg-white/5 transition-colors"
                style={{ borderRadius: 4 }}
              >
                2: DISCARD
              </button>
            </div>
          </div>
        );
      }}
      renderPreview={(item) => (
        <span className="font-mohave text-[11px] text-[#777] truncate">
          {item.data.client.name}
        </span>
      )}
    />
  );
}

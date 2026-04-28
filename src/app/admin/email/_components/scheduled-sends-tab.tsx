"use client";
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { CampaignStatusPill } from "./campaign-status-pill";
import { CampaignProgressBar } from "./campaign-progress-bar";
import { CampaignCreateModal } from "./campaign-create-modal";
import { CampaignDetailModal } from "./campaign-detail-modal";
import {
  campaignRowVariants,
  campaignRowVariantsReduced,
} from "@/lib/utils/motion";
import type { Campaign } from "@/lib/email/campaigns";
import type { AudienceFilterNode } from "@/lib/admin/types";

interface ListResponse {
  rows: Campaign[];
  total: number;
}

function formatScheduled(campaign: Campaign): string {
  if (campaign.sendStatus === "draft") return "Draft, not scheduled.";
  if (!campaign.scheduledFor) return "—";
  const when = new Date(campaign.scheduledFor);
  return when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ScheduledSendsTab() {
  const reduce = useReducedMotion();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [pendingAudienceFilter, setPendingAudienceFilter] =
    React.useState<AudienceFilterNode | null>(null);

  // Bridge: Audience Builder fires CustomEvent → open create modal pre-populated.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ filter: AudienceFilterNode }>;
      setPendingAudienceFilter(ce.detail.filter);
      setCreateOpen(true);
    };
    window.addEventListener("ops:audience-use-in-campaign", handler);
    return () =>
      window.removeEventListener("ops:audience-use-in-campaign", handler);
  }, []);

  const list = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const r = await fetch("/api/admin/email/campaigns?limit=50");
      if (!r.ok) throw new Error("list_failed");
      return (await r.json()) as ListResponse;
    },
    refetchInterval: 8000,
  });

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED]">
            // SCHEDULED SENDS
          </h3>
          <p
            className="font-mono text-[11px] text-[#8A8A8A]"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            [{list.data?.total ?? 0} campaigns]
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#6F94B0] border border-[#6F94B0] hover:bg-[#6F94B0] hover:text-black px-3 py-1.5 rounded-[5px] transition-colors"
        >
          NEW CAMPAIGN
        </button>
      </header>

      <div className="space-y-1.5">
        {(list.data?.rows ?? []).map((c, i) => (
          <motion.button
            key={c.id}
            type="button"
            onClick={() => setDetailId(c.id)}
            custom={i}
            variants={
              reduce ? campaignRowVariantsReduced : campaignRowVariants
            }
            initial="hidden"
            animate="visible"
            className="block w-full text-left p-3 rounded-[10px] hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6F94B0] transition-colors"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mohave text-[14px] text-[#EDEDED] truncate">
                    {c.name}
                  </span>
                  <span className="font-mono text-[10px] text-[#6A6A6A]">
                    [{c.slug}]
                  </span>
                </div>
                <span
                  className="font-mono text-[10px] text-[#8A8A8A] block mt-0.5"
                  style={{ fontFeatureSettings: '"tnum" 1' }}
                >
                  {formatScheduled(c)} · template:{c.templateId}
                </span>
              </div>
              <CampaignStatusPill status={c.sendStatus} />
            </div>
            <CampaignProgressBar
              sent={c.sentCount}
              bounced={c.bouncedCount}
              failed={c.failedCount}
              total={c.recipientCountActual ?? c.recipientCountEstimate}
            />
          </motion.button>
        ))}

        {list.isLoading ? (
          <p className="font-mono text-[12px] text-[#8A8A8A] py-8">
            [loading campaigns…]
          </p>
        ) : null}

        {!list.isLoading && (list.data?.rows.length ?? 0) === 0 ? (
          <p className="font-mono text-[12px] text-[#8A8A8A] py-8">
            [no campaigns yet — start with NEW CAMPAIGN]
          </p>
        ) : null}

        {list.isError ? (
          <p
            className="font-mono text-[12px] text-[#B58289] py-2"
            role="alert"
          >
            [error] failed to load campaigns
          </p>
        ) : null}
      </div>

      <CampaignCreateModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setPendingAudienceFilter(null);
        }}
        onCreated={(id) => setDetailId(id)}
        audienceFilterOverride={pendingAudienceFilter}
      />
      <CampaignDetailModal
        campaignId={detailId}
        onClose={() => setDetailId(null)}
      />
    </section>
  );
}

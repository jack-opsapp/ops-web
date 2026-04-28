"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  campaignMetricGridVariants,
  animatedCountVariants,
} from "@/lib/utils/motion";
import { CampaignSankeyChart } from "./campaign-sankey-chart";
import { DomainBounceChart } from "./domain-bounce-chart";
import { TemplateVersionCompareCard } from "./template-version-compare-card";
import type {
  CampaignEngagementStats,
  CampaignFunnelStage,
} from "@/lib/admin/email-campaign-types";

interface Props {
  campaignId: string;
  emailType?: string;
  templateVersionsSent?: string[];
}

interface EngagementResponse {
  ok: boolean;
  stats: CampaignEngagementStats;
  funnel: CampaignFunnelStage[];
}

async function fetchEngagement(id: string): Promise<EngagementResponse | null> {
  const r = await fetch(`/api/admin/email/campaigns/${id}/engagement`);
  if (!r.ok) return null;
  const j = (await r.json()) as EngagementResponse;
  return j.ok ? j : null;
}

interface MetricCardProps {
  label: string;
  value: number;
  suffix?: string;
  secondary?: string;
  index: number;
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  suffix,
  secondary,
  index,
}) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={reduced ? undefined : campaignMetricGridVariants}
      initial={reduced ? undefined : "initial"}
      animate={reduced ? undefined : "animate"}
      custom={index}
      className="rounded-panel border border-glass-border px-5 py-4"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        {label}
      </div>
      <div
        className="mt-2 font-cakemono font-light text-[28px] uppercase tracking-[0.04em] text-text"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {value}
        {suffix && (
          <span className="ml-1 font-mono text-[14px] text-text-2">
            {suffix}
          </span>
        )}
      </div>
      {secondary && (
        <div
          className="mt-1 font-mono text-[11px] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {secondary}
        </div>
      )}
    </motion.div>
  );
};

export function CampaignDetailPanel({
  campaignId,
  emailType,
  templateVersionsSent,
}: Props) {
  const reduced = useReducedMotion();
  const { data } = useQuery({
    queryKey: ["campaign-engagement", campaignId],
    queryFn: () => fetchEngagement(campaignId),
    refetchInterval: 60_000,
  });

  if (!data) {
    return (
      <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        {"// LOADING"}
      </div>
    );
  }
  const { stats, funnel } = data;
  const showVersionCompare =
    Boolean(emailType) &&
    Array.isArray(templateVersionsSent) &&
    templateVersionsSent.length >= 2;

  return (
    <motion.div
      variants={reduced ? undefined : animatedCountVariants}
      initial={reduced ? undefined : "initial"}
      animate={reduced ? undefined : "animate"}
      className="space-y-6"
    >
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Sent" value={stats.sent} index={0} />
        <MetricCard
          label="Delivered"
          value={stats.delivered}
          secondary={`${stats.bounce_rate}% bounce`}
          index={1}
        />
        <MetricCard
          label="Open rate"
          value={stats.open_rate}
          suffix="%"
          secondary={`${stats.opened} unique`}
          index={2}
        />
        <MetricCard
          label="Click rate"
          value={stats.click_rate}
          suffix="%"
          secondary={`${stats.clicked} unique`}
          index={3}
        />
        <MetricCard label="CTOR" value={stats.ctor} suffix="%" index={4} />
        <MetricCard label="Spam" value={stats.spam_reports} index={5} />
        <MetricCard label="Unsub" value={stats.unsubscribes} index={6} />
        <MetricCard
          label="Suppressed"
          value={stats.suppressed_skipped}
          secondary={`${stats.in_flight} in-flight`}
          index={7}
        />
      </div>

      <CampaignSankeyChart stages={funnel} />

      <DomainBounceChart data={stats.per_domain_bounce_summary} />

      {showVersionCompare && (
        <TemplateVersionCompareCard
          emailType={emailType as string}
          versions={templateVersionsSent as string[]}
        />
      )}
    </motion.div>
  );
}

import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  Spacer,
  InfoBlock,
  Divider,
} from "../primitives";
import { DISPATCH } from "../../senders";
import type { AdBriefing } from "@/lib/admin/briefing-types";

interface AdsBriefingProps {
  briefing: AdBriefing;
}

function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function AdsBriefing({ briefing }: AdsBriefingProps) {
  const perf = briefing.performance_data;
  const topInsights = (briefing.insights ?? [])
    .filter((i) => i.severity === "high")
    .slice(0, 3);
  const topActions = (briefing.action_items ?? [])
    .filter((a) => a.priority === "high")
    .slice(0, 3);

  return (
    <OpsEmailLayout
      preview={`Google Ads weekly — ${briefing.period_start} to ${briefing.period_end}`}
      eyebrow="Ads intel"
      senderAddress={DISPATCH.email}
    >
      <Headline>
        Google Ads — {briefing.period_start} to {briefing.period_end}
      </Headline>
      {briefing.summary ? <Paragraph>{briefing.summary}</Paragraph> : null}
      {perf ? (
        <>
          <Spacer size="sm" />
          <InfoBlock label="Spend">
            {formatCurrency(perf.current.spend)} ({formatPct(perf.deltas.spend)})
          </InfoBlock>
          <InfoBlock label="CPA">
            {formatCurrency(perf.current.cpa)} ({formatPct(perf.deltas.cpa)})
          </InfoBlock>
          <InfoBlock label="Conversions">
            {perf.current.conversions} ({formatPct(perf.deltas.conversions)})
          </InfoBlock>
          <InfoBlock label="Top campaign">
            {perf.topCampaign.name} — {perf.topCampaign.conversions} conv @ {formatCurrency(perf.topCampaign.cpa)} CPA
          </InfoBlock>
        </>
      ) : null}
      {topInsights.length > 0 ? (
        <>
          <Divider spacing="md" />
          <Headline as="h2">High-priority insights</Headline>
          {topInsights.map((insight, i) => (
            <InfoBlock key={i} label={insight.category.toUpperCase()}>
              <strong>{insight.title}.</strong> {insight.recommendation}
            </InfoBlock>
          ))}
        </>
      ) : null}
      {topActions.length > 0 ? (
        <>
          <Divider spacing="md" />
          <Headline as="h2">Next moves</Headline>
          {topActions.map((action, i) => (
            <Paragraph key={i}>
              &bull; {action.action} <em>({action.effort}, {action.expectedImpact})</em>
            </Paragraph>
          ))}
        </>
      ) : null}
    </OpsEmailLayout>
  );
}

AdsBriefing.PreviewProps = {
  briefing: {
    id: "preview",
    created_at: "2026-04-15T12:00:00Z",
    period_start: "2026-04-08",
    period_end: "2026-04-14",
    status: "complete",
    progress: null,
    summary:
      "Spend held flat week-over-week but CPA dropped 18% thanks to the new landing page for deck builders. Two competitors launched aggressive spring offers — expect pressure on top-of-funnel next week.",
    performance_data: {
      current: {
        spend: 4820,
        cpa: 68,
        ctr: 0.041,
        clicks: 1214,
        impressions: 29800,
        conversions: 71,
      },
      prior: {
        spend: 4790,
        cpa: 83,
        ctr: 0.036,
        clicks: 1180,
        impressions: 32700,
        conversions: 58,
      },
      deltas: {
        spend: 0.006,
        cpa: -0.181,
        ctr: 0.139,
        clicks: 0.029,
        impressions: -0.089,
        conversions: 0.224,
      },
      topCampaign: {
        name: "Deck Builders — Victoria",
        conversions: 29,
        cpa: 52,
      },
      worstCampaign: {
        name: "General — Broad Match",
        spend: 1120,
        conversions: 4,
        cpa: 280,
      },
      dailySpend: [],
      trendContext: null,
    },
    competitor_intel: [],
    market_sentiment: [],
    insights: [
      {
        category: "creative",
        severity: "high",
        title: "Deck Builder landing page is working",
        explanation:
          "CPA dropped 18% since launching the dedicated deck builder landing page.",
        recommendation: "Double down — build a similar page for railing.",
        impactScore: 9,
      },
    ],
    ad_suggestions: [],
    keyword_recs: [],
    ab_test_proposals: [],
    action_items: [
      {
        priority: "high",
        action: "Ship railing-specific landing page mirroring the deck builder",
        expectedImpact: "15-20% CPA reduction on railing keywords",
        category: "creative",
        effort: "1hr",
      },
      {
        priority: "high",
        action: "Pause 'General — Broad Match' campaign",
        expectedImpact: "$1,120/week recovered",
        category: "bidding",
        effort: "5min",
      },
    ],
    email_sent: false,
    triggered_by: "cron",
    error: null,
  },
} satisfies AdsBriefingProps;

export default AdsBriefing;

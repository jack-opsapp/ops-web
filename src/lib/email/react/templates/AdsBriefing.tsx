// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  Spacer,
  InfoBlock,
  Divider,
  Button,
  emailTokens as T,
} from "../primitives";
import { Section, Row, Column, Text } from "@react-email/components";
import { DISPATCH } from "../../senders";
import type { AdBriefing, ActionItem } from "@/lib/admin/briefing-types";

interface AdsBriefingProps {
  briefing: AdBriefing;
  unsubscribeUrl?: string;
  list?: string;
}

function priorityColor(p: "high" | "medium" | "low"): string {
  return p === "high" ? "#93321A" : p === "medium" ? "#C4A868" : "#6B6B6B";
}

function formatDelta(value: number): string {
  const pct = (value * 100).toFixed(1);
  if (value > 0) return `\u2191${pct}%`;
  if (value < 0) return `\u2193${Math.abs(Number(pct))}%`;
  return "\u2192 flat";
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function ActionRow({ item, index }: { item: ActionItem; index: number }) {
  const color = priorityColor(item.priority);
  return (
    <Section
      style={{
        borderLeft: `2px solid ${color}`,
        paddingLeft: T.spacing.md,
        margin: `${T.spacing.sm} 0`,
      }}
    >
      <Row>
        <Column>
          <Text
            style={{
              margin: 0,
              fontFamily: T.font.sans,
              fontSize: T.size.body,
              lineHeight: T.size.bodyLine,
              color: T.color.paperTextPrimary,
            }}
          >
            {index + 1}.&nbsp;
            <span
              style={{
                color,
                textTransform: "uppercase",
                fontSize: T.size.eyebrow,
                fontWeight: T.weight.bold,
                letterSpacing: T.tracking.eyebrow,
              }}
            >
              [{item.priority}]
            </span>
            &nbsp;{item.action}
          </Text>
          <Text
            style={{
              margin: `${T.spacing.xs} 0 0 0`,
              fontFamily: T.font.sans,
              fontSize: T.size.small,
              lineHeight: T.size.smallLine,
              color: T.color.paperTextSecondary,
            }}
          >
            {item.expectedImpact} &middot; {item.effort}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

export function AdsBriefing({ briefing, unsubscribeUrl, list }: AdsBriefingProps) {
  const perf = briefing.performance_data;
  const actions = (briefing.action_items ?? []).slice(0, 3);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

  return (
    <OpsEmailLayout
      preview={`Google Ads weekly — ${briefing.period_start} to ${briefing.period_end}`}
      eyebrow="Ads intel // Google Ads weekly"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>
        {briefing.period_start} &mdash; {briefing.period_end}
      </Headline>
      <Paragraph>{briefing.summary ?? "Briefing summary unavailable."}</Paragraph>

      {actions.length > 0 ? (
        <>
          <Spacer size="md" />
          <Headline as="h2">This week&apos;s actions</Headline>
          {actions.map((action, i) => (
            <ActionRow key={i} item={action} index={i} />
          ))}
        </>
      ) : null}

      {perf ? (
        <>
          <Divider spacing="md" />
          <Headline as="h2">Key metrics</Headline>
          <InfoBlock label="Spend">
            {formatCurrency(perf.current.spend)} &middot;{" "}
            {formatDelta(perf.deltas.spend)}
          </InfoBlock>
          <InfoBlock label="CPA">
            {formatCurrency(perf.current.cpa)} &middot;{" "}
            {formatDelta(perf.deltas.cpa)}
          </InfoBlock>
          <InfoBlock label="Conversions">
            {perf.current.conversions} &middot;{" "}
            {formatDelta(perf.deltas.conversions)}
          </InfoBlock>
          <InfoBlock label="Top campaign">
            {perf.topCampaign.name} &middot; {perf.topCampaign.conversions} conv
            @ {formatCurrency(perf.topCampaign.cpa)} CPA
          </InfoBlock>
        </>
      ) : null}

      <Spacer size="lg" />
      <Button href={`${appUrl}/admin/google-ads/briefings/${briefing.id}`}>
        View full briefing &rarr;
      </Button>
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
    insights: [],
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
      {
        priority: "medium",
        action: "Test three new headline variants on Deck Builder ad group",
        expectedImpact: "CTR +0.5-1.0pp",
        category: "creative",
        effort: "30min",
      },
    ],
    email_sent: false,
    triggered_by: "cron",
    error: null,
  },
} satisfies AdsBriefingProps;

export default AdsBriefing;

export const previewProps = AdsBriefing.PreviewProps;

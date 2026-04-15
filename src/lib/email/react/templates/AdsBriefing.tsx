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

export default AdsBriefing;

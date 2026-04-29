import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  InfoBlock,
  Button,
  Spacer,
  Divider,
} from "../primitives";
import { DISPATCH } from "../../senders";
import type { PmfState } from "@/lib/pmf/types";

export interface PmfWeeklyDigestCohort {
  cohort_month: string;
  size: number;
  d30: number;
  d60: number;
  d90: number;
}

export interface PmfWeeklyDigestProps {
  state: PmfState;
  daysToGate: number;
  weekNumber: number;
  dashboardUrl?: string;
  retentionCohorts: PmfWeeklyDigestCohort[];
  unsubscribeUrl?: string;
  list?: string;
}

const MAX_COHORTS_DISPLAYED = 6;

function statusTone(status: string): "neutral" | "success" | "error" {
  if (status === "green") return "success";
  if (status === "red") return "error";
  return "neutral";
}

function formatIndicator(value: number, unit?: string): string {
  if (unit === "percent") return `${(value * 100).toFixed(0)}%`;
  if (unit === "currency") return `$${value.toLocaleString()}`;
  return String(value);
}

export function PmfWeeklyDigest({
  state,
  daysToGate,
  weekNumber,
  dashboardUrl,
  retentionCohorts,
  unsubscribeUrl,
  list,
}: PmfWeeklyDigestProps) {
  const safeUrl =
    dashboardUrl && /^https?:\/\//.test(dashboardUrl) ? dashboardUrl : null;
  const cohorts = retentionCohorts.slice(0, MAX_COHORTS_DISPLAYED);

  return (
    <OpsEmailLayout
      preview={`PMF weekly digest · week ${weekNumber}`}
      eyebrow={`// PMF WEEKLY DIGEST · WEEK ${weekNumber} · GATE B ${daysToGate} DAYS`}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline as="h1">Weekly marker readout</Headline>
      <Paragraph small>
        Markers, leading indicators, and retention for the last
        {" "}{MAX_COHORTS_DISPLAYED}{" "}cohorts.
      </Paragraph>

      <Spacer size="md" />
      {Object.entries(state.markers).map(([key, m]) => (
        <InfoBlock
          key={key}
          label={`${m.label} · [${m.status.toUpperCase()}]`}
          tone={statusTone(m.status)}
        >
          {m.value} / target {m.target}
          {m.detail ? ` — ${m.detail}` : null}
        </InfoBlock>
      ))}

      <Spacer size="md" />
      <Divider />
      <Spacer size="md" />

      <Paragraph small>{"// LEADING INDICATORS"}</Paragraph>
      {Object.entries(state.indicators).map(([key, ind]) => (
        <InfoBlock
          key={key}
          label={`${ind.label} · [${ind.status.toUpperCase()}]`}
          tone={statusTone(ind.status)}
        >
          {formatIndicator(ind.value, ind.unit)}
          {Number.isFinite(ind.delta_wow)
            ? ` · WoW ${(ind.delta_wow * 100).toFixed(1)}%`
            : null}
        </InfoBlock>
      ))}

      <Spacer size="md" />
      <Divider />
      <Spacer size="md" />

      <Paragraph small>
        {"// COHORT RETENTION · LAST "}{MAX_COHORTS_DISPLAYED}{" COHORTS"}
      </Paragraph>
      {cohorts.length === 0 ? (
        <Paragraph small>[NO COHORT DATA YET]</Paragraph>
      ) : (
        cohorts.map((c) => (
          <InfoBlock key={c.cohort_month} label={`${c.cohort_month} · n=${c.size}`}>
            30D={(c.d30 * 100).toFixed(0)}% · 60D={(c.d60 * 100).toFixed(0)}% · 90D=
            {(c.d90 * 100).toFixed(0)}%
          </InfoBlock>
        ))
      )}

      {safeUrl ? (
        <>
          <Spacer size="md" />
          <Button href={safeUrl}>VIEW DECK</Button>
        </>
      ) : null}
    </OpsEmailLayout>
  );
}

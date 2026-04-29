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

export interface PmfDailyDigestProps {
  state: PmfState;
  daysToGate: number;
  dashboardUrl?: string;
  unsubscribeUrl?: string;
  list?: string;
}

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

export function PmfDailyDigest({
  state,
  daysToGate,
  dashboardUrl,
  unsubscribeUrl,
  list,
}: PmfDailyDigestProps) {
  const safeUrl =
    dashboardUrl && /^https?:\/\//.test(dashboardUrl) ? dashboardUrl : null;

  return (
    <OpsEmailLayout
      preview={`PMF daily digest · gate B · ${daysToGate} days`}
      eyebrow={`// PMF DAILY DIGEST · GATE B · ${daysToGate} DAYS`}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline as="h1">Daily marker readout</Headline>
      <Paragraph small>
        Snapshot of all four markers and leading indicators as of this morning.
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
          {Number.isFinite(ind.delta_wow) ? ` · WoW ${(ind.delta_wow * 100).toFixed(1)}%` : null}
        </InfoBlock>
      ))}

      {safeUrl ? (
        <>
          <Spacer size="md" />
          <Button href={safeUrl}>VIEW DECK</Button>
        </>
      ) : null}
    </OpsEmailLayout>
  );
}

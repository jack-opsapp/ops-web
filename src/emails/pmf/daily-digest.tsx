/**
 * OPS Web — PMF Daily Digest email template.
 *
 * Renders the 4 markers and 5 leading indicators from `PmfState`, with a
 * countdown to GATE B. Fired from the daily cron handler (Task 26) and
 * dispatched through `sendPmfNotification` (Task 24).
 *
 * Styling follows spec v2 (accent `#6F94B0`, canvas `#000000`, text ladder),
 * with the one email-specific divergence: the glass surface uses opaque
 * `rgba(10,10,10,0.70)` because `backdrop-blur` is unreliable in email
 * clients (Gmail, Outlook, Apple Mail). See `./_shared.ts` for the shared
 * style constants.
 *
 * `DailyDigestBody` is the inner (chrome-less) render. `DailyDigestEmail`
 * wraps it in `<Html>/<Head>/<Body>`. Weekly-digest imports
 * `DailyDigestBody` so the rendered HTML has exactly one `<html>` element
 * (Gmail strips nested `<html>`; Outlook renders inconsistently).
 */
import React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { PmfState } from '@/lib/pmf/types';
import {
  ACCENT,
  CANVAS,
  GLASS,
  HERO,
  MONO11,
  STATUS_COLOR,
  sanitizeDashboardUrl,
} from './_shared';

export interface DailyDigestProps {
  state: PmfState;
  daysToGate: number;
  dashboardUrl?: string;
}

export interface DailyDigestBodyProps {
  state: PmfState;
  daysToGate: number;
  /** Pre-sanitized (upstream) dashboard URL, or `null` to omit the link. */
  dashboardUrl: string | null;
}

/**
 * Renders the inner content of the daily digest — all markers, indicators,
 * and the view-deck link. No `<Html>`/`<Head>`/`<Body>`/outer `<Container>`.
 * Used directly by `DailyDigestEmail` and by `WeeklyDigestEmail`.
 */
export function DailyDigestBody({
  state,
  daysToGate,
  dashboardUrl,
}: DailyDigestBodyProps) {
  return (
    <>
      <Text style={MONO11}>
        // PMF DAILY DIGEST · GATE B · {daysToGate} DAYS
      </Text>

      {Object.entries(state.markers).map(([key, m]) => (
        <Section key={key} style={GLASS}>
          <Text style={MONO11}>// {m.label}</Text>
          <Text style={HERO}>
            {m.value}{' '}
            <span style={{ color: '#8A8A8A', fontSize: 24 }}>
              / {m.target}
            </span>
          </Text>
          <Text style={{ ...MONO11, color: STATUS_COLOR[m.status] }}>
            [{m.status.toUpperCase()}]
          </Text>
        </Section>
      ))}

      <Section style={GLASS}>
        <Text style={MONO11}>// LEADING INDICATORS</Text>
        {Object.entries(state.indicators).map(([key, ind]) => (
          <Text
            key={key}
            style={{ ...MONO11, color: '#B5B5B5', marginTop: 6 }}
          >
            {ind.label}:{' '}
            {ind.unit === 'percent'
              ? `${(ind.value * 100).toFixed(0)}%`
              : ind.value}{' '}
            ·{' '}
            <span style={{ color: STATUS_COLOR[ind.status] }}>
              {ind.status.toUpperCase()}
            </span>
          </Text>
        ))}
      </Section>

      {dashboardUrl && (
        <Text style={{ ...MONO11, marginTop: 24 }}>
          <a
            href={dashboardUrl}
            style={{ color: ACCENT, textDecoration: 'none' }}
          >
            → VIEW DECK
          </a>
        </Text>
      )}
    </>
  );
}

export function DailyDigestEmail({
  state,
  daysToGate,
  dashboardUrl,
}: DailyDigestProps) {
  const safeUrl = sanitizeDashboardUrl(dashboardUrl);
  return (
    <Html>
      <Head />
      <Preview>{`PMF daily digest · GATE B in ${daysToGate} days`}</Preview>
      <Body style={CANVAS}>
        <Container>
          <DailyDigestBody
            state={state}
            daysToGate={daysToGate}
            dashboardUrl={safeUrl}
          />
        </Container>
      </Body>
    </Html>
  );
}

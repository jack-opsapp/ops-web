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
 * clients (Gmail, Outlook, Apple Mail).
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
import type { MarkerStatus, PmfState } from '@/lib/pmf/types';

const CANVAS: React.CSSProperties = {
  background: '#000000',
  margin: 0,
  padding: 24,
  fontFamily: "'Mohave', sans-serif",
  color: '#EDEDED',
};

const GLASS: React.CSSProperties = {
  background: 'rgba(10,10,10,0.70)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5,
  padding: 24,
  marginBottom: 12,
};

const MONO11: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: '#8A8A8A',
};

const HERO: React.CSSProperties = {
  fontFamily: "'Mohave', sans-serif",
  fontWeight: 300,
  fontSize: 40,
  lineHeight: 1,
  color: '#EDEDED',
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

const STATUS_COLOR: Record<MarkerStatus, string> = {
  green: '#9DB582',
  amber: '#C4A868',
  red: '#B58289',
};

export interface DailyDigestProps {
  state: PmfState;
  daysToGate: number;
  dashboardUrl: string;
}

export function DailyDigestEmail({
  state,
  daysToGate,
  dashboardUrl,
}: DailyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>{`PMF daily digest · GATE B in ${daysToGate} days`}</Preview>
      <Body style={CANVAS}>
        <Container>
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
                {ind.label}: {ind.value}
                {ind.unit === 'percent' ? '%' : ''} ·{' '}
                <span style={{ color: STATUS_COLOR[ind.status] }}>
                  {ind.status.toUpperCase()}
                </span>
              </Text>
            ))}
          </Section>

          <Text style={{ ...MONO11, marginTop: 24 }}>
            <a
              href={dashboardUrl}
              style={{ color: '#6F94B0', textDecoration: 'none' }}
            >
              → VIEW DECK
            </a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

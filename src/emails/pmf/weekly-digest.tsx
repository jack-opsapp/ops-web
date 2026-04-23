/**
 * OPS Web — PMF Weekly Digest email template.
 *
 * Superset of the daily digest with an additional cohort-retention section
 * showing the last 6 cohorts' D30/D60/D90 retention. Fired from the weekly
 * cron handler (Task 27) and dispatched through `sendPmfNotification`.
 *
 * Composition: wraps the full daily-digest render for all markers/indicators
 * and appends the retention block. React Email tolerates nested Html/Body,
 * but if that ever becomes a rendering issue we can refactor the daily
 * template to expose its inner sections as a standalone component.
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
import { DailyDigestEmail } from './daily-digest';

export interface WeeklyDigestCohort {
  cohort_month: string;
  size: number;
  d30: number;
  d60: number;
  d90: number;
}

export interface WeeklyDigestProps {
  state: PmfState;
  daysToGate: number;
  weekNumber: number;
  dashboardUrl: string;
  retentionCohorts: WeeklyDigestCohort[];
}

const MONO11: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: '#8A8A8A',
};

const GLASS: React.CSSProperties = {
  background: 'rgba(10,10,10,0.70)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5,
  padding: 24,
  marginBottom: 12,
};

const CANVAS: React.CSSProperties = {
  background: '#000000',
  margin: 0,
  padding: 24,
  fontFamily: "'Mohave', sans-serif",
  color: '#EDEDED',
};

export function WeeklyDigestEmail(p: WeeklyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>{`PMF weekly digest · week ${p.weekNumber}`}</Preview>
      <Body style={CANVAS}>
        <Container>
          <Text style={MONO11}>
            // PMF WEEKLY DIGEST · WEEK {p.weekNumber} · GATE B {p.daysToGate}{' '}
            DAYS
          </Text>
          {/* Reuse daily digest inner sections */}
          <DailyDigestEmail
            state={p.state}
            daysToGate={p.daysToGate}
            dashboardUrl={p.dashboardUrl}
          />
          <Section style={GLASS}>
            <Text style={MONO11}>// COHORT RETENTION · LAST 6 COHORTS</Text>
            {p.retentionCohorts.slice(0, 6).map((c) => (
              <Text
                key={c.cohort_month}
                style={{ ...MONO11, color: '#B5B5B5', marginTop: 4 }}
              >
                {c.cohort_month} · n={c.size} · 30D=
                {(c.d30 * 100).toFixed(0)}% · 60D=
                {(c.d60 * 100).toFixed(0)}% · 90D=
                {(c.d90 * 100).toFixed(0)}%
              </Text>
            ))}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

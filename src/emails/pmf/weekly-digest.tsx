/**
 * OPS Web — PMF Weekly Digest email template.
 *
 * Superset of the daily digest with an additional cohort-retention section
 * showing the last N cohorts' D30/D60/D90 retention. Fired from the weekly
 * cron handler (Task 27) and dispatched through `sendPmfNotification`.
 *
 * Composition: renders a single `<Html>/<Head>/<Body>` wrapping the daily
 * digest's inner body (via `DailyDigestBody`, not `DailyDigestEmail`) plus
 * the retention block. Nesting `<Html>` inside `<Html>` breaks Gmail and
 * Outlook — `DailyDigestBody` is chrome-less so the rendered HTML has
 * exactly one `<html>` element.
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
import { DailyDigestBody } from './daily-digest';
import { CANVAS, GLASS, MONO11, sanitizeDashboardUrl } from './_shared';

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
  dashboardUrl?: string;
  retentionCohorts: WeeklyDigestCohort[];
}

const MAX_COHORTS_DISPLAYED = 6;

export function WeeklyDigestEmail(p: WeeklyDigestProps) {
  const safeUrl = sanitizeDashboardUrl(p.dashboardUrl);
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
          {/* Reuse daily digest inner sections (no nested <Html>/<Body>). */}
          <DailyDigestBody
            state={p.state}
            daysToGate={p.daysToGate}
            dashboardUrl={safeUrl}
          />
          <Section style={GLASS}>
            <Text style={MONO11}>
              // COHORT RETENTION · LAST {MAX_COHORTS_DISPLAYED} COHORTS
            </Text>
            {p.retentionCohorts.length === 0 ? (
              <Text
                style={{ ...MONO11, color: '#6A6A6A', marginTop: 4 }}
              >
                [NO COHORT DATA YET]
              </Text>
            ) : (
              p.retentionCohorts
                .slice(0, MAX_COHORTS_DISPLAYED)
                .map((c) => (
                  <Text
                    key={c.cohort_month}
                    style={{ ...MONO11, color: '#B5B5B5', marginTop: 4 }}
                  >
                    {c.cohort_month} · n={c.size} · 30D=
                    {(c.d30 * 100).toFixed(0)}% · 60D=
                    {(c.d60 * 100).toFixed(0)}% · 90D=
                    {(c.d90 * 100).toFixed(0)}%
                  </Text>
                ))
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

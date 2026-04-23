/**
 * Unit tests for PMF email templates (Task 25).
 *
 * Uses `@react-email/render` to convert each template into final HTML, then
 * asserts on the rendered strings. Fixtures match the actual `PmfState`
 * shape in `src/lib/pmf/types.ts` — note that `IndicatorState.status` is
 * `MarkerStatus` (green | amber | red) and `unit` is optional
 * (`'count' | 'percent' | 'currency'`).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import { ThresholdAlertEmail } from '@/emails/pmf/threshold-alert';
import { DailyDigestEmail } from '@/emails/pmf/daily-digest';
import {
  WeeklyDigestEmail,
  type WeeklyDigestCohort,
} from '@/emails/pmf/weekly-digest';
import type { PmfState } from '@/lib/pmf/types';

const fixture: PmfState = {
  capturedAt: '2026-04-21T00:00:00Z',
  markers: {
    marker_1: {
      status: 'amber',
      value: 1,
      target: 2,
      label: 'TIER A ENGAGEMENTS',
    },
    marker_2: {
      status: 'red',
      value: 0,
      target: 5,
      label: 'RETAINED BASE SAAS',
    },
    marker_3: { status: 'green', value: 1, target: 1, label: 'INBOUND LEAD' },
    marker_4: { status: 'red', value: 4200, target: 15000, label: 'CAC' },
  },
  indicators: {
    indicator_a: {
      status: 'amber',
      value: 3,
      delta_wow: 1,
      sparkline: [1, 2, 3],
      label: 'A',
    },
    indicator_b: {
      status: 'green',
      value: 55,
      delta_wow: 5,
      sparkline: [40, 50, 55],
      label: 'B',
    },
    indicator_c: {
      status: 'green',
      value: 0.07,
      delta_wow: 0.01,
      sparkline: [],
      label: 'C',
      unit: 'percent',
    },
    indicator_d: {
      status: 'green',
      value: 0.05,
      delta_wow: 0,
      sparkline: [],
      label: 'D',
      unit: 'percent',
    },
    indicator_e: {
      status: 'red',
      value: 0,
      delta_wow: 0,
      sparkline: [],
      label: 'E',
    },
  },
};

const cohortsFixture: WeeklyDigestCohort[] = [
  { cohort_month: '2026-01', size: 12, d30: 0.75, d60: 0.58, d90: 0.41 },
  { cohort_month: '2026-02', size: 18, d30: 0.8, d60: 0.62, d90: 0.5 },
  { cohort_month: '2026-03', size: 22, d30: 0.7, d60: 0.55, d90: 0.45 },
];

describe('ThresholdAlertEmail', () => {
  it('renders HTML with trigger + body + view-deck link', async () => {
    const html = await render(
      ThresholdAlertEmail({
        trigger: 'marker_1_green',
        messageBody: 'MARKER 1 GREEN',
        dashboardUrl: 'https://x/admin/pmf',
      })
    );
    expect(html).toContain('MARKER 1 GREEN');
    expect(html).toContain('MARKER_1_GREEN');
    expect(html).toContain('VIEW DECK');
    expect(html).toContain('https://x/admin/pmf');
  });

  it('renders context entries when supplied', async () => {
    const html = await render(
      ThresholdAlertEmail({
        trigger: 'marker_2_red',
        messageBody: 'CHURN DETECTED',
        context: { retained: 3, target: 5 },
      })
    );
    expect(html).toContain('RETAINED');
    expect(html).toContain('TARGET');
    // No dashboard link when not provided.
    expect(html).not.toContain('VIEW DECK');
  });

  it('omits the view-deck link when the URL is not http(s)', async () => {
    const html = await render(
      ThresholdAlertEmail({
        trigger: 'marker_1_green',
        messageBody: 'MARKER 1 GREEN',
        dashboardUrl: 'javascript:alert(1)',
      })
    );
    expect(html).not.toContain('VIEW DECK');
    expect(html).not.toContain('javascript:');
  });
});

describe('DailyDigestEmail', () => {
  it('renders all 4 markers, 5 indicators, and the GATE B countdown', async () => {
    const html = await render(
      DailyDigestEmail({
        state: fixture,
        daysToGate: 133,
        dashboardUrl: 'https://x/admin/pmf',
      })
    );
    expect(html).toContain('TIER A ENGAGEMENTS');
    expect(html).toContain('RETAINED BASE SAAS');
    expect(html).toContain('INBOUND LEAD');
    expect(html).toContain('CAC');
    expect(html).toContain('133');
    expect(html).toContain('LEADING INDICATORS');
    // Each marker status chip is rendered. React inserts <!-- --> between
    // adjacent text children, so we assert on the status tokens and on the
    // status-color hexes that the chip span uses.
    expect(html).toContain('AMBER');
    expect(html).toContain('RED');
    expect(html).toContain('GREEN');
    expect(html).toContain('#C4A868'); // amber
    expect(html).toContain('#B58289'); // red
    expect(html).toContain('#9DB582'); // green
    // View-deck link is present.
    expect(html).toContain('VIEW DECK');
  });

  it('scales percent-unit indicators from fractions to whole-number %', async () => {
    const html = await render(
      DailyDigestEmail({
        state: fixture,
        daysToGate: 10,
        dashboardUrl: 'https://x/admin/pmf',
      })
    );
    // React inserts comment separators between adjacent text children — strip
    // them before the match so "7" + "%" collapses to "7%".
    const stripped = html.replace(/<!--.*?-->/g, '');
    // indicator_c: 0.07 with unit: 'percent' → "7%"
    expect(stripped).toContain('7%');
    // indicator_d: 0.05 with unit: 'percent' → "5%"
    expect(stripped).toContain('5%');
    // The old pre-scale representation must NOT appear.
    expect(stripped).not.toContain('0.07%');
    expect(stripped).not.toContain('0.05%');
    // indicator_a has no unit and value 3 → must NOT render "3%".
    expect(stripped).not.toContain('A: 3%');
  });
});

describe('WeeklyDigestEmail', () => {
  it('renders a single <html> and <body> element (no nesting)', async () => {
    const html = await render(
      WeeklyDigestEmail({
        state: fixture,
        daysToGate: 120,
        weekNumber: 17,
        dashboardUrl: 'https://x/admin/pmf',
        retentionCohorts: cohortsFixture,
      })
    );
    const htmlOpens = html.match(/<html[\s>]/gi) ?? [];
    const bodyOpens = html.match(/<body[\s>]/gi) ?? [];
    expect(htmlOpens.length).toBe(1);
    expect(bodyOpens.length).toBe(1);
  });

  it('renders weekly header, week number, and all 4 marker labels', async () => {
    const html = await render(
      WeeklyDigestEmail({
        state: fixture,
        daysToGate: 120,
        weekNumber: 17,
        dashboardUrl: 'https://x/admin/pmf',
        retentionCohorts: cohortsFixture,
      })
    );
    // React inserts comment separators between adjacent text children — strip
    // them before matching so "WEEK " + "17" collapses to "WEEK 17".
    const stripped = html.replace(/<!--.*?-->/g, '');
    // Weekly header + week number.
    expect(stripped).toContain('PMF WEEKLY DIGEST');
    expect(stripped).toContain('WEEK 17');
    // Daily-digest markers reused.
    expect(stripped).toContain('TIER A ENGAGEMENTS');
    expect(stripped).toContain('RETAINED BASE SAAS');
    expect(stripped).toContain('INBOUND LEAD');
    expect(stripped).toContain('CAC');
  });

  it('renders cohort retention rows with percent scaling', async () => {
    const html = await render(
      WeeklyDigestEmail({
        state: fixture,
        daysToGate: 120,
        weekNumber: 17,
        dashboardUrl: 'https://x/admin/pmf',
        retentionCohorts: cohortsFixture,
      })
    );
    const stripped = html.replace(/<!--.*?-->/g, '');
    expect(stripped).toContain('COHORT RETENTION');
    expect(stripped).toContain('LAST 6 COHORTS');
    // At least one cohort month + the 30D= label.
    expect(stripped).toContain('2026-01');
    expect(stripped).toContain('30D=');
    // 0.75 fraction scales to "75%".
    expect(stripped).toContain('75%');
  });

  it('renders an empty-state placeholder when retentionCohorts is empty', async () => {
    const html = await render(
      WeeklyDigestEmail({
        state: fixture,
        daysToGate: 120,
        weekNumber: 17,
        dashboardUrl: 'https://x/admin/pmf',
        retentionCohorts: [],
      })
    );
    expect(html).toContain('[NO COHORT DATA YET]');
    // No cohort row artefacts when the list is empty.
    expect(html).not.toContain('30D=');
  });
});

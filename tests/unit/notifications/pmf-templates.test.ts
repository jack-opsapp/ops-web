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

  it('appends a % sign for percent-unit indicators only', async () => {
    const html = await render(
      DailyDigestEmail({
        state: fixture,
        daysToGate: 10,
        dashboardUrl: 'https://x/admin/pmf',
      })
    );
    // indicator_c is percent with value 0.07. React inserts comment
    // separators between adjacent text children ("0.07" then "%"), so
    // collapse them out before the match.
    const stripped = html.replace(/<!--.*?-->/g, '');
    expect(stripped).toContain('0.07%');
    // indicator_a has no unit and value 3 → must NOT render "3%".
    expect(stripped).not.toContain('A: 3%');
  });
});

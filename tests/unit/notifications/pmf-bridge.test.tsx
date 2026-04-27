/**
 * Bridge tests — verifies `EMAIL_PMF_NEW_TEMPLATES` selects between legacy
 * and new PMF templates, and that the new templates render usable HTML
 * with the brand markers PR β requires (Mohave font, no retired fonts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@react-email/render";
import {
  thresholdAlertEmail,
  dailyDigestEmail,
  weeklyDigestEmail,
} from "@/lib/email/pmf-bridge";
import type { PmfState } from "@/lib/pmf/types";

const fixture: PmfState = {
  capturedAt: "2026-04-21T00:00:00Z",
  markers: {
    marker_1: { status: "amber", value: 1, target: 2, label: "TIER A ENGAGEMENTS" },
    marker_2: { status: "red", value: 0, target: 5, label: "RETAINED BASE SAAS" },
    marker_3: { status: "green", value: 1, target: 1, label: "INBOUND LEAD" },
    marker_4: { status: "red", value: 4200, target: 15000, label: "CAC" },
  },
  indicators: {
    indicator_a: {
      status: "amber",
      value: 3,
      delta_wow: 1,
      sparkline: [1, 2, 3],
      label: "A",
    },
    indicator_b: {
      status: "green",
      value: 55,
      delta_wow: 5,
      sparkline: [40, 50, 55],
      label: "B",
    },
    indicator_c: {
      status: "green",
      value: 0.07,
      delta_wow: 0.01,
      sparkline: [],
      label: "C",
      unit: "percent",
    },
    indicator_d: {
      status: "green",
      value: 0.05,
      delta_wow: 0,
      sparkline: [],
      label: "D",
      unit: "percent",
    },
    indicator_e: { status: "red", value: 0, delta_wow: 0, sparkline: [], label: "E" },
  },
};

const cohorts = [
  { cohort_month: "2026-01", size: 12, d30: 0.75, d60: 0.58, d90: 0.41 },
];

describe("PMF email bridge — flag selection", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.EMAIL_PMF_NEW_TEMPLATES;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EMAIL_PMF_NEW_TEMPLATES;
    } else {
      process.env.EMAIL_PMF_NEW_TEMPLATES = original;
    }
  });

  it("falls back to legacy threshold alert when flag is unset", async () => {
    delete process.env.EMAIL_PMF_NEW_TEMPLATES;
    const html = await render(
      thresholdAlertEmail({
        trigger: "marker_1_green",
        messageBody: "MARKER 1 GREEN",
        dashboardUrl: "https://x/admin/pmf",
      })
    );
    // Legacy uppercases the trigger as part of the eyebrow.
    expect(html).toContain("MARKER_1_GREEN");
    // Legacy does NOT load Mohave web font tag (it inlines the family).
    expect(html).not.toContain("fonts.googleapis.com/css2?family=Mohave");
  });

  it("renders new threshold alert when flag is true", async () => {
    process.env.EMAIL_PMF_NEW_TEMPLATES = "true";
    const html = await render(
      thresholdAlertEmail({
        trigger: "marker_1_green",
        messageBody: "MARKER 1 GREEN",
        dashboardUrl: "https://x/admin/pmf",
      })
    );
    // New template is wrapped in OpsEmailLayout — loads Mohave webfont.
    expect(html).toContain("Mohave");
    // No retired font loads.
    expect(html).not.toMatch(/Kosugi/i);
    expect(html).not.toMatch(/Bebas/i);
    // The body text is preserved.
    expect(html).toContain("MARKER 1 GREEN");
    // VIEW DECK link rendered when URL is safe.
    expect(html).toContain("VIEW DECK");
  });

  it("renders new daily digest with markers when flag is true", async () => {
    process.env.EMAIL_PMF_NEW_TEMPLATES = "true";
    const html = await render(
      dailyDigestEmail({
        state: fixture,
        daysToGate: 133,
        dashboardUrl: "https://x/admin/pmf",
      })
    );
    expect(html).toContain("Mohave");
    expect(html).not.toMatch(/Kosugi/i);
    expect(html).toContain("TIER A ENGAGEMENTS");
    expect(html).toContain("LEADING INDICATORS");
    expect(html).toContain("133");
  });

  it("renders new weekly digest with cohorts when flag is true", async () => {
    process.env.EMAIL_PMF_NEW_TEMPLATES = "true";
    const html = await render(
      weeklyDigestEmail({
        state: fixture,
        daysToGate: 120,
        weekNumber: 17,
        dashboardUrl: "https://x/admin/pmf",
        retentionCohorts: cohorts,
      })
    );
    expect(html).toContain("Mohave");
    expect(html).not.toMatch(/Kosugi/i);
    expect(html).toContain("WEEK 17");
    expect(html).toContain("2026-01");
    // 0.75 fraction → "75%"
    const stripped = html.replace(/<!--.*?-->/g, "");
    expect(stripped).toContain("75%");
  });
});

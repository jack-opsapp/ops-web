/**
 * Preheader Unicode safety (bug 8db73af6 trail, WEB BUG SWEEP P1-12).
 *
 * The agent-control-plane evidence normalizer refuses any message containing
 * the bidi directional marks U+200E/U+200F (`evidence/unicode-safety.ts`).
 * The stock `@react-email/components` `<Preview>` pads the hidden preheader
 * with a filler that includes both, which made every OPS-sent digest landing
 * in a monitored mailbox unreadable as evidence. These tests pin the
 * emitting side: no OPS email template may render a directional mark, while
 * the preheader mechanism (preview text + invisible padding) must survive.
 */
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";

import { DailyDigestEmail } from "@/emails/pmf/daily-digest";
import { ThresholdAlertEmail } from "@/emails/pmf/threshold-alert";
import {
  WeeklyDigestEmail,
  type WeeklyDigestCohort,
} from "@/emails/pmf/weekly-digest";
import type { PmfState } from "@/lib/pmf/types";
import {
  TEMPLATE_REGISTRY,
  renderTemplate,
} from "@/lib/email/template-registry";
import { Preview } from "@/lib/email/react/primitives/Preview";

const DIRECTIONAL_MARKS = /[\u200E\u200F]/;
/**
 * A long run of invisible preheader filler. Matches the safe filler set
 * (NBSP raw or entity-encoded, ZWNJ, ZWJ) so the assertion proves the
 * padding mechanism survived the fix.
 */
const FILLER_RUN = /(?:\u00A0|&nbsp;|[\u200C\u200D]){100,}/;

const state: PmfState = {
  capturedAt: "2026-04-21T00:00:00Z",
  markers: {
    marker_1: { status: "amber", value: 1, target: 2, label: "TIER A ENGAGEMENTS" },
    marker_2: { status: "red", value: 0, target: 5, label: "RETAINED BASE SAAS" },
    marker_3: { status: "green", value: 1, target: 1, label: "INBOUND LEAD" },
    marker_4: { status: "red", value: 4200, target: 15000, label: "CAC" },
  },
  indicators: {
    indicator_a: { status: "amber", value: 3, delta_wow: 1, sparkline: [1, 2, 3], label: "A" },
    indicator_b: { status: "green", value: 55, delta_wow: 5, sparkline: [40, 50, 55], label: "B" },
    indicator_c: { status: "green", value: 0.07, delta_wow: 0.01, sparkline: [], label: "C", unit: "percent" },
    indicator_d: { status: "green", value: 0.05, delta_wow: 0, sparkline: [], label: "D", unit: "percent" },
    indicator_e: { status: "red", value: 0, delta_wow: 0, sparkline: [], label: "E" },
  },
};

const cohorts: WeeklyDigestCohort[] = [
  { cohort_month: "2026-01", size: 12, d30: 0.75, d60: 0.58, d90: 0.41 },
];

describe("PMF digest preheaders", () => {
  it("daily digest renders no bidi directional marks and keeps the preview padding", async () => {
    const html = await render(
      DailyDigestEmail({ state, daysToGate: 3, dashboardUrl: "https://x/admin/pmf" })
    );
    expect(html).not.toMatch(DIRECTIONAL_MARKS);
    expect(html).toContain("PMF daily digest · GATE B in 3 days");
    expect(html).toMatch(FILLER_RUN);
  });

  it("threshold alert renders no bidi directional marks and keeps the preview padding", async () => {
    const html = await render(
      ThresholdAlertEmail({
        trigger: "marker_1_green",
        messageBody: "MARKER 1 GREEN",
        dashboardUrl: "https://x/admin/pmf",
      })
    );
    expect(html).not.toMatch(DIRECTIONAL_MARKS);
    expect(html).toContain("MARKER 1 GREEN");
    expect(html).toMatch(FILLER_RUN);
  });

  it("weekly digest renders no bidi directional marks and keeps the preview padding", async () => {
    const html = await render(
      WeeklyDigestEmail({
        state,
        daysToGate: 120,
        weekNumber: 17,
        dashboardUrl: "https://x/admin/pmf",
        retentionCohorts: cohorts,
      })
    );
    expect(html).not.toMatch(DIRECTIONAL_MARKS);
    expect(html).toContain("PMF weekly digest · week 17");
    expect(html).toMatch(FILLER_RUN);
  });
});

describe("every registered template", () => {
  it(
    "renders html and text without bidi directional marks",
    async () => {
      expect(TEMPLATE_REGISTRY.length).toBeGreaterThan(0);
      for (const entry of TEMPLATE_REGISTRY) {
        const r = await renderTemplate(entry.templateId, entry.previewProps);
        expect(r, entry.templateId).not.toBeNull();
        expect(r!.html, `${entry.templateId} html`).not.toMatch(DIRECTIONAL_MARKS);
        expect(r!.text, `${entry.templateId} text`).not.toMatch(DIRECTIONAL_MARKS);
      }
    },
    60_000
  );
});

describe("Preview primitive", () => {
  it("renders the preview text and pads with normalizer-safe invisibles only", async () => {
    const html = await render(<Preview>OPS PREHEADER</Preview>);
    expect(html).toContain("OPS PREHEADER");
    expect(html).toContain("data-skip-in-text");
    expect(html).not.toMatch(DIRECTIONAL_MARKS);
    expect(html).not.toMatch(/[\u200B\uFEFF]/);
    expect(html).toMatch(FILLER_RUN);
  });

  it("truncates text at 150 characters and omits the padding", async () => {
    const html = await render(<Preview>{"A".repeat(160)}</Preview>);
    expect(html).toContain("A".repeat(150));
    expect(html).not.toContain("A".repeat(151));
    expect(html).not.toMatch(FILLER_RUN);
  });
});

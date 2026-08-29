import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({
    chat: { completions: { create: vi.fn() } },
  }),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isAIFeatureEnabled: vi.fn(async () => true) },
}));

import {
  buildLeadSummaryContext,
  computeLeadContextAggregates,
  evaluateLeadStaleness,
  hasSubstantiveLeadContext,
  LEAD_SUMMARY_STALENESS_EPSILON_MS,
  type LeadSummaryContextSlices,
} from "@/lib/api/services/lead-summary-service";

/**
 * Bug a2042514. `project_notes` is the iOS-canonical project timeline, and the
 * lead summary engine never read it — so work logged in the field was invisible
 * to the summary the owner reads on the lead.
 */

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const OPPORTUNITY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "99999999-9999-9999-9999-999999999999";
const STAMP = "2026-07-21T10:00:00.000Z";

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: OPPORTUNITY_ID,
    company_id: COMPANY_ID,
    client_id: "client-1",
    client_ref: null,
    title: "Jane Doe — Deck rebuild",
    stage: "qualifying",
    stage_entered_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    contact_name: "Jane Doe",
    contact_email: "jane@example.com",
    address: "123 Main St",
    source: "phone",
    description: null,
    estimated_value: null,
    detected_value: null,
    actual_value: null,
    ai_summary: null,
    ai_summary_updated_at: null,
    assignment_version: 1,
    correspondence_count: 0,
    updated_at: STAMP,
    project_id: PROJECT_ID,
    project_ref: null,
    ...overrides,
  } as Parameters<typeof buildLeadSummaryContext>[0];
}

function projectNote(overrides: Record<string, unknown> = {}) {
  return {
    id: `note-${String(overrides.created_at ?? "1")}`,
    project_id: PROJECT_ID,
    content: "Framing done, vinyl goes on Thursday.",
    event_kind: null,
    created_at: "2026-07-21T18:00:00.000Z",
    ...overrides,
  };
}

function slices(
  overrides: Partial<LeadSummaryContextSlices> = {}
): LeadSummaryContextSlices {
  return {
    activities: [],
    correspondenceEvents: [],
    stageTransitions: [],
    siteVisits: [],
    threadSummaries: [],
    projectNotes: [],
    customerEmails: [],
    ...overrides,
  };
}

describe("computeLeadContextAggregates — project notes", () => {
  it("counts notes and treats them as context freshness", () => {
    const aggregates = computeLeadContextAggregates(
      opportunity(),
      slices({ projectNotes: [projectNote()] as never })
    );

    expect(aggregates.projectNoteCount).toBe(1);
    expect(aggregates.latestContextAtMs).toBe(
      Date.parse("2026-07-21T18:00:00.000Z")
    );
  });

  it("reports zero when a caller supplies no notes at all", () => {
    const aggregates = computeLeadContextAggregates(opportunity(), slices());
    expect(aggregates.projectNoteCount).toBe(0);
  });
});

describe("hasSubstantiveLeadContext — project notes", () => {
  it("qualifies a lead whose only signal is a project note", () => {
    expect(
      hasSubstantiveLeadContext(opportunity(), {
        activityCount: 0,
        siteVisitCount: 0,
        realStageMoveCount: 0,
        projectNoteCount: 1,
      })
    ).toBe(true);
  });

  it("still refuses a lead with no signal of any kind", () => {
    expect(
      hasSubstantiveLeadContext(opportunity(), {
        activityCount: 0,
        siteVisitCount: 0,
        realStageMoveCount: 0,
        projectNoteCount: 0,
      })
    ).toBe(false);
  });
});

describe("evaluateLeadStaleness — project notes", () => {
  it("marks a summarized lead stale once a newer note lands", () => {
    const noteAt = new Date(
      Date.parse(STAMP) + LEAD_SUMMARY_STALENESS_EPSILON_MS + 60_000
    ).toISOString();

    const lead = opportunity({
      ai_summary: "Old summary.",
      ai_summary_updated_at: STAMP,
    });
    const context = slices({
      projectNotes: [projectNote({ created_at: noteAt })] as never,
    });

    expect(
      evaluateLeadStaleness(
        lead,
        computeLeadContextAggregates(lead, context)
      )
    ).toBe("stale");
  });

  it("does not churn on a note older than the summary", () => {
    const lead = opportunity({
      ai_summary: "Old summary.",
      ai_summary_updated_at: STAMP,
    });
    const context = slices({
      projectNotes: [
        projectNote({ created_at: "2026-07-01T09:00:00.000Z" }),
      ] as never,
    });

    expect(
      evaluateLeadStaleness(
        lead,
        computeLeadContextAggregates(lead, context)
      )
    ).toBe("fresh");
  });
});

describe("buildLeadSummaryContext — project_activity", () => {
  it("renders a user note as prose and a system event as an event", () => {
    const bundle = buildLeadSummaryContext(
      opportunity(),
      slices({
        projectNotes: [
          projectNote({
            created_at: "2026-07-21T18:00:00.000Z",
            content: "Framing done, vinyl goes on Thursday.",
            event_kind: null,
          }),
          projectNote({
            created_at: "2026-07-20T18:00:00.000Z",
            content: "ignored for a system event",
            event_kind: "status_change",
          }),
        ] as never,
      })
    );

    expect(bundle).not.toBeNull();
    expect(bundle!.project_activity).toEqual([
      {
        at: "2026-07-20T18:00:00.000Z",
        note: null,
        event: "status_change",
      },
      {
        at: "2026-07-21T18:00:00.000Z",
        note: "Framing done, vinyl goes on Thursday.",
        event: null,
      },
    ]);
  });

  it("caps the section at the five newest notes, oldest first", () => {
    const notes = Array.from({ length: 8 }, (_, index) =>
      projectNote({
        created_at: `2026-07-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
        content: `Note ${index}`,
      })
    );

    const bundle = buildLeadSummaryContext(
      opportunity(),
      slices({ projectNotes: notes as never })
    );

    expect(bundle!.project_activity).toHaveLength(5);
    expect(bundle!.project_activity[0].at).toBe("2026-07-13T12:00:00.000Z");
    expect(bundle!.project_activity[4].at).toBe("2026-07-17T12:00:00.000Z");
  });

  it("clips a long note so one field cannot dominate the prompt", () => {
    const bundle = buildLeadSummaryContext(
      opportunity(),
      slices({
        projectNotes: [projectNote({ content: "x".repeat(1_000) })] as never,
      })
    );

    expect(bundle!.project_activity[0].note!.length).toBe(300);
  });

  it("still returns null for a lead with nothing but a name", () => {
    expect(buildLeadSummaryContext(opportunity(), slices())).toBeNull();
  });

  it("produces a bundle when a project note is the only material", () => {
    const bundle = buildLeadSummaryContext(
      opportunity(),
      slices({ projectNotes: [projectNote()] as never })
    );

    expect(bundle).not.toBeNull();
    expect(bundle!.activity).toEqual([]);
    expect(bundle!.emails).toEqual([]);
    expect(bundle!.project_activity).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  GetSiteVisitContextInputSchema,
  GetSiteVisitContextResultSchema,
  ListSiteVisitsInputSchema,
  ListSiteVisitsResultSchema,
  SITE_VISIT_CONTEXT_DEFAULT_SECTIONS,
  SITE_VISIT_READ_FETCH_LIMIT,
  SITE_VISIT_READ_MAX_PAGE_ITEMS,
  SITE_VISIT_READ_MAX_SOURCE_ROWS,
  SITE_VISIT_READ_SCHEMA_REVISION,
} from "../site-visits";

const VISIT_A = "11111111-1111-4111-8111-111111111111";
const VISIT_B = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";

function proof(domains: readonly ("artifacts" | "site_visits")[]) {
  return {
    proof_ref: `ops_proof:v1:${"a".repeat(64)}`,
    read_at: "2026-08-23T12:00:00.000Z",
    source_revisions: domains.map((domain, index) => ({
      domain,
      source_revision: index + 7,
    })),
  } as const;
}

function evidence(refCharacter = "b") {
  return {
    evidence_ref: `ops_evidence:v1:${refCharacter.repeat(64)}`,
    source_domain: "site_visits",
    source_type: "site_visit_snapshot",
    occurred_at: "2026-08-23T12:00:00.000Z",
  } as const;
}

function bookedVisit(id = VISIT_A, bookedAt = "2026-08-24T09:00:00.000Z") {
  return {
    site_visit_ref: { kind: "site_visit", id },
    link: {
      state: "linked",
      opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
    },
    status: "scheduled",
    booking: {
      state: "booked",
      booked_at: bookedAt,
      scheduled_start: "2026-08-25T17:00:00.000Z",
      duration_minutes: 60,
    },
    created_at: "2026-08-23T10:00:00.000Z",
    completed_at: null,
  } as const;
}

describe("P2 site-visit input contracts", () => {
  it("pins canonical P2 bounds and defaults booked appointments without treating scheduled_at as booking authority", () => {
    expect(SITE_VISIT_READ_SCHEMA_REVISION).toBe("2026-08-22.v1");
    expect(SITE_VISIT_READ_MAX_PAGE_ITEMS).toBe(25);
    expect(SITE_VISIT_READ_FETCH_LIMIT).toBe(26);
    expect(SITE_VISIT_READ_MAX_SOURCE_ROWS).toBe(501);

    expect(
      ListSiteVisitsInputSchema.parse({
        view: "booked_appointments",
        from: "2026-08-20T00:00:00.000Z",
        to: "2026-08-30T00:00:00.000Z",
      })
    ).toEqual({
      view: "booked_appointments",
      from: "2026-08-20T00:00:00.000Z",
      to: "2026-08-30T00:00:00.000Z",
      statuses: ["in_progress", "scheduled"],
      limit: 25,
    });

    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "booked_appointments",
        scheduled_from: "2026-08-20T00:00:00.000Z",
        scheduled_to: "2026-08-30T00:00:00.000Z",
      }).success
    ).toBe(false);
  });

  it("keeps booked windows at 90 days, history at 365 days, and rejects mixed clocks", () => {
    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "booked_appointments",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-04-01T00:00:00.000Z",
      }).success
    ).toBe(true);
    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "booked_appointments",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-04-01T00:00:00.001Z",
      }).success
    ).toBe(false);
    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "visit_history",
        created_from: "2026-01-01T00:00:00.000Z",
        created_to: "2027-01-01T00:00:00.000Z",
      }).success
    ).toBe(true);
    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "visit_history",
        created_from: "2026-01-01T00:00:00.000Z",
        created_to: "2027-01-01T00:00:00.001Z",
      }).success
    ).toBe(false);
    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "visit_history",
        created_from: "2026-01-01T00:00:00.000Z",
        created_to: "2026-02-01T00:00:00.000Z",
        from: "2026-01-01T00:00:00.000Z",
      }).success
    ).toBe(false);
  });

  it("requires valid filters and a meaningful unlinked history selector", () => {
    const valid = {
      view: "visit_history",
      created_from: "2026-01-01T00:00:00.000Z",
      created_to: "2026-02-01T00:00:00.000Z",
      statuses: ["cancelled", "completed"],
      include_unlinked: true,
    } as const;
    expect(ListSiteVisitsInputSchema.safeParse(valid).success).toBe(true);

    for (const invalid of [
      { ...valid, statuses: ["completed", "completed"] },
      {
        ...valid,
        opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
      },
      { ...valid, assignee_ref: { kind: "team_member", id: "MEMBER-1" } },
      {
        ...valid,
        opportunity_ref: { kind: "opportunity", id: OPPORTUNITY.toUpperCase() },
      },
      { ...valid, limit: 26 },
      { ...valid, company_id: CLIENT },
    ]) {
      expect(ListSiteVisitsInputSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("defaults only safe context and conditionally normalizes bounded opt-in section limits", () => {
    const base = GetSiteVisitContextInputSchema.parse({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
      site_visit_ref: { kind: "site_visit", id: VISIT_A },
    });
    expect(base.sections).toEqual([...SITE_VISIT_CONTEXT_DEFAULT_SECTIONS]);
    expect(base).toMatchObject({ timeline_limit: 10 });
    expect(base).not.toHaveProperty("checklist_answer_limit");
    for (const section of ["checklist_answers", "measurements", "notes"]) {
      expect(base.sections).not.toContain(section);
    }

    expect(
      GetSiteVisitContextInputSchema.parse({
        anchor: "unlinked",
        site_visit_ref: { kind: "site_visit", id: VISIT_A },
        sections: [
          "artifact_summary",
          "checklist_answers",
          "deck_design_refs",
          "measurements",
          "notes",
        ],
      })
    ).toEqual({
      anchor: "unlinked",
      site_visit_ref: { kind: "site_visit", id: VISIT_A },
      sections: [
        "artifact_summary",
        "checklist_answers",
        "deck_design_refs",
        "measurements",
        "notes",
      ],
      checklist_answer_limit: 25,
    });
  });

  it("rejects confused anchors, open/duplicate sections, and irrelevant section limits", () => {
    const linked = {
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
      site_visit_ref: { kind: "site_visit", id: VISIT_A },
    } as const;
    for (const invalid of [
      { ...linked, opportunity_ref: undefined },
      { ...linked, sections: ["notes", "notes"] },
      { ...linked, sections: ["raw_photos"] },
      { ...linked, sections: ["notes"], timeline_limit: 10 },
      { ...linked, sections: ["timeline"], checklist_answer_limit: 25 },
      {
        ...linked,
        sections: ["checklist_answers"],
        checklist_answer_limit: 26,
      },
      { ...linked, site_visit_id: VISIT_A },
      {
        anchor: "unlinked",
        site_visit_ref: { kind: "site_visit", id: VISIT_A },
        opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
      },
    ]) {
      expect(GetSiteVisitContextInputSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });
});

describe("P2 site-visit result contracts", () => {
  it("accepts booked rows only in booked_at order and couples proofs and evidence", () => {
    const result = {
      view: "booked_appointments",
      items: [
        bookedVisit(VISIT_A, "2026-08-24T09:00:00.000Z"),
        bookedVisit(VISIT_B, "2026-08-24T10:00:00.000Z"),
      ],
      item_proofs: [
        proof(["site_visits"]),
        {
          ...proof(["site_visits"]),
          proof_ref: `ops_proof:v1:${"c".repeat(64)}`,
        },
      ],
      evidence: [evidence("d"), evidence("e")],
      next_cursor: null,
      collection_proof: {
        ...proof(["site_visits"]),
        proof_ref: `ops_proof:v1:${"f".repeat(64)}`,
        returned_count: 2,
        has_more: false,
      },
    } as const;
    expect(ListSiteVisitsResultSchema.parse(result).items).toHaveLength(2);

    expect(
      ListSiteVisitsResultSchema.safeParse({
        ...result,
        items: [...result.items].reverse(),
      }).success
    ).toBe(false);
    expect(
      ListSiteVisitsResultSchema.safeParse({
        ...result,
        items: [
          { ...result.items[0], scheduled_at: "2026-08-25T17:00:00.000Z" },
        ],
        item_proofs: [result.item_proofs[0]],
        evidence: [result.evidence[0]],
        collection_proof: { ...result.collection_proof, returned_count: 1 },
      }).success
    ).toBe(false);
  });

  it("orders history only by created_at descending and permits explicit unlinked walk-ups", () => {
    const recent = {
      ...bookedVisit(VISIT_B),
      created_at: "2026-08-23T11:00:00.000Z",
    } as const;
    const older = {
      site_visit_ref: { kind: "site_visit", id: VISIT_A },
      link: { state: "unlinked" },
      status: "completed",
      booking: { state: "walk_up" },
      created_at: "2026-08-22T11:00:00.000Z",
      completed_at: "2026-08-22T12:00:00.000Z",
    } as const;
    const parsed = ListSiteVisitsResultSchema.safeParse({
      view: "visit_history",
      items: [recent, older],
      item_proofs: [
        proof(["site_visits"]),
        {
          ...proof(["site_visits"]),
          proof_ref: `ops_proof:v1:${"c".repeat(64)}`,
        },
      ],
      evidence: [evidence("d"), evidence("e")],
      next_cursor: null,
      collection_proof: {
        ...proof(["site_visits"]),
        proof_ref: `ops_proof:v1:${"f".repeat(64)}`,
        returned_count: 2,
        has_more: false,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts bounded safe checklist, artifact, deck-reference, measurement, notes, and timeline projections", () => {
    const result = {
      visit: bookedVisit(),
      sections: {
        artifact_summary: {
          source_count: 3,
          kind_counts: [
            { kind: "deck_design", count: 1 },
            { kind: "photo", count: 2 },
          ],
          review_inclusion: { included_count: 1, not_included_count: 2 },
        },
        booking: bookedVisit().booking,
        checklist_answers: {
          source_count: 2,
          source_has_more: false,
          returned_count: 2,
          result_budget_omitted_count: 0,
          answers: [
            {
              field_ref: `ops_site_visit_field:v1:${"g".repeat(64)}`,
              label: "House finish",
              kind: "short_text",
              required: true,
              answer: {
                state: "recorded",
                value_kind: "text",
                text: "Stucco",
                truncated: false,
                content_kind: "untrusted_business_data",
              },
              content_kind: "untrusted_business_data",
            },
            {
              field_ref: `ops_site_visit_field:v1:${"h".repeat(64)}`,
              label: "Permit confirmed",
              kind: "yes_no_na",
              required: false,
              answer: {
                state: "recorded",
                value_kind: "choice",
                choice: "yes",
              },
              content_kind: "untrusted_business_data",
            },
          ],
        },
        checklist_summary: {
          total_count: 2,
          answered_count: 2,
          required_count: 1,
          required_answered_count: 1,
          completion: "complete",
        },
        deck_design_refs: [
          { deck_design_ref: `ops_deck_design:v1:${"i".repeat(64)}` },
        ],
        lead: {
          state: "linked",
          opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
          client_ref: { kind: "client", id: CLIENT },
        },
        measurements: {
          state: "recorded",
          text: "Back deck 12 ft by 20 ft",
          truncated: false,
          content_kind: "untrusted_business_data",
        },
        notes: {
          state: "recorded",
          text: "Use glass along the back edge.",
          truncated: false,
          content_kind: "untrusted_business_data",
        },
        timeline: [
          { kind: "created", occurred_at: "2026-08-23T10:00:00.000Z" },
          { kind: "booked", occurred_at: "2026-08-24T09:00:00.000Z" },
          { kind: "scheduled_start", occurred_at: "2026-08-25T17:00:00.000Z" },
        ],
      },
      evidence: [evidence()],
      proof: proof(["artifacts", "site_visits"]),
    } as const;
    expect(
      GetSiteVisitContextResultSchema.parse(result).sections.deck_design_refs
    ).toHaveLength(1);
  });

  it("rejects raw geometry, attendees, provider internals, raw photos, identity drafts, malformed counts, and wrong revisions", () => {
    const base = {
      visit: bookedVisit(),
      sections: {
        booking: bookedVisit().booking,
        lead: {
          state: "linked",
          opportunity_ref: { kind: "opportunity", id: OPPORTUNITY },
          client_ref: null,
        },
      },
      evidence: [evidence()],
      proof: proof(["site_visits"]),
    } as const;

    for (const leaked of [
      { geometry: { edges: [] } },
      { attendees: [] },
      { provider_id: "google-event" },
      { raw_photos: ["https://storage.test/photo.jpg"] },
      { identity_draft: { client_name: "Carly" } },
      { internal_notes: "private" },
    ]) {
      expect(
        GetSiteVisitContextResultSchema.safeParse({
          ...base,
          sections: { ...base.sections, ...leaked },
        }).success
      ).toBe(false);
    }

    expect(
      GetSiteVisitContextResultSchema.safeParse({
        ...base,
        sections: {
          ...base.sections,
          checklist_summary: {
            total_count: 1,
            answered_count: 2,
            required_count: 0,
            required_answered_count: 0,
            completion: "complete",
          },
        },
      }).success
    ).toBe(false);
    expect(
      GetSiteVisitContextResultSchema.safeParse({
        ...base,
        sections: {
          ...base.sections,
          artifact_summary: {
            source_count: 1,
            kind_counts: [{ kind: "photo", count: 1 }],
            review_inclusion: { included_count: 1, not_included_count: 0 },
          },
        },
        proof: proof(["site_visits"]),
      }).success
    ).toBe(false);
  });
});

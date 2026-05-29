import { describe, expect, it } from "vitest";
import {
  planLegacyCorrespondenceBackfill,
  type LegacyBackfillActivityRow,
  type LegacyBackfillOpportunityRow,
} from "@/lib/email/opportunity-legacy-correspondence-backfill";

const companyId = "11111111-1111-4111-8111-111111111111";
const opportunityId = "22222222-2222-4222-8222-222222222222";

const baseOpportunity: LegacyBackfillOpportunityRow = {
  id: opportunityId,
  company_id: companyId,
  title: "Deck quote",
  stage: "new_lead",
  archived_at: null,
  deleted_at: null,
  project_id: null,
  project_ref: null,
  created_at: "2026-04-01T16:00:00.000Z",
  stage_entered_at: "2026-04-01T16:00:00.000Z",
  contact_email: "kara.beach@example.com",
  contact_name: "Kara Beach",
  source: "website_form",
};

function activity(
  patch: Partial<LegacyBackfillActivityRow>
): LegacyBackfillActivityRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    company_id: companyId,
    opportunity_id: opportunityId,
    type: "email",
    email_thread_id: "thread-1",
    email_message_id: "message-1",
    subject: "Deck quote",
    content: "Can you quote the deck repair?",
    body_text: "Can you quote the deck repair?",
    from_email: "kara.beach@example.com",
    to_emails: ["jackson@canprodeckandrail.com"],
    cc_emails: [],
    direction: "inbound",
    created_at: "2026-04-01T16:05:00.000Z",
    outcome: null,
    ...patch,
  };
}

describe("legacy correspondence backfill planner", () => {
  it("includes parsed customer form inquiries even when the legacy provider thread is missing", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [
        activity({
          email_thread_id: null,
          email_message_id: null,
          from_email: "notifications@wix-forms.com",
          subject: "Contact Us 3 got a new submission",
          body_text: [
            "Submission summary",
            "Name: Kara Beach",
            "Email: kara.beach@example.com",
            "Message: Can you quote my deck repair?",
          ].join("\n"),
        }),
      ],
      threads: [],
      opportunityThreadLinks: [],
      connections: [],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(1);
    expect(plan.plannedEvents[0]).toMatchObject({
      opportunity_id: opportunityId,
      activity_id: "33333333-3333-4333-8333-333333333333",
      provider_thread_id:
        "legacy-activity:33333333-3333-4333-8333-333333333333",
      provider_message_id: null,
      direction: "inbound",
      party_role: "customer",
      is_meaningful: true,
      source: "legacy_activity_contact_form",
      linked_contact_kind: "customer",
      confidence: "high",
    });
    expect(plan.skippedEvidence).toHaveLength(0);
  });

  it("excludes provider noise when the platform sender has no parsed customer submitter", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [
        activity({
          from_email: "notifications@wix-forms.com",
          subject: "Contact Us 3 got a new submission",
          body_text: "A platform notification without a customer email.",
        }),
      ],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          labels: [],
          primary_category: "LEAD",
        },
      ],
      opportunityThreadLinks: [],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: ["jackson@canprodeckandrail.com"],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(0);
    expect(plan.skippedEvidence).toContainEqual(
      expect.objectContaining({
        sourceId: "33333333-3333-4333-8333-333333333333",
        reason: "provider_noise",
      })
    );
  });

  it("includes deterministic calls, RFQs, and site visits as legacy activity evidence", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [
        activity({
          id: "33333333-3333-4333-8333-333333333331",
          type: "call",
          direction: "inbound",
          email_thread_id: null,
          email_message_id: null,
          subject: "Customer call",
        }),
        activity({
          id: "33333333-3333-4333-8333-333333333332",
          type: "note",
          direction: null,
          email_thread_id: null,
          email_message_id: null,
          subject: "RFQ received for guard rail",
          content: "Customer requested pricing.",
        }),
        activity({
          id: "33333333-3333-4333-8333-333333333333",
          type: "site_visit",
          direction: "outbound",
          email_thread_id: null,
          email_message_id: null,
          subject: "Site visit booked",
        }),
      ],
      threads: [],
      opportunityThreadLinks: [],
      connections: [],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents.map((event) => event.source)).toEqual([
      "legacy_activity_call",
      "legacy_activity_rfq",
      "legacy_activity_site_visit",
    ]);
    expect(plan.plannedEvents.every((event) => event.is_meaningful)).toBe(true);
    expect(plan.lifecycleStateRows).toHaveLength(1);
    expect(plan.opportunityMutationCount).toBe(0);
  });

  it("includes linked thread evidence even when no activity rows exist", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-only-1",
          labels: ["FROM_NEW_SENDER"],
          primary_category: "CUSTOMER",
          subject: "Deck repair quote",
          participants: ["kara.beach@example.com", "jackson@canprodeckandrail.com"],
          first_message_at: "2026-04-01T16:00:00.000Z",
          last_message_at: "2026-04-01T16:05:00.000Z",
          message_count: 1,
          latest_direction: "inbound",
          latest_sender_email: "kara.beach@example.com",
          latest_sender_name: "Kara Beach",
          latest_snippet: "Can you quote the deck repair?",
        },
      ],
      opportunityThreadLinks: [
        {
          opportunity_id: opportunityId,
          thread_id: "thread-only-1",
          connection_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: ["jackson@canprodeckandrail.com"],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(1);
    expect(plan.plannedEvents[0]).toMatchObject({
      opportunity_id: opportunityId,
      activity_id: null,
      provider_thread_id: "thread-only-1",
      provider_message_id: null,
      direction: "inbound",
      party_role: "customer",
      source: "legacy_thread_email",
      source_boundary: "provider_thread_id",
      linked_contact_kind: "customer",
      confidence: "medium",
    });
    expect(plan.lifecycleStateRows).toHaveLength(1);
  });

  it("uses provider_thread_id as the boundary when provider-backed evidence has no message id", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [activity({ email_message_id: null })],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          labels: [],
          primary_category: "LEAD",
        },
      ],
      opportunityThreadLinks: [],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: ["jackson@canprodeckandrail.com"],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(1);
    expect(plan.plannedEvents[0]).toMatchObject({
      provider_thread_id: "thread-1",
      provider_message_id: null,
      source_boundary: "provider_thread_id",
    });
  });

  it("uses linked thread truth when a provider-backed activity without message id contradicts the thread", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [
        activity({
          email_message_id: null,
          direction: "inbound",
          created_at: "2026-04-17T22:09:11.000Z",
          body_text: "Pipeline import: Kara Beach - stage: quoted",
        }),
      ],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          labels: ["AWAITING_REPLY"],
          primary_category: "CUSTOMER",
          subject: "Deck quote",
          participants: ["kara.beach@example.com", "jackson@canprodeckandrail.com"],
          first_message_at: "2026-04-06T21:48:33.000Z",
          last_message_at: "2026-04-14T00:06:05.000Z",
          message_count: 2,
          latest_direction: "outbound",
          latest_sender_email: "jackson@canprodeckandrail.com",
          latest_sender_name: "Jackson Sweet",
          latest_snippet: "Hi Kara, here is the deck quote.",
        },
      ],
      opportunityThreadLinks: [
        {
          opportunity_id: opportunityId,
          thread_id: "thread-1",
          connection_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: ["jackson@canprodeckandrail.com"],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(1);
    expect(plan.plannedEvents[0]).toMatchObject({
      activity_id: "33333333-3333-4333-8333-333333333333",
      provider_thread_id: "thread-1",
      provider_message_id: null,
      direction: "outbound",
      party_role: "ops",
      source: "legacy_thread_email",
      occurred_at: "2026-04-14T00:06:05.000Z",
      source_boundary: "provider_thread_id",
    });
    expect(plan.lifecycleStateRows[0]).toMatchObject({
      last_meaningful_direction: "outbound",
      last_meaningful_at: "2026-04-14T00:06:05.000Z",
    });
  });

  it("allows linked thread truth to supersede earlier message activity evidence", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [
        activity({
          direction: "inbound",
          created_at: "2026-04-01T16:05:00.000Z",
          email_message_id: "message-1",
        }),
      ],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          labels: ["AWAITING_REPLY"],
          primary_category: "CUSTOMER",
          subject: "Deck quote",
          participants: ["kara.beach@example.com", "jackson@canprodeckandrail.com"],
          first_message_at: "2026-04-01T16:05:00.000Z",
          last_message_at: "2026-04-14T00:06:05.000Z",
          message_count: 2,
          latest_direction: "outbound",
          latest_sender_email: "jackson@canprodeckandrail.com",
          latest_sender_name: "Jackson Sweet",
          latest_snippet: "Hi Kara, here is the deck quote.",
        },
      ],
      opportunityThreadLinks: [
        {
          opportunity_id: opportunityId,
          thread_id: "thread-1",
          connection_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: ["jackson@canprodeckandrail.com"],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents.map((event) => event.direction)).toEqual([
      "inbound",
      "outbound",
    ]);
    expect(plan.lifecycleStateRows[0]).toMatchObject({
      last_meaningful_direction: "outbound",
      last_meaningful_at: "2026-04-14T00:06:05.000Z",
    });
  });

  it("includes linked forwarded form threads when internal forwarding preserves submitter proof", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [
        {
          ...baseOpportunity,
          title: "Phil Ohl — form inquiry",
          contact_email: null,
          contact_name: null,
          source: "email",
        },
      ],
      activities: [],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "forwarded-form-thread",
          labels: ["AWAITING_REPLY"],
          primary_category: "CUSTOMER",
          subject: "Fwd: Free Quote form got a new submission",
          participants: [
            "jared@canprodeckandrail.com",
            "victoria@canprodeckandrail.com",
            "jackson@canprodeckandrail.com",
          ],
          first_message_at: "2026-03-29T16:12:02.000Z",
          last_message_at: "2026-03-29T16:12:02.000Z",
          message_count: 1,
          latest_direction: "inbound",
          latest_sender_email: "jared@canprodeckandrail.com",
          latest_sender_name: "Jared",
          latest_snippet:
            [
              "Begin forwarded message: From: Canpro Deck and Rail <notifications@wix-forms.com>",
              "Name: Phil Ohl",
              "Email: phil.ohl@example.com",
              "Message: Can you quote my deck?",
            ].join("\n"),
        },
      ],
      opportunityThreadLinks: [
        {
          opportunity_id: opportunityId,
          thread_id: "forwarded-form-thread",
          connection_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: [
              "jackson@canprodeckandrail.com",
              "jared@canprodeckandrail.com",
              "victoria@canprodeckandrail.com",
            ],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(1);
    expect(plan.plannedEvents[0]).toMatchObject({
      opportunity_id: opportunityId,
      activity_id: null,
      provider_thread_id: "forwarded-form-thread",
      provider_message_id: null,
      direction: "inbound",
      party_role: "customer",
      source: "legacy_thread_contact_form",
      source_boundary: "provider_thread_id",
      linked_contact_kind: "customer",
      confidence: "medium",
    });
  });

  it("skips linked forwarded form threads when no submitter or external participant is present", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [
        {
          ...baseOpportunity,
          title: "Phil Ohl - form inquiry",
          contact_email: null,
          contact_name: null,
          source: "email",
        },
      ],
      activities: [],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "forwarded-form-thread",
          labels: ["AWAITING_REPLY"],
          primary_category: "CUSTOMER",
          subject: "Fwd: Free Quote form got a new submission",
          participants: [
            "jared@canprodeckandrail.com",
            "victoria@canprodeckandrail.com",
            "jackson@canprodeckandrail.com",
          ],
          first_message_at: "2026-03-29T16:12:02.000Z",
          last_message_at: "2026-03-29T16:12:02.000Z",
          message_count: 1,
          latest_direction: "inbound",
          latest_sender_email: "jared@canprodeckandrail.com",
          latest_sender_name: "Jared",
          latest_snippet:
            "Begin forwarded message: From: Canpro Deck and Rail <notifications@wix-forms.com>",
        },
      ],
      opportunityThreadLinks: [
        {
          opportunity_id: opportunityId,
          thread_id: "forwarded-form-thread",
          connection_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: [
              "jackson@canprodeckandrail.com",
              "jared@canprodeckandrail.com",
              "victoria@canprodeckandrail.com",
            ],
          },
        },
      ],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(0);
    expect(plan.skippedEvidence).toContainEqual(
      expect.objectContaining({
        sourceId:
          "thread:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444:forwarded-form-thread",
        reason: "ambiguous_legacy_evidence",
      })
    );
  });

  it("deduplicates planned rows by provider message, activity, and existing P4 proof", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [
        activity({ id: "33333333-3333-4333-8333-333333333331" }),
        activity({ id: "33333333-3333-4333-8333-333333333332" }),
      ],
      threads: [
        {
          company_id: companyId,
          opportunity_id: opportunityId,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          labels: [],
          primary_category: "LEAD",
        },
      ],
      opportunityThreadLinks: [],
      connections: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          company_id: companyId,
          email: "jackson@canprodeckandrail.com",
          sync_filters: {
            companyDomains: ["canprodeckandrail.com"],
            userEmailAddresses: ["jackson@canprodeckandrail.com"],
          },
        },
      ],
      existingEvents: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          company_id: companyId,
          opportunity_id: opportunityId,
          activity_id: null,
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          provider_message_id: "message-1",
          direction: "inbound",
          party_role: "customer",
          is_meaningful: true,
          noise_reason: null,
          occurred_at: "2026-04-01T16:05:00.000Z",
          linked_contact_kind: "customer",
          linked_contact_id: null,
          source: "email_sync",
          subject: "Deck quote",
          from_email: "kara.beach@example.com",
          to_emails: ["jackson@canprodeckandrail.com"],
          cc_emails: [],
        },
      ],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(0);
    expect(plan.skippedEvidence.map((item) => item.reason)).toEqual([
      "duplicate_existing_provider_message_id",
      "duplicate_existing_provider_message_id",
    ]);
  });

  it("does not cross P3 opportunity relationship boundaries", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [activity({})],
      threads: [
        {
          company_id: companyId,
          opportunity_id: "99999999-9999-4999-8999-999999999999",
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-1",
          labels: [],
          primary_category: "LEAD",
        },
      ],
      opportunityThreadLinks: [],
      connections: [],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(0);
    expect(plan.skippedEvidence).toContainEqual(
      expect.objectContaining({
        sourceId: "33333333-3333-4333-8333-333333333333",
        reason: "relationship_mismatch",
      })
    );
  });

  it("does not cross P3 boundaries for linked thread-only evidence", () => {
    const plan = planLegacyCorrespondenceBackfill({
      opportunities: [baseOpportunity],
      activities: [],
      threads: [
        {
          company_id: companyId,
          opportunity_id: "99999999-9999-4999-8999-999999999999",
          connection_id: "44444444-4444-4444-8444-444444444444",
          provider_thread_id: "thread-only-mismatch",
          labels: [],
          primary_category: "CUSTOMER",
          subject: "Deck repair quote",
          participants: ["kara.beach@example.com", "jackson@canprodeckandrail.com"],
          first_message_at: "2026-04-01T16:00:00.000Z",
          last_message_at: "2026-04-01T16:05:00.000Z",
          message_count: 1,
          latest_direction: "inbound",
          latest_sender_email: "kara.beach@example.com",
          latest_sender_name: "Kara Beach",
          latest_snippet: "Can you quote the deck repair?",
        },
      ],
      opportunityThreadLinks: [
        {
          opportunity_id: opportunityId,
          thread_id: "thread-only-mismatch",
          connection_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      connections: [],
      existingEvents: [],
      now: new Date("2026-05-28T20:00:00.000Z"),
    });

    expect(plan.plannedEvents).toHaveLength(0);
    expect(plan.skippedEvidence).toContainEqual(
      expect.objectContaining({
        sourceId:
          "thread:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444:thread-only-mismatch",
        reason: "relationship_mismatch",
      })
    );
  });
});

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
});

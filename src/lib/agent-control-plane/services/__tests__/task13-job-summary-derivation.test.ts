import { describe, expect, it } from "vitest";

import {
  deriveSummaryParticipantsSection,
  deriveSummaryReadinessSection,
} from "../get-job-summary";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SUB_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OPS_USER_ID = "33333333-3333-4333-8333-333333333333";
const EVIDENCE_ID = "evidence:job-summary:project:readiness";

function readinessSources() {
  return {
    site_photos: {
      available: true as const,
      active_remote_by_source: {
        site_visit: 0,
        in_progress: 0,
        completion: 0,
        other: 0,
        measurement: 0,
        deck_design: 1,
      },
      structured_row_count: 1,
      tombstone_count: 0,
      malformed_or_local_count: 0,
      legacy_remote_count: 8,
    },
    customer_record: { resolved: false },
    schedule: {
      eligible_occurrence_count: 1,
      unconfirmed_occurrence_count: 0,
      unconfirmed_occurrence_refs: [],
    },
    crew: {
      eligible_occurrence_count: 1,
      unassigned_occurrence_count: 1,
      unassigned_occurrence_refs: ["project_task:task-1"],
    },
    address: { available: true as const, project_address: "Main Street" },
  };
}

describe("Task 13 job-summary readiness derivation", () => {
  it("reuses the fixed Task 11 rules for photos, customer, schedule, crew, and address", () => {
    const section = deriveSummaryReadinessSection(
      readinessSources(),
      [
        "SITE_PHOTOS_MISSING",
        "CUSTOMER_RECORD_UNRESOLVED",
        "SCHEDULE_UNCONFIRMED",
        "CREW_UNASSIGNED",
        "ADDRESS_INCOMPLETE",
      ],
      [EVIDENCE_ID]
    );

    expect(section).toEqual({
      section: "readiness",
      status: "evaluated",
      value: {
        evaluations: [
          {
            rule_code: "SITE_PHOTOS_MISSING",
            rule_revision: "site-photos-missing:v1",
            status: "issue",
            severity: "warning",
          },
          {
            rule_code: "CUSTOMER_RECORD_UNRESOLVED",
            rule_revision: "customer-record-unresolved:v1",
            status: "issue",
            severity: "blocking",
          },
          {
            rule_code: "SCHEDULE_UNCONFIRMED",
            rule_revision: "schedule-unconfirmed:v1",
            status: "clear",
            severity: "warning",
          },
          {
            rule_code: "CREW_UNASSIGNED",
            rule_revision: "crew-unassigned:v1",
            status: "issue",
            severity: "blocking",
          },
          {
            rule_code: "ADDRESS_INCOMPLETE",
            rule_revision: "address-incomplete:v1",
            status: "issue",
            severity: "blocking",
          },
        ],
      },
      evidence_ids: [EVIDENCE_ID],
    });
  });

  it("maps source failure to the exact fixed not-evaluated rule source", () => {
    const section = deriveSummaryReadinessSection(
      {
        ...readinessSources(),
        site_photos: {
          status: "not_evaluated" as const,
          gap_code: "SOURCE_QUERY_BOUND" as const,
          source_kind: "project_photos" as const,
        },
      },
      ["SITE_PHOTOS_MISSING"],
      [EVIDENCE_ID]
    );
    if (section.status !== "evaluated" || section.section !== "readiness") {
      throw new TypeError("Expected an evaluated readiness section");
    }
    expect(section.value).toEqual({
      evaluations: [
        {
          rule_code: "SITE_PHOTOS_MISSING",
          rule_revision: "site-photos-missing:v1",
          status: "not_evaluated",
          severity: "warning",
          gap_code: "SOURCE_QUERY_BOUND",
          source_kind: "project_photos",
        },
      ],
    });
  });
});

describe("Task 13 job-summary participant derivation", () => {
  it("maps only the purpose-minimized Task 12 identity projection", () => {
    const section = deriveSummaryParticipantsSection(
      {
        participants: [
          {
            source_kind: "primary_client" as const,
            participant_ref: { kind: "client" as const, id: CLIENT_ID },
            display_name: "North Shore Property Group",
            conversation_side: "user" as const,
            resolution_status: "confirmed" as const,
            resolution_basis: "job_client" as const,
            resolution_revision: "job-participant-resolution:v1" as const,
            candidate_count: null,
            content_kind: "untrusted_business_data" as const,
          },
          {
            source_kind: "sub_client" as const,
            participant_ref: {
              kind: "sub_client" as const,
              id: SUB_CLIENT_ID,
            },
            display_name: "Taylor Morgan",
            conversation_side: "user" as const,
            resolution_status: "confirmed" as const,
            resolution_basis: "client_parent" as const,
            resolution_revision: "job-participant-resolution:v1" as const,
            candidate_count: null,
            content_kind: "untrusted_business_data" as const,
          },
          {
            source_kind: "conversation_ambiguous" as const,
            participant_ref: {
              kind: "unknown" as const,
              id: `unknown:sha256:${"a".repeat(64)}`,
            },
            display_name: null,
            conversation_side: null,
            resolution_status: "ambiguous" as const,
            resolution_basis: null,
            resolution_revision: "job-participant-resolution:v1" as const,
            candidate_count_lower_bound: 2,
            content_kind: "untrusted_business_data" as const,
          },
          {
            source_kind: "ops_delivery_user" as const,
            participant_ref: { kind: "ops_user" as const, id: OPS_USER_ID },
            display_name: "Maya Chen",
            conversation_side: "assistant" as const,
            resolution_status: "confirmed" as const,
            resolution_basis: "ops_delivery_actor" as const,
            resolution_revision: "job-participant-resolution:v1" as const,
            candidate_count: null,
            content_kind: "untrusted_business_data" as const,
          },
        ],
        participant_total: 5,
        participants_omitted_count: 1,
        participant_count_completeness: "lower_bound" as const,
      },
      ["evidence:job-summary:project:participants"]
    );

    expect(section).toEqual({
      section: "participants",
      status: "evaluated",
      value: {
        participants: [
          {
            participant_ref: { kind: "client", id: CLIENT_ID },
            side: "user",
            relationship: "primary_client",
            display_name: "North Shore Property Group",
            content_kind: "untrusted_business_data",
          },
          {
            participant_ref: { kind: "sub_client", id: SUB_CLIENT_ID },
            side: "user",
            relationship: "sub_client",
            display_name: "Taylor Morgan",
            content_kind: "untrusted_business_data",
          },
          {
            participant_ref: {
              kind: "unknown",
              id: `unknown:sha256:${"a".repeat(64)}`,
            },
            side: null,
            relationship: "unknown",
            display_name: null,
            content_kind: "untrusted_business_data",
          },
          {
            participant_ref: { kind: "ops_user", id: OPS_USER_ID },
            side: "assistant",
            relationship: "ops_user",
            display_name: "Maya Chen",
            content_kind: "untrusted_business_data",
          },
        ],
        participant_total: 5,
        participants_omitted_count: 1,
        participant_count_completeness: "lower_bound",
      },
      evidence_ids: ["evidence:job-summary:project:participants"],
    });
    expect(JSON.stringify(section)).not.toContain("email");
    expect(JSON.stringify(section)).not.toContain("role_label");
  });
});

import { describe, expect, it } from "vitest";

import {
  CustomerContextInputSchema,
  CustomerContextResultSchema,
  CUSTOMER_CONTEXT_DEFAULT_SECTIONS,
  CUSTOMER_CONTEXT_MAX_CONTACTS,
  CUSTOMER_CONTEXT_MAX_DUPLICATE_CANDIDATES,
  CUSTOMER_CONTEXT_SCHEMA_REVISION,
} from "../customer-context";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SUB_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const DUPLICATE_ID = "33333333-3333-4333-8333-333333333333";

function proof() {
  return {
    proof_ref: `ops_proof:v1:${"a".repeat(64)}`,
    read_at: "2026-08-23T12:00:00.000Z",
    source_revisions: [{ domain: "customer", source_revision: 17 }],
  } as const;
}

function baseResult() {
  return {
    customer: {
      requested_ref: { kind: "client", id: CLIENT_ID },
      canonical_ref: { kind: "client", id: CLIENT_ID },
      relationship: "primary_client",
    },
    sections: {
      profile: {
        display_name: "Carly Hunter",
        parent_display_name: null,
        content_kind: "untrusted_business_data",
      },
    },
    proof: proof(),
  } as const;
}

describe("P2 customer-context input contract", () => {
  it("defaults only the safe base sections and keeps contact and job authority opt-in", () => {
    expect(
      CustomerContextInputSchema.parse({
        customer_ref: { kind: "client", id: CLIENT_ID },
      })
    ).toEqual({
      customer_ref: { kind: "client", id: CLIENT_ID },
      sections: [...CUSTOMER_CONTEXT_DEFAULT_SECTIONS],
    });
    expect(CUSTOMER_CONTEXT_SCHEMA_REVISION).toBe("2026-08-22.v1");
    expect(CUSTOMER_CONTEXT_MAX_CONTACTS).toBe(25);
    expect(CUSTOMER_CONTEXT_MAX_DUPLICATE_CANDIDATES).toBe(25);
    expect(CUSTOMER_CONTEXT_DEFAULT_SECTIONS).not.toContain("business_address");
  });

  it("requires exact closed-purpose consent for contacts and exact selected kinds for job_rollup", () => {
    for (const invalid of [
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["contacts"],
      },
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["profile"],
        contact_purpose: "communication",
      },
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["job_rollup"],
      },
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["profile"],
        job_kinds: ["project"],
      },
    ]) {
      expect(CustomerContextInputSchema.safeParse(invalid).success).toBe(false);
    }

    expect(
      CustomerContextInputSchema.parse({
        customer_ref: { kind: "sub_client", id: SUB_CLIENT_ID },
        sections: ["contacts", "job_rollup", "business_notes"],
        contact_purpose: "scheduling",
        job_kinds: ["project", "opportunity"],
      })
    ).toEqual({
      customer_ref: { kind: "sub_client", id: SUB_CLIENT_ID },
      sections: ["contacts", "job_rollup", "business_notes"],
      contact_purpose: "scheduling",
      job_kinds: ["project", "opportunity"],
    });
  });

  it("keeps the business address behind one explicit closed section", () => {
    const implicit = CustomerContextInputSchema.parse({
      customer_ref: { kind: "client", id: CLIENT_ID },
    });
    expect(implicit.sections).not.toContain("business_address");

    expect(
      CustomerContextInputSchema.parse({
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["business_address", "profile"],
      }).sections
    ).toEqual(["business_address", "profile"]);

    const profileOnly = CustomerContextResultSchema.parse(baseResult());
    expect(JSON.stringify(profileOnly.sections.profile)).not.toContain(
      "address"
    );
  });

  it("rejects duplicate/open sections, duplicate job kinds, noncanonical UUIDs, and unknown fields", () => {
    for (const invalid of [
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["profile", "profile"],
      },
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["financials"],
      },
      {
        customer_ref: {
          kind: "client",
          id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        },
      },
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["job_rollup"],
        job_kinds: ["project", "project"],
      },
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        query: "carly@example.com",
      },
    ]) {
      expect(CustomerContextInputSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("P2 customer-context result contract", () => {
  it("accepts parent context, privacy-safe contactability, untrusted notes, duplicates, and sorted rollups", () => {
    const parsed = CustomerContextResultSchema.parse({
      customer: {
        requested_ref: { kind: "sub_client", id: SUB_CLIENT_ID },
        canonical_ref: { kind: "client", id: CLIENT_ID },
        relationship: "sub_client_parent",
      },
      sections: {
        profile: {
          display_name: "Carly Hunter - Site",
          parent_display_name: "Carly Hunter",
          content_kind: "untrusted_business_data",
        },
        business_address: {
          address: "12 Cedar Road",
          content_kind: "untrusted_business_data",
        },
        contacts: {
          purpose: "communication",
          source_count: 2,
          source_has_more: false,
          returned_count: 2,
          result_budget_omitted_count: 0,
          contacts: [
            {
              contact_ref: { kind: "client", id: CLIENT_ID },
              relationship: "primary_client",
              display_name: "Carly Hunter",
              title: null,
              email: {
                state: "contactable",
                address: "carly@example.com",
              },
              phone: { state: "available", number: "+12505550199" },
              content_kind: "untrusted_business_data",
            },
            {
              contact_ref: { kind: "sub_client", id: SUB_CLIENT_ID },
              relationship: "sub_client",
              display_name: "Carly Hunter - Site",
              title: "Site contact",
              email: { state: "blocked" },
              phone: { state: "ambiguous" },
              content_kind: "untrusted_business_data",
            },
          ],
        },
        preferences: {
          communication: { state: "not_recorded" },
          scheduling: { state: "not_recorded" },
        },
        duplicate_state: {
          state: "review_required",
          source_count: 1,
          source_has_more: false,
          returned_count: 1,
          result_budget_omitted_count: 0,
          candidates: [
            {
              customer_ref: { kind: "client", id: DUPLICATE_ID },
              display_name: "Hunter Holdings",
              confidence: "high",
              content_kind: "untrusted_business_data",
            },
          ],
        },
        business_notes: {
          notes: "Customer asked for glass on the back deck.",
          truncated: false,
          content_kind: "untrusted_business_data",
        },
        job_rollup: {
          kinds: [
            {
              kind: "opportunity",
              total_count: 2,
              status_counts: [
                { status: "quoted", count: 1 },
                { status: "quoting", count: 1 },
              ],
            },
            {
              kind: "project",
              total_count: 1,
              status_counts: [{ status: "in_progress", count: 1 }],
            },
          ],
          content_kind: "untrusted_business_data",
        },
      },
      proof: {
        ...proof(),
        source_revisions: [
          { domain: "customer", source_revision: 17 },
          { domain: "legacy_operational", source_revision: 83 },
        ],
      },
    });

    expect(parsed.sections.contacts?.contacts[1]).toEqual(
      expect.not.objectContaining({ address: expect.anything() })
    );
  });

  it("rejects privacy leaks, raw duplicate signals, financials, malformed ordering, and count drift", () => {
    const invalids: unknown[] = [
      {
        ...baseResult(),
        sections: {
          ...baseResult().sections,
          contacts: {
            purpose: "communication",
            source_count: 1,
            source_has_more: false,
            returned_count: 1,
            result_budget_omitted_count: 0,
            contacts: [
              {
                contact_ref: { kind: "client", id: CLIENT_ID },
                relationship: "primary_client",
                display_name: "Carly Hunter",
                title: null,
                email: { state: "blocked", address: "secret@example.com" },
                phone: { state: "unavailable" },
                content_kind: "untrusted_business_data",
              },
            ],
          },
        },
      },
      {
        ...baseResult(),
        sections: {
          duplicate_state: {
            state: "review_required",
            source_count: 1,
            source_has_more: false,
            returned_count: 1,
            result_budget_omitted_count: 0,
            candidates: [
              {
                customer_ref: { kind: "client", id: DUPLICATE_ID },
                display_name: "Hunter Holdings",
                confidence: "high",
                signals: ["email"],
                content_kind: "untrusted_business_data",
              },
            ],
          },
        },
      },
      {
        ...baseResult(),
        sections: { financials: { revenue: 1 } },
      },
      {
        ...baseResult(),
        sections: {
          contacts: {
            purpose: "communication",
            source_count: 1,
            source_has_more: false,
            returned_count: 0,
            result_budget_omitted_count: 0,
            contacts: [],
          },
        },
      },
      {
        ...baseResult(),
        sections: {
          job_rollup: {
            kinds: [
              {
                kind: "project",
                total_count: 2,
                status_counts: [
                  { status: "in_progress", count: 1 },
                  { status: "accepted", count: 1 },
                ],
              },
            ],
            content_kind: "untrusted_business_data",
          },
        },
      },
    ];

    for (const invalid of invalids) {
      expect(CustomerContextResultSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });
});

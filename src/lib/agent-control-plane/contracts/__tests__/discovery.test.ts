import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CUSTOMER_DISCOVERY_RANKING_REVISION,
  CustomerDiscoveryDataSchema,
  CustomerDiscoveryMatchSchema,
  CustomerDiscoveryResultSchema,
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  DISCOVERY_PROMPT_SAFETY_DIRECTIVE,
  DiscoveryTextQuerySchema,
  JOB_DISCOVERY_RANKING_REVISION,
  JobDiscoveryDataSchema,
  JobDiscoveryMatchSchema,
  JobDiscoveryResultSchema,
  MAX_DISCOVERY_MATCHES,
  MAX_DISCOVERY_OUTPUT_CHARACTERS,
  SearchCustomersInputSchema,
  SearchJobsInputSchema,
    type CustomerDiscoveryData,
    type CustomerDiscoveryMatch,
    type CustomerDiscoveryResult,
    type JobDiscoveryData,
    type JobDiscoveryMatch,
  type JobDiscoveryResult,
  type ParsedSearchCustomersInput,
  type ParsedSearchJobsInput,
  type SearchCustomersInput,
  type SearchJobsInput,
} from "../discovery";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const SUB_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const OPPORTUNITY_ID = "66666666-6666-4666-8666-666666666666";
const PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-08-20T12:00:00.000Z";
const SIGNED_CURSOR = "ops_cursor:v1:discovery:payload.signature";
const RESULT_BUDGET_WARNING = {
  code: "RESULT_BUDGET_EXCEEDED",
  message:
    "Some matches were omitted to keep this result within 60,000 characters.",
} as const;

const SOURCE_FENCE = {
  source_domain: "operations",
  source_type: "operational_read_revision",
  source_id: "private.agent_operational_read_revisions",
  version: "revision:91",
} as const;

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function sourceVersion(
  sourceType: string,
  sourceId: string,
  digest = "a".repeat(64)
) {
  return {
    source_domain: "operations" as const,
    source_type: sourceType,
    source_id: sourceId,
    version: `${sourceType}:v1:sha256:${digest}`,
  };
}

type TestDiscoveryReference = {
  readonly kind: "client" | "sub_client" | "opportunity" | "project";
  readonly id: string;
};

function projectionSourceId(
  reference: TestDiscoveryReference,
  ordinal: number
): string {
  return `${reference.kind}:${reference.id}:ordinal:${ordinal}`;
}

function projectionEvidenceId(
  kind: "customer" | "job",
  reference: TestDiscoveryReference,
  ordinal: number
): string {
  return `evidence:${kind}_discovery_projection:${projectionSourceId(reference, ordinal)}`;
}

function collectionEvidenceId(kind: "customer" | "job"): string {
  return `evidence:${kind}_discovery_collection_projection:company:${COMPANY_ID}`;
}

function evidenceRef(
  evidenceId: string,
  source: ReturnType<typeof sourceVersion>
) {
  return {
    evidence_id: evidenceId,
    ...source,
    occurred_at: NOW,
    relationship: "supports" as const,
    locator: `ops://evidence/${encodeURIComponent(evidenceId)}`,
    trust: "authoritative_ops" as const,
  };
}

function primaryCustomerMatch(index = 1) {
  const customerRef = { kind: "client" as const, id: uuid(index) };
  return {
    customer_ref: customerRef,
    display_name: `Acme Construction ${index}`,
    relationship: { kind: "primary_client" as const },
    match_basis: {
      ranking_revision: "customer-discovery-ranking:v1" as const,
      kind: "prefix_name" as const,
    },
    content_kind: "untrusted_business_data" as const,
    visibility_reason: "current_actor_authorized" as const,
    evidence_ids: [projectionEvidenceId("customer", customerRef, index)],
  };
}

function subCustomerMatch(ordinal = 1) {
  const customerRef = { kind: "sub_client" as const, id: SUB_CLIENT_ID };
  return {
    customer_ref: customerRef,
    display_name: "Acme North Yard",
    relationship: {
      kind: "sub_client" as const,
      parent_client_ref: { kind: "client" as const, id: PARENT_CLIENT_ID },
      parent_display_name: "Acme Construction",
    },
    match_basis: {
      ranking_revision: "customer-discovery-ranking:v1" as const,
      kind: "exact_email" as const,
    },
    content_kind: "untrusted_business_data" as const,
    visibility_reason: "current_actor_authorized" as const,
    evidence_ids: [projectionEvidenceId("customer", customerRef, ordinal)],
  };
}

function opportunityJobMatch(index = 1, ordinal = index) {
  const id = index === 1 ? OPPORTUNITY_ID : uuid(100 + index);
  const jobRef = { kind: "opportunity" as const, id };
  return {
    job_ref: jobRef,
    anchor_refs: [jobRef],
    display_title: `Cedar Street deck ${index}`,
    address: "100 Cedar Street, Vancouver, BC",
    lifecycle_state: "active" as const,
    status: { kind: "opportunity" as const, value: "quoting" as const },
    dates: {
      kind: "opportunity" as const,
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-20T10:00:00.000Z",
    },
    conversion: { state: "not_converted" as const },
    match_basis: {
      ranking_revision: "job-discovery-ranking:v1" as const,
      kind: "prefix_address" as const,
      field: "address" as const,
    },
    content_kind: "untrusted_business_data" as const,
    visibility_reason: "current_actor_authorized" as const,
    evidence_ids: [projectionEvidenceId("job", jobRef, ordinal)],
  };
}

function convertedProjectMatch(ordinal = 1) {
  const jobRef = { kind: "project" as const, id: PROJECT_ID };
  return {
    job_ref: jobRef,
    anchor_refs: [
      { kind: "opportunity" as const, id: OPPORTUNITY_ID },
      { kind: "project" as const, id: PROJECT_ID },
    ],
    display_title: "Cedar Street deck",
    address: "100 Cedar Street, Vancouver, BC",
    lifecycle_state: "active" as const,
    status: { kind: "project" as const, value: "in_progress" as const },
    dates: {
      kind: "project" as const,
      created_at: "2026-08-02T10:00:00.000Z",
      updated_at: "2026-08-20T11:00:00.000Z",
      start_date: "2026-08-21",
      end_date: null,
    },
    conversion: {
      state: "converted" as const,
      opportunity_ref: { kind: "opportunity" as const, id: OPPORTUNITY_ID },
      project_ref: { kind: "project" as const, id: PROJECT_ID },
    },
    match_basis: {
      ranking_revision: "job-discovery-ranking:v1" as const,
      kind: "exact_title" as const,
      field: "title" as const,
    },
    content_kind: "untrusted_business_data" as const,
    visibility_reason: "current_actor_authorized" as const,
    evidence_ids: [projectionEvidenceId("job", jobRef, ordinal)],
  };
}

function customerData(
  matches: CustomerDiscoveryMatch[] = [primaryCustomerMatch()]
) {
  return {
    prompt_safety_directive: DISCOVERY_PROMPT_SAFETY_DIRECTIVE,
    gaps: [] as string[],
    matches,
    returned_match_count: matches.length,
    result_budget_omitted_count: 0,
  };
}

function jobData(matches: JobDiscoveryMatch[] = [opportunityJobMatch()]) {
  return {
    prompt_safety_directive: DISCOVERY_PROMPT_SAFETY_DIRECTIVE,
    gaps: [] as string[],
    matches,
    returned_match_count: matches.length,
    result_budget_omitted_count: 0,
  };
}

function resultEnvelope(
  kind: "customer" | "job",
  data: ReturnType<typeof customerData> | ReturnType<typeof jobData>
) {
  const collectionType = `${kind}_discovery_collection_projection`;
  const childType = `${kind}_discovery_projection`;
  const collectionProofId = collectionEvidenceId(kind);
  const collectionSource = sourceVersion(
    collectionType,
    `company:${COMPANY_ID}`,
    "c".repeat(64)
  );
  const childSources = data.matches.map((match, index) => {
    const reference =
      "customer_ref" in match ? match.customer_ref : match.job_ref;
    return sourceVersion(
      childType,
      projectionSourceId(reference, index + 1),
      (index + 1).toString(16).padStart(64, "0")
    );
  });
  return {
    contract_version: "2026-08-07.v1",
    request_id: `request-${kind}-discovery-contract`,
    generated_at: NOW,
    company_id: COMPANY_ID,
    actor: {
      user_id: ACTOR_ID,
      permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
    },
    freshness: {
      read_at: NOW,
      source_versions: [SOURCE_FENCE, collectionSource, ...childSources],
      stale_after: null,
    },
    data,
    evidence: [
      evidenceRef(collectionProofId, collectionSource),
      ...data.matches.map((match, index) =>
        evidenceRef(match.evidence_ids[0]!, childSources[index]!)
      ),
    ],
    page: { next_cursor: null, has_more: false },
    warnings: [],
  };
}

describe("discovery input contracts", () => {
  it("freezes the schema, ranking, and public size revisions", () => {
    expect(DISCOVERY_CAPABILITY_SCHEMA_REVISION).toBe("2026-08-20.v1");
    expect(CUSTOMER_DISCOVERY_RANKING_REVISION).toBe(
      "customer-discovery-ranking:v1"
    );
    expect(JOB_DISCOVERY_RANKING_REVISION).toBe("job-discovery-ranking:v1");
    expect(MAX_DISCOVERY_MATCHES).toBe(25);
    expect(MAX_DISCOVERY_OUTPUT_CHARACTERS).toBe(60_000);
  });

  it("normalizes literal business text without stripping non-ASCII words", () => {
    expect(
      DiscoveryTextQuerySchema.parse("  Ａcme\u00a0Construction   Ltée  ")
    ).toBe("acme construction ltée");
    expect(DiscoveryTextQuerySchema.parse(`  50% \\x __ "DROP TABLE"  `)).toBe(
      `50% \\x __ "drop table"`
    );
    expect(DiscoveryTextQuerySchema.parse("  Acmé  LTD  ")).toBe("acmé ltd");
  });

  it("rejects unsafe controls, bidi controls, malformed Unicode, and query bounds", () => {
    for (const query of [
      "a",
      "a\u0000b",
      "a\u0007b",
      "a\u0085b",
      "safe\u202Eunsafe",
      "safe\u2066unsafe",
      `bad${String.fromCharCode(0xd800)}surrogate`,
      "Acme x",
      "one two three four five six seven eight nine",
      `${"a".repeat(65)} b`,
      `${"a".repeat(50)} ${"b".repeat(50)} ${"c".repeat(50)} ${"d".repeat(48)}`,
    ]) {
      expect(DiscoveryTextQuerySchema.safeParse(query).success).toBe(false);
    }
    expect(DiscoveryTextQuerySchema.safeParse("ab").success).toBe(true);
    expect(DiscoveryTextQuerySchema.safeParse("ab cd").success).toBe(true);
    expect(
      DiscoveryTextQuerySchema.safeParse(
        `${"a".repeat(50)} ${"b".repeat(50)} ${"c".repeat(50)} ${"d".repeat(47)}`
      ).success
    ).toBe(true);
  });

  it("supports only name, exact email, and exact NANP phone customer lookups", () => {
    expect(
      SearchCustomersInputSchema.parse({ lookup: "name", query: "  Acme  " })
    ).toEqual({
      lookup: "name",
      query: "acme",
      customer_kinds: ["client", "sub_client"],
      limit: 10,
    });
    expect(
      SearchCustomersInputSchema.parse({
        lookup: "exact_email",
        query: "Dispatch@EXAMPLE.COM",
      }).query
    ).toBe("dispatch@example.com");
    expect(
      SearchCustomersInputSchema.parse({
        lookup: "exact_phone",
        query: "+1 (604) 555-0123",
      }).query
    ).toBe("+16045550123");
    expect(
      SearchCustomersInputSchema.parse({
        lookup: "exact_phone",
        query: "604.555.0123",
      }).query
    ).toBe("+16045550123");
    expect(
      SearchCustomersInputSchema.safeParse({
        lookup: "fuzzy_email",
        query: "dispatch@example.com",
      }).success
    ).toBe(false);
  });

  it("rejects partial email and non-exact or non-NANP phone keys", () => {
    for (const query of [
      "@example.com",
      "dispatch@",
      "dispatch@example",
      "dispatch @example.com",
      "dispatch@example.com extra",
    ]) {
      expect(
        SearchCustomersInputSchema.safeParse({
          lookup: "exact_email",
          query,
        }).success
      ).toBe(false);
    }
    for (const query of [
      "+44 20 7946 0958",
      "1-604-555-0123",
      "604-555-0123 ext 4",
      "604-FIX-DECK",
      "604-555-012",
      "604-555-01234",
      "104-555-0123",
      "604-155-0123",
    ]) {
      expect(
        SearchCustomersInputSchema.safeParse({
          lookup: "exact_phone",
          query,
        }).success
      ).toBe(false);
    }
  });

  it("defaults and bounds customer kinds, cursor, and page size strictly", () => {
    expect(
      SearchCustomersInputSchema.parse({
        lookup: "name",
        query: "Acme",
        customer_kinds: ["sub_client"],
        cursor: SIGNED_CURSOR,
        limit: 25,
      })
    ).toEqual({
      lookup: "name",
      query: "acme",
      customer_kinds: ["sub_client"],
      cursor: SIGNED_CURSOR,
      limit: 25,
    });
    for (const input of [
      { lookup: "name", query: "Acme", customer_kinds: [] },
      {
        lookup: "name",
        query: "Acme",
        customer_kinds: ["client", "client"],
      },
      { lookup: "name", query: "Acme", limit: 0 },
      { lookup: "name", query: "Acme", limit: 26 },
      { lookup: "name", query: "Acme", cursor: "x".repeat(513) },
      { lookup: "name", query: "Acme", company_id: COMPANY_ID },
    ]) {
      expect(SearchCustomersInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("defaults address-capable job discovery while preserving filter-only requests", () => {
    expect(SearchJobsInputSchema.parse({ query: "  Cedar  Street  " })).toEqual(
      {
        query: "cedar street",
        query_fields: ["title", "address"],
        job_kinds: ["opportunity", "project"],
        limit: 10,
      }
    );
    expect(
      SearchJobsInputSchema.parse({
        lifecycle_states: ["active"],
        job_kinds: ["project"],
      })
    ).toEqual({
      lifecycle_states: ["active"],
      job_kinds: ["project"],
      limit: 10,
    });
    expect(
      SearchJobsInputSchema.parse({
        query: "100 Cedar Street",
        query_fields: ["address"],
      }).query_fields
    ).toEqual(["address"]);
  });

  it("requires a real job search constraint and unique closed filters", () => {
    for (const input of [
      {},
      { job_kinds: ["project"] },
      { query_fields: ["title"], lifecycle_states: ["active"] },
      { query: "Cedar", query_fields: ["title", "title"] },
      { query: "Cedar", job_kinds: ["project", "project"] },
      { lifecycle_states: ["active", "active"] },
      { query: "Cedar", query_fields: [] },
      { query: "Cedar", job_kinds: [] },
      { query: "Cedar", query_fields: ["description"] },
      { query: "Cedar", limit: 26 },
      { query: "Cedar", sort: "relevance" },
    ]) {
      expect(SearchJobsInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("couples opportunity/project filters to selected job kinds", () => {
    expect(
      SearchJobsInputSchema.safeParse({
        job_kinds: ["opportunity"],
        opportunity_stages: ["quoting"],
      }).success
    ).toBe(true);
    expect(
      SearchJobsInputSchema.safeParse({
        job_kinds: ["project"],
        project_statuses: ["in_progress"],
      }).success
    ).toBe(true);
    expect(
      SearchJobsInputSchema.safeParse({
        job_kinds: ["project"],
        opportunity_stages: ["quoting"],
      }).success
    ).toBe(false);
    expect(
      SearchJobsInputSchema.safeParse({
        job_kinds: ["opportunity"],
        project_statuses: ["in_progress"],
      }).success
    ).toBe(false);
  });

  it("accepts only positive UTC date windows no longer than 365 days", () => {
    expect(
      SearchJobsInputSchema.safeParse({
        date_window: {
          field: "updated_at",
          from: "2025-08-20T00:00:00.000Z",
          to_exclusive: "2026-08-20T00:00:00.000Z",
        },
      }).success
    ).toBe(true);
    for (const date_window of [
      {
        field: "updated_at",
        from: "2026-08-20T00:00:00.000Z",
        to_exclusive: "2026-08-20T00:00:00.000Z",
      },
      {
        field: "created_at",
        from: "2025-08-19T23:59:59.999Z",
        to_exclusive: "2026-08-20T00:00:00.000Z",
      },
      {
        field: "updated_at",
        from: "2026-08-19T00:00:00-07:00",
        to_exclusive: "2026-08-20T00:00:00-07:00",
      },
      {
        field: "started_at",
        from: "2026-08-19T00:00:00.000Z",
        to_exclusive: "2026-08-20T00:00:00.000Z",
      },
    ]) {
      expect(SearchJobsInputSchema.safeParse({ date_window }).success).toBe(
        false
      );
    }
  });

  it("exports distinct raw and normalized input types", () => {
    expectTypeOf<SearchCustomersInput>().toMatchTypeOf<{
      lookup: "name" | "exact_email" | "exact_phone";
      query: string;
    }>();
    expectTypeOf<ParsedSearchCustomersInput>().toMatchTypeOf<{
      customer_kinds: ("client" | "sub_client")[];
      limit: number;
    }>();
    expectTypeOf<SearchJobsInput>().toMatchTypeOf<{
      query?: string;
    }>();
    expectTypeOf<ParsedSearchJobsInput>().toMatchTypeOf<{
      job_kinds: ("opportunity" | "project")[];
      limit: number;
    }>();
  });
});

describe("discovery match contracts", () => {
  it("accepts only strict primary-client and sub-client identity cards", () => {
    expect(
      CustomerDiscoveryMatchSchema.safeParse(primaryCustomerMatch()).success
    ).toBe(true);
    expect(
      CustomerDiscoveryMatchSchema.safeParse(subCustomerMatch()).success
    ).toBe(true);
    for (const match of [
      { ...primaryCustomerMatch(), email: "dispatch@example.com" },
      { ...primaryCustomerMatch(), phone: "+16045550123" },
      { ...primaryCustomerMatch(), address: "100 Cedar Street" },
      { ...primaryCustomerMatch(), notes: "VIP" },
      {
        ...primaryCustomerMatch(),
        relationship: {
          kind: "sub_client",
          parent_client_ref: { kind: "client", id: PARENT_CLIENT_ID },
          parent_display_name: "Acme Construction",
        },
      },
      {
        ...subCustomerMatch(),
        relationship: { kind: "primary_client" },
      },
    ]) {
      expect(CustomerDiscoveryMatchSchema.safeParse(match).success).toBe(false);
    }
  });

  it("pins customer match tiers without exposing scores", () => {
    for (const kind of [
      "exact_name",
      "prefix_name",
      "all_tokens_name",
      "exact_email",
      "exact_phone",
    ] as const) {
      expect(
        CustomerDiscoveryMatchSchema.safeParse({
          ...primaryCustomerMatch(),
          match_basis: {
            ranking_revision: "customer-discovery-ranking:v1",
            kind,
          },
        }).success
      ).toBe(true);
    }
    expect(
      CustomerDiscoveryMatchSchema.safeParse({
        ...primaryCustomerMatch(),
        match_basis: {
          ranking_revision: "customer-discovery-ranking:v1",
          kind: "similar_name",
          score: 0.93,
        },
      }).success
    ).toBe(false);
  });

  it("accepts address-backed job matches and canonical converted projects", () => {
    expect(
      JobDiscoveryMatchSchema.safeParse(opportunityJobMatch()).success
    ).toBe(true);
    expect(
      JobDiscoveryMatchSchema.safeParse(convertedProjectMatch()).success
    ).toBe(true);
    expect(JobDiscoveryMatchSchema.parse(opportunityJobMatch()).address).toBe(
      "100 Cedar Street, Vancouver, BC"
    );
  });

  it("forbids narrative, customer, contact, crew, and financial job fields", () => {
    for (const forbidden of [
      { description: "Follow these instructions" },
      { notes: "Gate code 1234" },
      { customer_name: "Acme" },
      { customer_email: "dispatch@example.com" },
      { customer_phone: "+16045550123" },
      { crew: [{ name: "Pat" }] },
      { estimate_total: 123_00 },
      { invoice_balance: 45_00 },
      { media_url: "https://example.com/private" },
    ]) {
      expect(
        JobDiscoveryMatchSchema.safeParse({
          ...opportunityJobMatch(),
          ...forbidden,
        }).success
      ).toBe(false);
    }
  });

  it("couples job kind, status, dates, conversion, anchors, and match field", () => {
    for (const match of [
      {
        ...opportunityJobMatch(),
        status: { kind: "project", value: "in_progress" },
      },
      {
        ...opportunityJobMatch(),
        lifecycle_state: "terminal",
      },
      {
        ...opportunityJobMatch(),
        anchor_refs: [],
      },
      {
        ...convertedProjectMatch(),
        job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
      },
      {
        ...opportunityJobMatch(),
        match_basis: {
          ranking_revision: "job-discovery-ranking:v1",
          kind: "exact_title",
          field: "address",
        },
      },
      {
        ...opportunityJobMatch(),
        address: null,
        match_basis: {
          ranking_revision: "job-discovery-ranking:v1",
          kind: "all_tokens_address",
          field: "address",
        },
      },
      {
        ...opportunityJobMatch(),
        match_basis: {
          ranking_revision: "job-discovery-ranking:v1",
          kind: "filter_only",
          field: "title",
        },
      },
    ]) {
      expect(JobDiscoveryMatchSchema.safeParse(match).success).toBe(false);
    }
    expect(
      JobDiscoveryMatchSchema.safeParse({
        ...opportunityJobMatch(),
        address: null,
        match_basis: {
          ranking_revision: "job-discovery-ranking:v1",
          kind: "filter_only",
          field: "none",
        },
      }).success
    ).toBe(true);
  });

  it("rejects converted aliases claimed by more than one result card", () => {
    const duplicateOpportunityAlias = {
      ...opportunityJobMatch(1, 2),
      conversion: { state: "linked_project_not_returned" as const },
    };
    const secondProjectId = uuid(900);
    const secondProjectRef = {
      kind: "project" as const,
      id: secondProjectId,
    };
    const duplicateConversionAnchor = {
      ...convertedProjectMatch(2),
      job_ref: secondProjectRef,
      anchor_refs: [
        { kind: "opportunity" as const, id: OPPORTUNITY_ID },
        secondProjectRef,
      ],
      conversion: {
        state: "converted" as const,
        opportunity_ref: {
          kind: "opportunity" as const,
          id: OPPORTUNITY_ID,
        },
        project_ref: secondProjectRef,
      },
      evidence_ids: [projectionEvidenceId("job", secondProjectRef, 2)],
    };

    expect(
      JobDiscoveryDataSchema.safeParse(
        jobData([convertedProjectMatch(), duplicateOpportunityAlias])
      ).success
    ).toBe(false);
    expect(
      JobDiscoveryDataSchema.safeParse(
        jobData([convertedProjectMatch(), duplicateConversionAnchor])
      ).success
    ).toBe(false);
  });
});

describe("discovery AgentResult contracts", () => {
  it("requires exact returned counts and fixed proof-bound gaps", () => {
    expect(CustomerDiscoveryDataSchema.safeParse(customerData()).success).toBe(
      true
    );
    expect(JobDiscoveryDataSchema.safeParse(jobData()).success).toBe(true);
    for (const gaps of [
      ["SOURCE_QUERY_BOUND"],
      ["SOURCE_DATA_INVALID"],
      ["SOURCE_QUERY_BOUND", "SOURCE_DATA_INVALID"],
    ]) {
      expect(
        CustomerDiscoveryDataSchema.safeParse({
          ...customerData(),
          gaps,
        }).success
      ).toBe(true);
    }
    for (const data of [
      { ...customerData(), returned_match_count: 0 },
      { ...customerData(), result_budget_omitted_count: -1 },
      { ...customerData(), gaps: ["SOURCE_UNAVAILABLE"] },
      {
        ...customerData(),
        gaps: ["SOURCE_QUERY_BOUND", "SOURCE_QUERY_BOUND"],
      },
    ]) {
      expect(CustomerDiscoveryDataSchema.safeParse(data).success).toBe(false);
    }
  });

  it("caps both result collections at 25 unique matches", () => {
    const twentyFiveCustomers = Array.from({ length: 25 }, (_, index) =>
      primaryCustomerMatch(index + 1)
    );
    const twentySixCustomers = [
      ...twentyFiveCustomers,
      primaryCustomerMatch(26),
    ];
    expect(
      CustomerDiscoveryDataSchema.safeParse(customerData(twentyFiveCustomers))
        .success
    ).toBe(true);
    expect(
      CustomerDiscoveryDataSchema.safeParse(customerData(twentySixCustomers))
        .success
    ).toBe(false);
    expect(
      CustomerDiscoveryDataSchema.safeParse(
        customerData([primaryCustomerMatch(), primaryCustomerMatch()])
      ).success
    ).toBe(false);
  });

  it("requires a page and one collection proof even for an empty result", () => {
    const emptyCustomerResult = resultEnvelope("customer", customerData([]));
    const emptyJobResult = resultEnvelope("job", jobData([]));
    expect(
      CustomerDiscoveryResultSchema.safeParse(emptyCustomerResult).success
    ).toBe(true);
    expect(JobDiscoveryResultSchema.safeParse(emptyJobResult).success).toBe(
      true
    );
    expect(
      CustomerDiscoveryResultSchema.safeParse({
        ...emptyCustomerResult,
        page: undefined,
      }).success
    ).toBe(false);
    expect(
      CustomerDiscoveryResultSchema.safeParse({
        ...emptyCustomerResult,
        evidence: [],
        freshness: {
          ...emptyCustomerResult.freshness,
          source_versions: [SOURCE_FENCE],
        },
      }).success
    ).toBe(false);
  });

  it("requires signed continuation cursors in discovery results", () => {
    const result = resultEnvelope("customer", customerData());
    expect(
      CustomerDiscoveryResultSchema.safeParse({
        ...result,
        page: { next_cursor: SIGNED_CURSOR, has_more: true },
      }).success
    ).toBe(true);
    expect(
      CustomerDiscoveryResultSchema.safeParse({
        ...result,
        page: { next_cursor: "not-a-signed-cursor", has_more: true },
      }).success
    ).toBe(false);
  });

  it("couples ordered matches to exact projection identities and locators", () => {
    const result = resultEnvelope(
      "customer",
      customerData([primaryCustomerMatch(1), primaryCustomerMatch(2)])
    );
    expect(CustomerDiscoveryResultSchema.safeParse(result).success).toBe(true);
    const childEvidence = result.evidence[1]!;
    const secondChildEvidence = result.evidence[2]!;
    const firstChildSource = result.freshness.source_versions[2]!;
    const secondChildSource = result.freshness.source_versions[3]!;
    const wrongEvidenceId = "evidence:customer_discovery_projection:wrong";
    const cases = [
      { ...result, evidence: result.evidence.slice(1) },
      { ...result, evidence: result.evidence.slice(0, 1) },
      { ...result, evidence: [...result.evidence, childEvidence] },
      {
        ...result,
        evidence: [result.evidence[0], secondChildEvidence, childEvidence],
      },
      {
        ...result,
        freshness: {
          ...result.freshness,
          source_versions: [
            result.freshness.source_versions[0],
            result.freshness.source_versions[1],
            secondChildSource,
            firstChildSource,
          ],
        },
      },
      {
        ...result,
        evidence: result.evidence.map((evidence, index) =>
          index === 1
            ? { ...evidence, ...secondChildSource, evidence_id: evidence.evidence_id }
            : index === 2
              ? { ...evidence, ...firstChildSource, evidence_id: evidence.evidence_id }
              : evidence
        ),
      },
      {
        ...result,
        data: {
          ...result.data,
          matches: result.data.matches.map((match, index) =>
            index === 0 ? { ...match, evidence_ids: [wrongEvidenceId] } : match
          ),
        },
        evidence: result.evidence.map((evidence, index) =>
          index === 1 ? { ...evidence, evidence_id: wrongEvidenceId } : evidence
        ),
      },
      {
        ...result,
        evidence: result.evidence.map((evidence, index) =>
          index === 1 ? { ...evidence, locator: "ops://noncanonical" } : evidence
        ),
      },
      {
        ...result,
        freshness: {
          ...result.freshness,
          source_versions: result.freshness.source_versions.slice(0, 2),
        },
      },
      {
        ...result,
        freshness: {
          ...result.freshness,
          source_versions: [
            ...result.freshness.source_versions,
            sourceVersion("unexpected_projection", "unexpected"),
          ],
        },
      },
      {
        ...result,
        evidence: result.evidence.map((evidence, index) =>
          index === 0 ? { ...evidence, trust: "model_transcribed" } : evidence
        ),
      },
      {
        ...result,
        evidence: result.evidence.map((evidence, index) =>
          index === 0
            ? { ...evidence, excerpt: "Hidden source detail" }
            : evidence
        ),
      },
    ];
    for (const candidate of cases) {
      expect(CustomerDiscoveryResultSchema.safeParse(candidate).success).toBe(
        false
      );
    }
  });

  it("rejects contact values from every public proof metadata channel", () => {
    const result = resultEnvelope("customer", customerData([subCustomerMatch()]));
    const childSource = result.freshness.source_versions[2]!;
    const contactEvidenceId = "dispatch@example.com";
    const contactVersion = "dispatch@example.com";
    const cases = [
      {
        ...result,
        freshness: {
          ...result.freshness,
          source_versions: result.freshness.source_versions.map((source, index) =>
            index === 2 ? { ...source, source_id: "dispatch@example.com" } : source
          ),
        },
        evidence: result.evidence.map((evidence, index) =>
          index === 1
            ? { ...evidence, source_id: "dispatch@example.com" }
            : evidence
        ),
      },
      {
        ...result,
        evidence: result.evidence.map((evidence, index) =>
          index === 1
            ? { ...evidence, locator: "mailto:dispatch@example.com" }
            : evidence
        ),
      },
      {
        ...result,
        data: {
          ...result.data,
          matches: [{ ...result.data.matches[0]!, evidence_ids: [contactEvidenceId] }],
        },
        evidence: result.evidence.map((evidence, index) =>
          index === 1 ? { ...evidence, evidence_id: contactEvidenceId } : evidence
        ),
      },
      {
        ...result,
        freshness: {
          ...result.freshness,
          source_versions: result.freshness.source_versions.map((source, index) =>
            index === 2 ? { ...childSource, version: contactVersion } : source
          ),
        },
        evidence: result.evidence.map((evidence, index) =>
          index === 1 ? { ...evidence, version: contactVersion } : evidence
        ),
      },
      {
        ...result,
        warnings: [
          {
            code: "CONTACT_LEAK",
            message: "dispatch@example.com / +16045550123",
          },
        ],
      },
    ];

    for (const candidate of cases) {
      expect(CustomerDiscoveryResultSchema.safeParse(candidate).success).toBe(
        false
      );
    }
  });

  it("couples result-budget omission counts to the one fixed warning", () => {
    const matches = [primaryCustomerMatch()];
    const maximallyPruned = {
      ...resultEnvelope("customer", {
        ...customerData(matches),
        result_budget_omitted_count: 24,
      }),
      warnings: [RESULT_BUDGET_WARNING],
    };
    expect(CustomerDiscoveryResultSchema.safeParse(maximallyPruned).success).toBe(
      true
    );

    const cases = [
      resultEnvelope("customer", {
        ...customerData(matches),
        result_budget_omitted_count: 1,
      }),
      {
        ...resultEnvelope("customer", customerData(matches)),
        warnings: [RESULT_BUDGET_WARNING],
      },
      {
        ...resultEnvelope("customer", {
          ...customerData(matches),
          result_budget_omitted_count: 1,
        }),
        warnings: [
          {
            code: RESULT_BUDGET_WARNING.code,
            message: "dispatch@example.com",
          },
        ],
      },
      {
        ...resultEnvelope("customer", {
          ...customerData(matches),
          result_budget_omitted_count: 25,
        }),
        warnings: [RESULT_BUDGET_WARNING],
      },
    ];
    for (const candidate of cases) {
      expect(CustomerDiscoveryResultSchema.safeParse(candidate).success).toBe(
        false
      );
    }
  });

  it("applies the same strict proof coupling to job results", () => {
    const result = resultEnvelope("job", jobData([convertedProjectMatch()]));
    expect(JobDiscoveryResultSchema.safeParse(result).success).toBe(true);
    expect(
      JobDiscoveryResultSchema.safeParse({
        ...result,
        evidence: result.evidence.slice(1),
      }).success
    ).toBe(false);
    expect(
      JobDiscoveryResultSchema.safeParse({
        ...result,
        data: { ...result.data, returned_match_count: 0 },
      }).success
    ).toBe(false);
  });

  it("rejects serialized AgentResults above 60,000 characters", () => {
    const matches = Array.from({ length: 25 }, (_, index) => ({
      ...opportunityJobMatch(index + 1),
      display_title: "t".repeat(1_000),
      address: "a".repeat(2_000),
    }));
    const oversized = resultEnvelope("job", jobData(matches));
    expect(JSON.stringify(oversized).length).toBeGreaterThan(60_000);
    expect(JobDiscoveryResultSchema.safeParse(oversized).success).toBe(false);
  });

  it("exports concrete normalized data and result types", () => {
    expectTypeOf<CustomerDiscoveryData>().toMatchTypeOf<{
      returned_match_count: number;
      result_budget_omitted_count: number;
    }>();
    expectTypeOf<CustomerDiscoveryResult>().toMatchTypeOf<{
      data: CustomerDiscoveryData;
    }>();
    expectTypeOf<JobDiscoveryData>().toMatchTypeOf<{
      returned_match_count: number;
      result_budget_omitted_count: number;
    }>();
    expectTypeOf<JobDiscoveryResult>().toMatchTypeOf<{
      data: JobDiscoveryData;
    }>();
  });
});

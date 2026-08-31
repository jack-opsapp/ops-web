import { describe, expect, it } from "vitest";

import {
  DAY_CLOSEOUT_METRIC_DEFINITION_REVISION,
  DAY_CLOSEOUT_PROMPT_SAFETY_DIRECTIVE,
  CommitDayCloseoutInputSchema,
  DayCloseoutResultSchema,
  PrepareDayCloseoutInputSchema,
} from "../day-closeout";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

function validResult() {
  return {
    contract_version: "2026-08-07.v1",
    schema_revision: "2026-08-30.v1",
    metric_definition_revision: DAY_CLOSEOUT_METRIC_DEFINITION_REVISION,
    run_id: UUID_A,
    business_date: "2026-08-30",
    timezone: "America/Vancouver",
    prepared_at: "2026-08-31T03:00:00.000Z",
    state: "partial",
    components: [
      {
        component: "tomorrow_readiness",
        state: "attention",
        time_window: {
          start_at: "2026-08-31T07:00:00.000Z",
          end_at_exclusive: "2026-09-01T07:00:00.000Z",
        },
        population_count: 2,
        attention_count: 1,
        coverage: {
          state: "complete",
          inspected_count: 2,
          omitted_count: 0,
          missing_reasons: [],
          fresh_at: "2026-08-31T03:00:00.000Z",
        },
        source_revisions: [{ domain: "schedule", source_revision: 9 }],
        evidence_refs: ["proof:schedule:1"],
      },
      {
        component: "outstanding_money",
        state: "attention",
        time_window: {
          start_at: null,
          end_at_exclusive: "2026-08-31T03:00:00.000Z",
        },
        population_count: 3,
        attention_count: 2,
        coverage: {
          state: "complete",
          inspected_count: 3,
          omitted_count: 0,
          missing_reasons: [],
          fresh_at: "2026-08-31T03:00:00.000Z",
        },
        source_revisions: [{ domain: "sales_documents", source_revision: 12 }],
        evidence_refs: ["proof:invoice:1", "proof:invoice:2"],
      },
      {
        component: "stalled_pipeline",
        state: "clear",
        time_window: {
          start_at: null,
          end_at_exclusive: "2026-08-31T03:00:00.000Z",
        },
        population_count: 4,
        attention_count: 0,
        coverage: {
          state: "complete",
          inspected_count: 4,
          omitted_count: 0,
          missing_reasons: [],
          fresh_at: "2026-08-31T03:00:00.000Z",
        },
        source_revisions: [{ domain: "work_queue", source_revision: 7 }],
        evidence_refs: [],
      },
      {
        component: "unresolved_correspondence",
        state: "not_evaluated",
        time_window: {
          start_at: null,
          end_at_exclusive: "2026-08-31T03:00:00.000Z",
        },
        population_count: 5,
        attention_count: null,
        coverage: {
          state: "unavailable",
          inspected_count: 4,
          omitted_count: 1,
          missing_reasons: ["unreadable_correspondence"],
          fresh_at: "2026-08-31T03:00:00.000Z",
        },
        source_revisions: [{ domain: "correspondence", source_revision: 22 }],
        evidence_refs: ["proof:delivery-source:rejected"],
      },
      {
        component: "work_due",
        state: "attention",
        time_window: {
          start_at: null,
          end_at_exclusive: "2026-08-31T03:00:00.000Z",
        },
        population_count: 6,
        attention_count: 2,
        coverage: {
          state: "partial",
          inspected_count: 6,
          omitted_count: 2,
          missing_reasons: ["result_bound_reached"],
          fresh_at: "2026-08-31T03:00:00.000Z",
        },
        source_revisions: [{ domain: "work_queue", source_revision: 7 }],
        evidence_refs: ["proof:queue:1", "proof:queue:2"],
      },
    ],
    findings: [
      {
        finding_ref: "finding:invoice:1",
        component: "outstanding_money",
        reason: "invoice_overdue",
        priority: "critical",
        title: "INV-1042",
        subject_ref: { kind: "invoice", id: UUID_B },
        attention_at: "2026-08-30T20:00:00.000Z",
        content_kind: "untrusted_business_data",
      },
    ],
    outstanding_balances: [
      { currency: "CAD", amount_minor: 125000, invoice_count: 2 },
      { currency: "USD", amount_minor: 5000, invoice_count: 1 },
    ],
    communication_briefs: [] as Array<Record<string, unknown>>,
    filing: {
      kind: "approval_required",
      action_id: UUID_C,
      change_set_id: UUID_B,
      approval_url: "/agent/queue",
      preview: {
        business_date: "2026-08-30",
        finding_count: 1,
        filing_statement: "File this day closeout inside OPS.",
        truth_boundary: "No messages sent. No money moved.",
        preview_sha256:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
    prompt_safety: DAY_CLOSEOUT_PROMPT_SAFETY_DIRECTIVE,
  };
}

describe("PrepareDayCloseoutInputSchema", () => {
  it("accepts only a canonical optional business date/timezone and durable key", () => {
    expect(
      PrepareDayCloseoutInputSchema.parse({
        business_date: "2026-08-30",
        display_timezone: "America/Vancouver",
        idempotency_key: "closeout-2026-08-30",
      })
    ).toEqual({
      business_date: "2026-08-30",
      display_timezone: "America/Vancouver",
      idempotency_key: "closeout-2026-08-30",
    });

    expect(() =>
      PrepareDayCloseoutInputSchema.parse({
        company_id: UUID_A,
        idempotency_key: "closeout-2026-08-30",
      })
    ).toThrow();
    expect(() =>
      PrepareDayCloseoutInputSchema.parse({
        business_date: "2026-8-30",
        idempotency_key: "closeout-2026-08-30",
      })
    ).toThrow();
    expect(() =>
      PrepareDayCloseoutInputSchema.parse({ idempotency_key: "short" })
    ).toThrow();
  });
});

describe("CommitDayCloseoutInputSchema", () => {
  it("binds the commit to the exact action, change set, confirmation, preview, and replay key", () => {
    const value = {
      action_id: UUID_A,
      change_set_id: UUID_B,
      preview_sha256:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      idempotency_key: "file-closeout-2026-08-30",
    };

    expect(CommitDayCloseoutInputSchema.parse(value)).toEqual(value);
    expect(() =>
      CommitDayCloseoutInputSchema.parse({
        ...value,
        confirmation_receipt_id: UUID_C,
        preview_sha256:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        confirmed: true,
      })
    ).toThrow();
  });
});

describe("DayCloseoutResultSchema", () => {
  it("accepts a canonical result with separate currencies and disclosed incomplete mail", () => {
    expect(DayCloseoutResultSchema.parse(validResult())).toEqual(validResult());
  });

  it("rejects correspondence attention when readability coverage is unavailable", () => {
    const value = validResult();
    value.components[3] = {
      ...value.components[3],
      state: "attention",
      attention_count: 1,
    } as (typeof value.components)[number];
    expect(() => DayCloseoutResultSchema.parse(value)).toThrow();
  });

  it("rejects noncanonical or combined currency totals", () => {
    const value = validResult();
    value.outstanding_balances = [
      { currency: "CAD", amount_minor: 130000, invoice_count: 3 },
      { currency: "CAD", amount_minor: 5000, invoice_count: 1 },
    ];
    expect(() => DayCloseoutResultSchema.parse(value)).toThrow();
  });

  it("rejects communication briefs when correspondence coverage is incomplete", () => {
    const value = validResult();
    value.communication_briefs = [
      {
        brief_ref: "brief:lead:1",
        purpose: "pipeline_follow_up",
        subject_ref: { kind: "opportunity", id: UUID_B },
        factual_points: ["Follow up on the open quote."],
        source_evidence_refs: ["proof:thread:1"],
        content_kind: "untrusted_business_data",
      },
    ];
    expect(() => DayCloseoutResultSchema.parse(value)).toThrow();
  });

  it("rejects a filing preview that hides the side-effect boundary", () => {
    const value = validResult();
    if (value.filing.kind !== "approval_required") throw new Error("fixture");
    value.filing.preview.truth_boundary = "Closeout complete.";
    expect(() => DayCloseoutResultSchema.parse(value)).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import {
  SALES_TRUTH_METRIC_DEFINITION_REVISION,
  SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE,
  SALES_TRUTH_SCHEMA_REVISION,
  SALES_TRUTH_WINDOW_DAYS,
  AnalyzeSalesTruthInputSchema,
  SalesTruthResultSchema,
  SalesTruthSourceSnapshotSchema,
} from "../sales-truth";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";

describe("sales-truth contract", () => {
  it("accepts only the server-owned empty input", () => {
    expect(AnalyzeSalesTruthInputSchema.parse({})).toEqual({});
    expect(() => AnalyzeSalesTruthInputSchema.parse({ days: 30 })).toThrow();
    expect(() =>
      AnalyzeSalesTruthInputSchema.parse({ company_id: OPPORTUNITY_ID })
    ).toThrow();
  });

  it("pins and validates the bounded source snapshot", () => {
    const snapshot = SalesTruthSourceSnapshotSchema.parse({
      observed_at: "2026-09-01T12:00:00.000Z",
      business_date: "2026-09-01",
      context: {
        timezone: "America/Vancouver",
        currency_code: "CAD",
      },
      window: {
        starts_on: "2026-03-06",
        ends_on: "2026-09-01",
        days: SALES_TRUTH_WINDOW_DAYS,
      },
      source_revisions: { company: 7, sales_truth: 19 },
      source_counts: {
        opportunities: 1,
        transitions: 1,
        dispositions: 0,
        activities: 2,
      },
      source_bounds: {
        opportunities: false,
        transitions: false,
        dispositions: false,
        activities: false,
      },
      opportunities: [
        {
          id: OPPORTUNITY_ID,
          created_at: "2026-08-01T12:00:00.000Z",
          stage: "won",
          source: "website",
          legacy_loss_reason: null,
        },
      ],
      transitions: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          opportunity_id: OPPORTUNITY_ID,
          from_stage: "quoted",
          to_stage: "won",
          transitioned_at: "2026-08-05T12:00:00.000Z",
          duration_minutes: 1_440,
        },
      ],
      dispositions: [],
      activities: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          opportunity_id: OPPORTUNITY_ID,
          direction: "inbound",
          type: "email",
          occurred_at: "2026-08-01T13:00:00.000Z",
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          opportunity_id: OPPORTUNITY_ID,
          direction: "outbound",
          type: "email",
          occurred_at: "2026-08-01T14:00:00.000Z",
        },
      ],
    });

    expect(snapshot.source_revisions.sales_truth).toBe(19);
    expect(snapshot.activities).toHaveLength(2);
    expect(() =>
      SalesTruthSourceSnapshotSchema.parse({
        ...snapshot,
        context: { ...snapshot.context, timezone: "Not/A_Zone" },
      })
    ).toThrow();
    expect(() =>
      SalesTruthSourceSnapshotSchema.parse({
        ...snapshot,
        source_counts: { ...snapshot.source_counts, activities: 1 },
      })
    ).toThrow();
  });

  it("rejects internally inconsistent metric and recommendation output", () => {
    const result = {
      schema_revision: SALES_TRUTH_SCHEMA_REVISION,
      metric_definition_revision: SALES_TRUTH_METRIC_DEFINITION_REVISION,
      observed_at: "2026-09-01T12:00:00.000Z",
      context: {
        timezone: "America/Vancouver",
        currency: { code: "CAD", applicability: "context_only" },
      },
      window: {
        starts_on: "2026-03-06",
        ends_on: "2026-09-01",
        days: SALES_TRUTH_WINDOW_DAYS,
        population_rule:
          "non_deleted_non_merged_opportunities_created_in_company_local_window",
      },
      population: {
        cohort_count: 12,
        qualified_count: 12,
        resolved_count: 10,
        won_count: 6,
        lost_count: 4,
        open_qualified_count: 2,
        new_lead_count: 0,
        discarded_count: 0,
      },
      close_rate: {
        state: "usable",
        numerator_won: 6,
        denominator_resolved: 10,
        rate_pct: 60,
        wilson_95_pct: { low: 31.27, high: 83.18 },
        unresolved_sensitivity_pct: { low: 50, high: 66.67 },
        confidence: "low",
      },
      attribution: {
        population_count: 12,
        attributed_count: 12,
        missing_count: 0,
        coverage_pct: 100,
        segments: [
          {
            source: "website",
            cohort_count: 12,
            qualified_count: 12,
            won_count: 6,
            lost_count: 4,
            open_qualified_count: 2,
            resolved_close_rate_pct: 60,
            confidence: "low",
          },
        ],
      },
      loss_reasons: {
        lost_count: 4,
        observed_count: 4,
        structured_count: 4,
        legacy_count: 0,
        missing_count: 0,
        unmapped_count: 0,
        coverage_pct: 100,
        confidence: "insufficient",
        categories: [{ category: "price", count: 4, share_pct: 100 }],
      },
      first_response: {
        cohort_count: 12,
        linked_lead_count: 10,
        inbound_observed_count: 10,
        responded_count: 8,
        unresponded_count: 2,
        linkage_coverage_pct: 83.33,
        response_coverage_pct: 80,
        median_minutes: null,
        p75_minutes: null,
        confidence: "insufficient",
      },
      pipeline_velocity: {
        qualified_count: 12,
        history_observed_count: 10,
        history_coverage_pct: 83.33,
        qualification_to_close: {
          sample_count: 0,
          coverage_pct: 0,
          median_minutes: null,
          p75_minutes: null,
          confidence: "insufficient",
          supporting_record_refs: [],
        },
        stages: [],
      },
      completeness: {
        state: "partial",
        reasons: ["loss_reason_sample_insufficient"],
        source_counts: {
          opportunities: 12,
          transitions: 10,
          dispositions: 4,
          activities: 18,
        },
        source_bounds: {
          opportunities: false,
          transitions: false,
          dispositions: false,
          activities: false,
        },
      },
      recommendations: [
        {
          rank: 1,
          code: "capture_loss_reasons",
          action: "Capture a loss reason every time a lead is closed lost.",
          confidence: "low",
          basis: {
            metric: "loss_reason_coverage_pct",
            observed_value: 100,
            threshold: 70,
            unit: "percent",
          },
          supporting_record_refs: [`opportunity:${OPPORTUNITY_ID}`],
          causal_claim: false,
        },
      ],
      supporting_records: [
        {
          source_ref: `opportunity:${OPPORTUNITY_ID}`,
          kind: "opportunity",
        },
      ],
      source_revisions: { company: 7, sales_truth: 19 },
      prompt_safety: {
        content_kind: "untrusted_business_data",
        directive: SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE,
      },
    } as const;

    expect(SalesTruthResultSchema.parse(result).close_rate.rate_pct).toBe(60);
    expect(() =>
      SalesTruthResultSchema.parse({
        ...result,
        population: { ...result.population, resolved_count: 9 },
      })
    ).toThrow();
    expect(() =>
      SalesTruthResultSchema.parse({
        ...result,
        recommendations: [{ ...result.recommendations[0], causal_claim: true }],
      })
    ).toThrow();
  });
});

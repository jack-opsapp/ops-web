import { describe, expect, it } from "vitest";

import {
  HIRING_WHAT_IF_ASSUMPTIONS,
  HIRING_WHAT_IF_METRIC_DEFINITION_REVISION,
  HIRING_WHAT_IF_SCHEMA_REVISION,
  AnalyzeHiringBreakEvenInputSchema,
  HiringWhatIfHourlyCostPrecisionError,
  HiringWhatIfResultSchema,
  HiringWhatIfSourceSnapshotSchema,
  calculateHiringWhatIf,
} from "../hiring-what-if";

const source = HiringWhatIfSourceSnapshotSchema.parse({
  observed_at: "2026-09-01T04:00:00.000Z",
  business_date: "2026-08-31",
  timezone: "America/Vancouver",
  currency: "CAD",
  currency_minor_exponent: 2,
  window: {
    starts_on: "2026-06-01",
    ends_on: "2026-08-31",
    complete_weeks: 13,
    next_week_starts_on: "2026-09-07",
    workdays: [1, 2, 3, 4, 5],
    standard_daily_capacity_minutes: 480,
  },
  role: {
    state: "resolved" as const,
    role_ref: {
      kind: "role" as const,
      id: "10000000-0000-4000-8000-000000000001",
    },
    name: "Installer",
    active_member_count: 1,
    multi_role_member_count: 0,
    content_kind: "untrusted_business_data" as const,
  },
  weeks: Array.from({ length: 13 }, (_, index) => ({
    starts_on: new Date(Date.UTC(2026, 5, 1 + index * 7))
      .toISOString()
      .slice(0, 10),
    capacity_minutes: 2_400,
    productive_minutes: 1_800,
    attributed_revenue_minor: 500_000 + index * 10_000,
    attributed_direct_cost_minor: 200_000,
    role_project_count: 1,
  })),
  completeness: {
    source_state: "complete" as const,
    role_project_count: 8,
    financially_observed_project_count: 8,
    source_counts: {
      members: 1,
      tasks: 50,
      site_visits: 5,
      projects: 8,
      payments: 20,
      expenses: 12,
    },
    omitted_counts: {
      supporting_records: 0,
      invalid_schedule_records: 0,
      invalid_currency_expenses: 0,
    },
    reasons: [] as string[],
  },
  source_revisions: [
    { domain: "availability" as const, revision: 3 },
    { domain: "company" as const, revision: 1 },
    { domain: "expenses" as const, revision: 8 },
    { domain: "payments" as const, revision: 13 },
    { domain: "sales_documents" as const, revision: 9 },
    { domain: "site_visits" as const, revision: 5 },
    { domain: "tasks" as const, revision: 21 },
    { domain: "team" as const, revision: 2 },
  ],
  supporting_records: [
    {
      kind: "project" as const,
      id: "20000000-0000-4000-8000-000000000001",
      observed_on: "2026-08-30",
    },
  ],
});

describe("hiring what-if contract", () => {
  it("accepts only a bounded role and positive hourly cost with at most four decimals", () => {
    expect(
      AnalyzeHiringBreakEvenInputSchema.parse({
        role: "  Installer  ",
        hourly_cost: 42.5555,
      })
    ).toEqual({ role: "Installer", hourly_cost: 42.5555 });
    for (const invalid of [
      { role: "", hourly_cost: 42.5 },
      { role: "Installer", hourly_cost: 0 },
      { role: "Installer", hourly_cost: 42.55555 },
      { role: "Installer", hourly_cost: Number.POSITIVE_INFINITY },
      { role: "Installer", hourly_cost: 42.5, company_id: crypto.randomUUID() },
    ]) {
      expect(AnalyzeHiringBreakEvenInputSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("pins source facts to thirteen complete local weeks and ordered revisions", () => {
    expect(HiringWhatIfSourceSnapshotSchema.parse(source)).toEqual(source);
    expect(
      HiringWhatIfSourceSnapshotSchema.safeParse({
        ...source,
        source_revisions: [...source.source_revisions].reverse(),
      }).success
    ).toBe(false);
    expect(
      HiringWhatIfSourceSnapshotSchema.safeParse({
        ...source,
        weeks: source.weeks.slice(0, 12),
      }).success
    ).toBe(false);
    expect(
      HiringWhatIfSourceSnapshotSchema.safeParse({
        ...source,
        currency_minor_exponent: 3,
      }).success
    ).toBe(false);
    expect(
      HiringWhatIfSourceSnapshotSchema.safeParse({
        ...source,
        business_date: "2026-09-01",
      }).success
    ).toBe(false);
    expect(
      HiringWhatIfSourceSnapshotSchema.safeParse({
        ...source,
        window: {
          ...source.window,
          starts_on: "2026-06-02",
          ends_on: "2026-09-01",
          next_week_starts_on: "2026-09-08",
        },
        weeks: source.weeks.map((week) => ({
          ...week,
          starts_on: new Date(
            Date.parse(`${week.starts_on}T00:00:00.000Z`) + 86_400_000
          )
            .toISOString()
            .slice(0, 10),
        })),
      }).success
    ).toBe(false);
    for (const currency of ["CHF", "XCG", "ZWG"] as const) {
      expect(
        HiringWhatIfSourceSnapshotSchema.parse({
          ...source,
          currency,
        }).currency_minor_exponent
      ).toBe(2);
    }
  });

  it("requires the hourly cost to be exact in the source currency", () => {
    expect(() =>
      calculateHiringWhatIf(source, {
        role: "Installer",
        hourly_cost: 42.555,
      })
    ).toThrow(HiringWhatIfHourlyCostPrecisionError);

    const jpySource = HiringWhatIfSourceSnapshotSchema.parse({
      ...source,
      currency: "JPY",
      currency_minor_exponent: 0,
      weeks: source.weeks.map((week) => ({
        ...week,
        attributed_revenue_minor: Math.round(
          week.attributed_revenue_minor / 100
        ),
        attributed_direct_cost_minor: Math.round(
          week.attributed_direct_cost_minor / 100
        ),
      })),
    });
    expect(() =>
      calculateHiringWhatIf(jpySource, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).toThrow(HiringWhatIfHourlyCostPrecisionError);

    const kwdSource = HiringWhatIfSourceSnapshotSchema.parse({
      ...source,
      currency: "KWD",
      currency_minor_exponent: 3,
      weeks: source.weeks.map((week) => ({
        ...week,
        attributed_revenue_minor: week.attributed_revenue_minor * 10,
        attributed_direct_cost_minor: week.attributed_direct_cost_minor * 10,
      })),
    });
    const kwdResult = calculateHiringWhatIf(kwdSource, {
      role: "Installer",
      hourly_cost: 42.125,
    });
    expect(kwdResult.state).toBe("ready");
    if (kwdResult.state !== "ready") throw new Error("expected ready result");
    expect(kwdResult.scenario.hourly_cost).toEqual({
      amount_minor: 42_125,
      currency: "KWD",
      per: "hour",
    });
  });

  it("derives the complete server-owned answer and observed sensitivity", () => {
    const result = calculateHiringWhatIf(source, {
      role: "Installer",
      hourly_cost: 42.5,
    });

    expect(result.schema_revision).toBe(HIRING_WHAT_IF_SCHEMA_REVISION);
    expect(result.metric_definition_revision).toBe(
      HIRING_WHAT_IF_METRIC_DEFINITION_REVISION
    );
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected ready result");
    expect(result.input_semantics).toBe(
      "All-in employer cost per paid hour in the company currency."
    );
    expect(result.assumptions).toEqual(HIRING_WHAT_IF_ASSUMPTIONS);
    expect(result.observed.utilization_rate).toBe(0.75);
    expect(result.observed.collected_revenue.amount_minor).toBe(7_280_000);
    expect(result.observed.allocated_direct_cost.amount_minor).toBe(2_600_000);
    expect(result.observed.cash_contribution.amount_minor).toBe(4_680_000);
    expect(result.scenario.weekly_hire_cost).toEqual({
      amount_minor: 170_000,
      currency: "CAD",
    });
    expect(result.scenario.sensitivity.map((item) => item.band)).toEqual([
      "low",
      "base",
      "high",
    ]);
    expect(
      result.scenario.sensitivity[0]!.contribution_yield_per_paid_hour
    ).toBeLessThanOrEqual(
      result.scenario.sensitivity[1]!.contribution_yield_per_paid_hour
    );
    expect(
      result.scenario.sensitivity[1]!.contribution_yield_per_paid_hour
    ).toBeLessThanOrEqual(
      result.scenario.sensitivity[2]!.contribution_yield_per_paid_hour
    );
    expect(result.scenario.break_even_revenue.amount_minor).toBeGreaterThan(
      result.scenario.weekly_hire_cost.amount_minor
    );
    expect(result.confidence.level).toBe("high");
    expect(HiringWhatIfResultSchema.parse(result)).toEqual(result);
  });

  it("returns a truthful no-break-even answer without inventing a date", () => {
    const result = calculateHiringWhatIf(source, {
      role: "Installer",
      hourly_cost: 2_000,
    });
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected ready result");
    expect(result.scenario.verdict).toBe("does_not_break_even");
    expect(result.scenario.break_even_date).toBeNull();
    expect(
      result.scenario.sensitivity.every((item) => item.break_even_date === null)
    ).toBe(true);
    expect(HiringWhatIfResultSchema.parse(result)).toEqual(result);
  });

  it("refuses numeric claims when the source record is insufficient", () => {
    const result = calculateHiringWhatIf(
      {
        ...source,
        role: { state: "not_found" as const },
        weeks: [],
        completeness: {
          ...source.completeness,
          source_state: "insufficient" as const,
          reasons: ["role_not_found"],
        },
        supporting_records: [],
      },
      { role: "Glazier", hourly_cost: 48 }
    );
    expect(result).toMatchObject({
      state: "insufficient_data",
      role_query: "Glazier",
      reason_codes: ["role_not_found"],
      confidence: { level: "insufficient", score: 0 },
    });
    expect(JSON.stringify(result)).not.toContain("break_even_date");
    expect(HiringWhatIfResultSchema.parse(result)).toEqual(result);
  });

  it("rejects coupled result tampering and duplicate supporting records", () => {
    const result = calculateHiringWhatIf(source, {
      role: "Installer",
      hourly_cost: 42.5,
    });
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected ready result");
    expect(
      HiringWhatIfResultSchema.safeParse({
        ...result,
        scenario: { ...result.scenario, required_utilization_rate: -1 },
      }).success
    ).toBe(false);
    expect(
      HiringWhatIfResultSchema.safeParse({
        ...result,
        supporting_records: [
          ...result.supporting_records,
          result.supporting_records[0],
        ],
      }).success
    ).toBe(false);
  });
});

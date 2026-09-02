import { describe, expect, it } from "vitest";

import {
  CheckPayrollReadinessInputSchema,
  PayrollReadinessResultSchema,
  PayrollReadinessSourceSnapshotSchema,
} from "../payroll-readiness";
import { payrollReadinessSourceFixture } from "../../services/payroll-readiness/__tests__/fixtures";
import { calculatePayrollReadiness } from "../../services/payroll-readiness/payroll-readiness-service";

describe("payroll readiness contract", () => {
  it("accepts exactly one canonical target date", () => {
    expect(
      CheckPayrollReadinessInputSchema.parse({ target_date: "2026-09-15" })
    ).toEqual({ target_date: "2026-09-15" });
    expect(() =>
      CheckPayrollReadinessInputSchema.parse({ target_date: "2026-02-30" })
    ).toThrow();
    expect(() =>
      CheckPayrollReadinessInputSchema.parse({
        target_date: "2026-09-15",
        company_id: "11111111-1111-4111-8111-111111111111",
      })
    ).toThrow();
  });

  it("rejects source snapshots with duplicate opaque records or inconsistent bounds", () => {
    const source = payrollReadinessSourceFixture();
    expect(PayrollReadinessSourceSnapshotSchema.parse(source)).toEqual(source);
    expect(() =>
      PayrollReadinessSourceSnapshotSchema.parse({
        ...source,
        recurring_obligations: [
          source.recurring_obligations[0],
          source.recurring_obligations[0],
        ],
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessSourceSnapshotSchema.parse({
        ...source,
        source_bounds: { ...source.source_bounds, receivables: true },
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessSourceSnapshotSchema.parse({
        ...source,
        settings: {
          ...source.settings!,
          cash_balance: "9".repeat(65),
        },
      })
    ).toThrow();
  });

  it("enforces the result's money, scenario, attribution, and version invariants", () => {
    const result = calculatePayrollReadiness(payrollReadinessSourceFixture(), {
      target_date: "2026-09-15",
    });
    expect(PayrollReadinessResultSchema.parse(result)).toEqual(result);
    expect(result.schema_revision).toBe("2026-09-01.v1");
    expect(result.metric_definition_revision).toBe(
      "payroll-readiness:2026-09-01.v1"
    );
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        scenarios: result.scenarios.map((scenario) =>
          scenario.name === "worst"
            ? { ...scenario, receivable_inflow_minor: 1 }
            : scenario
        ),
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        obligations: {
          ...result.obligations,
          items: result.obligations.items.map((item, index) =>
            index === 0
              ? { ...item, amount_minor: item.amount_minor + 1 }
              : item
          ),
        },
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        receivables: {
          ...result.receivables,
          items: result.receivables.items.map((item, index) =>
            index === 0 ? { ...item, included_best: false } : item
          ),
        },
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        supporting_records: [],
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        supporting_records: result.supporting_records.map((record, index) =>
          index === 0 ? { ...record, kind: "invoice" } : record
        ),
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        scenarios: result.scenarios.map((scenario) =>
          scenario.name === "base"
            ? { ...scenario, ending_balance_minor: 1 }
            : scenario
        ),
      })
    ).toThrow();

    const unrelatedOverflow = {
      ...result,
      decision: "insufficient_evidence" as const,
      completeness: {
        state: "insufficient" as const,
        reasons: ["financial_total_overflow" as const],
      },
      obligations: {
        ...result.obligations,
        payroll_minor: null,
        payroll_refs: [],
      },
      scenarios: result.scenarios.map((scenario) =>
        scenario.name === "best"
          ? {
              ...scenario,
              receivable_inflow_minor: null,
              ending_balance_minor: null,
            }
          : scenario
      ),
    };
    expect(() =>
      PayrollReadinessResultSchema.parse(unrelatedOverflow)
    ).toThrow();

    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        obligations: {
          ...result.obligations,
          payroll_minor: null,
          total_minor: null,
        },
        scenarios: result.scenarios.map((scenario) => ({
          ...scenario,
          ending_balance_minor: null,
        })),
      })
    ).toThrow();

    for (const decision of ["no", "at_risk"] as const) {
      expect(() =>
        PayrollReadinessResultSchema.parse({ ...result, decision })
      ).toThrow();
    }
    const noResult = calculatePayrollReadiness(
      {
        ...payrollReadinessSourceFixture(),
        settings: {
          ...payrollReadinessSourceFixture().settings!,
          cash_balance: "4000.00",
        },
      },
      { target_date: "2026-09-15" }
    );
    for (const decision of ["yes", "at_risk"] as const) {
      expect(() =>
        PayrollReadinessResultSchema.parse({ ...noResult, decision })
      ).toThrow();
    }
    const atRiskResult = calculatePayrollReadiness(
      {
        ...payrollReadinessSourceFixture(),
        settings: {
          ...payrollReadinessSourceFixture().settings!,
          cash_balance: "7000.00",
        },
      },
      { target_date: "2026-09-15" }
    );
    for (const decision of ["yes", "no"] as const) {
      expect(() =>
        PayrollReadinessResultSchema.parse({ ...atRiskResult, decision })
      ).toThrow();
    }

    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        receivables: {
          ...result.receivables,
          items: result.receivables.items.map((item, index) =>
            index === 0 ? { ...item, p25_arrival_date: "2026-09-20" } : item
          ),
        },
      })
    ).toThrow();

    const behavior = result.payer_behaviors[0]!;
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        payer_behaviors: [
          {
            ...behavior,
            history_refs: behavior.history_refs.map(
              () => behavior.history_refs[0]!
            ),
          },
        ],
      })
    ).toThrow();
    expect(() =>
      PayrollReadinessResultSchema.parse({
        ...result,
        payer_behaviors: [behavior, { ...behavior }],
      })
    ).toThrow();
  });

  it("binds freshness, temporal attribution, typed provenance, and exact completeness semantics", () => {
    const result = calculatePayrollReadiness(payrollReadinessSourceFixture(), {
      target_date: "2026-09-15",
    });
    const parse = (candidate: unknown) =>
      PayrollReadinessResultSchema.parse(candidate);
    const expectInvalid = (candidate: unknown) =>
      expect(() => parse(candidate)).toThrow();

    expectInvalid({
      ...result,
      cash: { ...result.cash, fresh: false },
    });
    expectInvalid({
      ...result,
      cash: { ...result.cash, age_minutes: result.cash.age_minutes! + 1 },
    });
    expectInvalid({
      ...result,
      cash: {
        ...result.cash,
        captured_at: "2026-08-30T15:30:00.000Z",
        age_minutes: 2_910,
        fresh: false,
      },
    });
    expectInvalid({
      ...result,
      decision: "insufficient_evidence",
      completeness: {
        ...result.completeness,
        state: "insufficient",
        reasons: ["payer_history_sample_insufficient"],
      },
    });

    expectInvalid({
      ...result,
      payroll_cutoff: { ...result.payroll_cutoff!, date: "2026-09-14" },
    });
    expectInvalid({
      ...result,
      payroll_cutoff: {
        ...result.payroll_cutoff!,
        timezone: "America/Toronto",
      },
    });
    expectInvalid({
      ...result,
      obligations: {
        ...result.obligations,
        items: result.obligations.items.map((item) =>
          item.kind === "payroll"
            ? { ...item, occurrence_date: "2026-09-16" }
            : item
        ),
      },
    });
    expectInvalid({
      ...result,
      obligations: {
        ...result.obligations,
        items: result.obligations.items.map((item) =>
          item.kind === "payroll"
            ? { ...item, due_time_local: "10:00:00" }
            : item
        ),
      },
    });
    expectInvalid({
      ...result,
      obligations: {
        ...result.obligations,
        items: result.obligations.items.map((item) =>
          item.kind === "reimbursement"
            ? { ...item, occurrence_date: "2026-09-02" }
            : item
        ),
      },
    });

    const invoiceRef = result.receivables.items[0]!.source_ref;
    const batchRef = result.obligations.reimbursement_refs[0]!;
    const recurringRef = result.obligations.payroll_refs[0]!;
    expectInvalid({
      ...result,
      cash: { ...result.cash, source_ref: invoiceRef },
    });
    expectInvalid({
      ...result,
      obligations: {
        ...result.obligations,
        payroll_refs: [invoiceRef],
        items: result.obligations.items.map((item) =>
          item.kind === "payroll" ? { ...item, source_ref: invoiceRef } : item
        ),
      },
    });
    expectInvalid({
      ...result,
      obligations: {
        ...result.obligations,
        reimbursement_refs: [invoiceRef],
        items: result.obligations.items.map((item) =>
          item.kind === "reimbursement"
            ? { ...item, source_ref: invoiceRef }
            : item
        ),
      },
    });
    expectInvalid({
      ...result,
      receivables: {
        ...result.receivables,
        modeled_refs: [batchRef],
        items: result.receivables.items.map((item) => ({
          ...item,
          source_ref: batchRef,
        })),
      },
      scenarios: result.scenarios.map((item) => ({
        ...item,
        receivable_refs:
          item.name === "worst" || item.receivable_refs.length === 0
            ? []
            : [batchRef],
      })),
    });
    expectInvalid({
      ...result,
      payer_behaviors: result.payer_behaviors.map((behavior) => ({
        ...behavior,
        history_refs: behavior.history_refs.map((reference, index) =>
          index === 0 ? recurringRef : reference
        ),
      })),
    });

    const behavior = result.payer_behaviors[0]!;
    expectInvalid({
      ...result,
      payer_behaviors: [
        behavior,
        {
          ...behavior,
          payer_ref: "client:99999999-9999-4999-8999-999999999999",
        },
      ],
    });
    expectInvalid({
      ...result,
      payer_behaviors: [
        { ...behavior, payer_ref: "client:not-a-canonical-uuid" },
      ],
    });
    expectInvalid({
      ...result,
      completeness: {
        ...result.completeness,
        source_counts: {
          ...result.completeness.source_counts,
          payer_history: behavior.sample_count - 1,
        },
      },
    });

    const payrollItem = result.obligations.items.find(
      (item) => item.kind === "payroll"
    )!;
    expectInvalid({
      ...result,
      decision: "no",
      obligations: {
        ...result.obligations,
        payroll_minor:
          result.obligations.payroll_minor! + payrollItem.amount_minor,
        total_minor: result.obligations.total_minor! + payrollItem.amount_minor,
        items: [...result.obligations.items, payrollItem],
      },
      scenarios: result.scenarios.map((item) => ({
        ...item,
        ending_balance_minor:
          item.ending_balance_minor! - payrollItem.amount_minor,
      })),
    });
    expectInvalid({
      ...result,
      decision: "no",
      obligations: {
        ...result.obligations,
        other_recurring_minor:
          result.obligations.other_recurring_minor! + payrollItem.amount_minor,
        total_minor: result.obligations.total_minor! + payrollItem.amount_minor,
        other_recurring_refs: [
          ...result.obligations.other_recurring_refs,
          payrollItem.source_ref,
        ],
        items: [
          ...result.obligations.items,
          {
            ...payrollItem,
            kind: "other_recurring",
            occurrence_date: "2026-09-14",
          },
        ],
      },
      scenarios: result.scenarios.map((item) => ({
        ...item,
        ending_balance_minor:
          item.ending_balance_minor! - payrollItem.amount_minor,
      })),
    });
  });
});

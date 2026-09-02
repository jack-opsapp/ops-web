import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { SUPPORTED_ISO_4217_CURRENCY_CODES } from "@/lib/agent-control-plane/contracts/common";
import {
  PAYROLL_READINESS_COMPLETENESS_REASONS,
  PAYROLL_READINESS_MAX_OUTPUT_CHARACTERS,
  PAYROLL_READINESS_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  PayrollReadinessTargetDateError,
  type PayrollReadinessSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/payroll-readiness";

import {
  ISO_4217_MINOR_EXPONENTS_2026_01_01,
  calculatePayrollReadiness,
  createPayrollReadinessService,
  PayrollReadinessReadError,
} from "../payroll-readiness-service";
import {
  createPayrollReadinessRepository,
  type PayrollReadinessRpcClient,
} from "../payroll-readiness-repository";
import {
  CLIENT_ID,
  OPEN_INVOICE_ID,
  PAYROLL_PERMISSIONS,
  payrollReadinessActorFixture,
  payrollReadinessAuthority,
  payrollReadinessSourceFixture,
} from "./fixtures";

function scenario(
  result: ReturnType<typeof calculatePayrollReadiness>,
  name: "best" | "base" | "worst"
) {
  return result.scenarios.find((candidate) => candidate.name === name)!;
}

describe("payroll readiness calculation", () => {
  it("uses exact obligations and actual payer delays while keeping worst case receivable-free", () => {
    const result = calculatePayrollReadiness(payrollReadinessSourceFixture(), {
      target_date: "2026-09-15",
    });

    expect(result.decision).toBe("yes");
    expect(result.payroll_cutoff).toEqual({
      date: "2026-09-15",
      time_local: "09:00:00",
      timezone: "America/Vancouver",
    });
    expect(result.cash.current_minor).toBe(1_000_000);
    expect(result.obligations).toMatchObject({
      payroll_minor: 600_000,
      other_recurring_minor: 200_000,
      reimbursements_minor: 50_000,
      total_minor: 850_000,
    });
    expect(result.obligations.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "payroll",
          occurrence_date: "2026-09-15",
          amount_minor: 600_000,
        }),
        expect.objectContaining({
          kind: "reimbursement",
          occurrence_date: "2026-09-01",
          amount_minor: 50_000,
        }),
      ])
    );
    expect(result.payer_behaviors).toEqual([
      expect.objectContaining({
        payer_ref: `client:${CLIENT_ID}`,
        sample_count: 5,
        p25_delay_days: 0,
        p50_delay_days: 2,
        p75_delay_days: 4,
      }),
    ]);
    expect(scenario(result, "best")).toMatchObject({
      receivable_inflow_minor: 300_000,
      ending_balance_minor: 450_000,
    });
    expect(scenario(result, "base")).toMatchObject({
      receivable_inflow_minor: 300_000,
      ending_balance_minor: 450_000,
    });
    expect(scenario(result, "worst")).toMatchObject({
      receivable_inflow_minor: 0,
      ending_balance_minor: 150_000,
    });
    expect(result.receivables.items).toEqual([
      expect.objectContaining({
        source_ref: `invoice:${OPEN_INVOICE_ID}`,
        balance_minor: 300_000,
        p25_arrival_date: "2026-09-05",
        p50_arrival_date: "2026-09-07",
        included_best: true,
        included_base: true,
        modeled: true,
      }),
    ]);
    expect(result.prompt_safety.content_kind).toBe("untrusted_business_data");
  });

  it("returns at risk when only modeled receivables bridge payroll and no source is missing", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: { ...source.settings!, cash_balance: "7000.00" },
      },
      { target_date: "2026-09-15" }
    );
    expect(result.decision).toBe("at_risk");
    expect(scenario(result, "worst").ending_balance_minor).toBe(-150_000);
    expect(scenario(result, "best").ending_balance_minor).toBe(150_000);
    expect(result.completeness.state).toBe("complete");
  });

  it("returns no only when the complete best case still misses payroll", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: { ...source.settings!, cash_balance: "4000.00" },
      },
      { target_date: "2026-09-15" }
    );
    expect(result.decision).toBe("no");
    expect(scenario(result, "best").ending_balance_minor).toBe(-150_000);
  });

  it("treats a negative recorded cash balance as a truthful deficit, not an internal error", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: { ...source.settings!, cash_balance: "-1000.00" },
      },
      { target_date: "2026-09-15" }
    );
    expect(result.decision).toBe("no");
    expect(result.cash.current_minor).toBe(-100_000);
    expect(scenario(result, "best").ending_balance_minor).toBe(-650_000);
    expect(result.completeness.reasons).not.toContain("cash_amount_invalid");
  });

  it("preserves subsecond payroll cutoff ordering", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        recurring_obligations: source.recurring_obligations.map((item) =>
          item.obligation_kind === "payroll"
            ? { ...item, due_time_local: "09:00:00.000001" }
            : {
                ...item,
                next_due_date: "2026-09-15",
                due_time_local: "09:00:00.000002",
              }
        ),
      },
      { target_date: "2026-09-15" }
    );
    expect(result.payroll_cutoff?.time_local).toBe("09:00:00.000001");
    expect(result.obligations.other_recurring_minor).toBe(0);
    expect(result.obligations.items).not.toContainEqual(
      expect.objectContaining({ kind: "other_recurring" })
    );
  });

  it("fails closed after a same-day payroll cutoff without blocking a still-future cutoff", () => {
    const source = payrollReadinessSourceFixture();
    const sameDaySource = {
      ...source,
      business_date: "2026-09-01",
      target_date: "2026-09-01",
      recurring_obligations: source.recurring_obligations
        .filter((item) => item.obligation_kind === "payroll")
        .map((item) => ({ ...item, next_due_date: "2026-09-01" })),
      source_counts: { ...source.source_counts, recurring_obligations: 1 },
    };
    const before = calculatePayrollReadiness(
      {
        ...sameDaySource,
        observed_at: "2026-09-01T15:59:59.999999Z",
      },
      { target_date: "2026-09-01" }
    );
    const after = calculatePayrollReadiness(
      {
        ...sameDaySource,
        observed_at: "2026-09-01T16:00:00.000001Z",
      },
      { target_date: "2026-09-01" }
    );

    expect(before.completeness.reasons).not.toContain("payroll_cutoff_elapsed");
    expect(before.decision).toBe("yes");
    expect(after.completeness.reasons).toContain("payroll_cutoff_elapsed");
    expect(after.decision).toBe("insufficient_evidence");
  });

  it("does not publish an elapsed cutoff when invalid payroll arithmetic removes the cutoff", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        observed_at: "2026-09-01T16:00:00.000001Z",
        target_date: "2026-09-01",
        recurring_obligations: source.recurring_obligations
          .filter((item) => item.obligation_kind === "payroll")
          .map((item) => ({
            ...item,
            amount: "__invalid__",
            next_due_date: "2026-09-01",
          })),
        source_counts: { ...source.source_counts, recurring_obligations: 1 },
      },
      { target_date: "2026-09-01" }
    );
    expect(result.payroll_cutoff).toBeNull();
    expect(result.completeness.reasons).toContain("obligation_amount_invalid");
    expect(result.completeness.reasons).not.toContain("payroll_cutoff_elapsed");
    expect(result.decision).toBe("insufficient_evidence");
  });

  it("fails closed without a cutoff when target payroll arithmetic is invalid", () => {
    for (const mutate of [
      (
        item: PayrollReadinessSourceSnapshot["recurring_obligations"][number]
      ) => ({
        ...item,
        amount: "-1",
      }),
      (
        item: PayrollReadinessSourceSnapshot["recurring_obligations"][number]
      ) => ({
        ...item,
        currency: "USD",
      }),
    ]) {
      const source = payrollReadinessSourceFixture();
      const result = calculatePayrollReadiness(
        {
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "payroll" ? mutate(item) : item
          ),
        },
        { target_date: "2026-09-15" }
      );
      expect(result.decision).toBe("insufficient_evidence");
      expect(result.obligations.payroll_minor).toBeNull();
      expect(result.obligations.total_minor).toBeNull();
      expect(result.payroll_cutoff).toBeNull();
    }
  });

  it("returns exact insufficient evidence when target payroll is not configured", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        recurring_obligations: source.recurring_obligations.filter(
          (obligation) => obligation.obligation_kind !== "payroll"
        ),
        source_counts: {
          ...source.source_counts,
          recurring_obligations: 1,
        },
      },
      { target_date: "2026-09-15" }
    );
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.completeness.reasons).toContain("payroll_not_configured");
    expect(result.obligations.payroll_minor).toBeNull();
    expect(result.obligations.total_minor).toBeNull();
  });

  it("returns exact source gaps instead of guessing when missing payer history could change no", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: { ...source.settings!, cash_balance: "4000.00" },
        payer_history: [],
        source_counts: { ...source.source_counts, payer_history: 0 },
      },
      { target_date: "2026-09-15" }
    );
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.completeness.reasons).toContain(
      "payer_history_sample_insufficient"
    );
    expect(result.receivables.unmodeled_refs).toEqual([
      `invoice:${OPEN_INVOICE_ID}`,
    ]);
  });

  it("fails closed for stale cash, stale obligation coverage, missing timing, currency, integrity, and source bounds", () => {
    const mutations = [
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        settings: {
          ...source.settings!,
          cash_balance_updated_at: "2026-08-30T15:30:00.000Z",
        },
      }),
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        settings: {
          ...source.settings!,
          obligations_confirmed_through: "2026-09-14",
        },
      }),
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        recurring_obligations: source.recurring_obligations.map((item) =>
          item.obligation_kind === "payroll"
            ? { ...item, due_time_local: null }
            : item
        ),
      }),
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        reimbursement_batches: source.reimbursement_batches.map((batch) => ({
          ...batch,
          currency_codes: ["USD"],
        })),
      }),
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        receivables: source.receivables.map((invoice) => ({
          ...invoice,
          identity_conflict: true,
        })),
      }),
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        source_counts: { ...source.source_counts, receivables: 101 },
        source_bounds: { ...source.source_bounds, receivables: true },
      }),
    ];

    const expectedReasons = [
      "cash_stale",
      "obligation_coverage_incomplete",
      "payroll_timing_missing",
      "reimbursement_currency_invalid",
      "receivable_identity_conflict",
      "source_bound_reached",
    ];
    mutations.forEach((mutate, index) => {
      const result = calculatePayrollReadiness(
        mutate(payrollReadinessSourceFixture()),
        {
          target_date: "2026-09-15",
        }
      );
      expect(result.decision).toBe("insufficient_evidence");
      expect(result.completeness.reasons).toContain(expectedReasons[index]);
    });
  });

  it("proves every published completeness reason with exact decision and arithmetic behavior", () => {
    type Reason = (typeof PAYROLL_READINESS_COMPLETENESS_REASONS)[number];
    type Case = {
      reason: Reason;
      reasons?: readonly Reason[];
      mutate: (
        source: PayrollReadinessSourceSnapshot
      ) => PayrollReadinessSourceSnapshot;
      decision: "yes" | "insufficient_evidence";
      state: "partial" | "insufficient";
      allEndingsNull: boolean;
      input?: { target_date: string };
    };
    const cases: Case[] = [
      {
        reason: "cash_missing",
        mutate: (source) => ({
          ...source,
          settings: { ...source.settings!, cash_balance: null },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "cash_stale",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            cash_balance_updated_at: "2026-08-30T15:30:00.000Z",
          },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "cash_timestamp_invalid",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            cash_balance_updated_at: "2026-09-01T16:01:00.000Z",
          },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "cash_amount_invalid",
        mutate: (source) => ({
          ...source,
          settings: { ...source.settings!, cash_balance: "1.001" },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "obligation_coverage_missing",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            obligations_confirmed_through: null,
            obligations_confirmed_at: null,
          },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "obligation_coverage_incomplete",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            obligations_confirmed_through: "2026-09-14",
          },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "obligation_confirmation_stale",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            obligations_confirmed_at: "2026-08-31T15:59:00.000Z",
          },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "obligation_confirmation_invalid",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            obligations_confirmed_at: "2026-09-01T16:01:00.000Z",
          },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "obligation_changed_after_confirmation",
        mutate: (source) => ({
          ...source,
          settings: {
            ...source.settings!,
            obligations_confirmed_at: "2026-09-01T15:30:00.000001Z",
          },
          recurring_obligations: source.recurring_obligations.map((item) => ({
            ...item,
            updated_at: "2026-09-01T15:30:00.000002Z",
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "payroll_not_configured",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.filter(
            (item) => item.obligation_kind !== "payroll"
          ),
          source_counts: { ...source.source_counts, recurring_obligations: 1 },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "payroll_timing_missing",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "payroll"
              ? { ...item, due_time_local: null }
              : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "payroll_cutoff_elapsed",
        mutate: (source) => ({
          ...source,
          observed_at: "2026-09-01T16:00:00.000001Z",
          target_date: "2026-09-01",
          recurring_obligations: source.recurring_obligations
            .filter((item) => item.obligation_kind === "payroll")
            .map((item) => ({ ...item, next_due_date: "2026-09-01" })),
          source_counts: {
            ...source.source_counts,
            recurring_obligations: 1,
          },
        }),
        input: { target_date: "2026-09-01" },
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "obligation_kind_missing",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "other"
              ? { ...item, obligation_kind: null }
              : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "obligation_timing_missing",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "other"
              ? {
                  ...item,
                  next_due_date: "2026-09-15",
                  due_time_local: null,
                }
              : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "obligation_currency_invalid",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "other"
              ? { ...item, currency: "USD" }
              : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "obligation_amount_invalid",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "other" ? { ...item, amount: "-1" } : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "obligation_schedule_invalid",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) =>
            item.obligation_kind === "other"
              ? { ...item, cadence: "nonsense" }
              : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "reimbursement_currency_invalid",
        mutate: (source) => ({
          ...source,
          reimbursement_batches: source.reimbursement_batches.map((item) => ({
            ...item,
            currency_codes: ["USD"],
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "reimbursement_amount_invalid",
        mutate: (source) => ({
          ...source,
          reimbursement_batches: source.reimbursement_batches.map((item) => ({
            ...item,
            owed_amount: "-1",
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "receivable_amount_invalid",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            total_amount: "__invalid__",
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "receivable_date_invalid",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            due_date: "__invalid__",
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "receivable_balance_inconsistent",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            calculated_balance: "2999.00",
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "receivable_delivery_missing",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            sent_at: null,
          })),
        }),
        decision: "yes",
        state: "partial",
        allEndingsNull: false,
      },
      {
        reason: "receivable_identity_conflict",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            identity_conflict: true,
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "payer_history_identity_conflict",
        reasons: [
          "payer_history_identity_conflict",
          "payer_history_sample_insufficient",
        ],
        mutate: (source) => ({
          ...source,
          payer_history: source.payer_history.map((item, index) =>
            index === 0 ? { ...item, identity_conflict: true } : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "payer_history_date_invalid",
        reasons: [
          "payer_history_date_invalid",
          "payer_history_sample_insufficient",
        ],
        mutate: (source) => ({
          ...source,
          payer_history: source.payer_history.map((item, index) =>
            index === 0 ? { ...item, due_date: "__invalid__" } : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "payer_history_amount_invalid",
        reasons: [
          "payer_history_amount_invalid",
          "payer_history_sample_insufficient",
        ],
        mutate: (source) => ({
          ...source,
          payer_history: source.payer_history.map((item, index) =>
            index === 0 ? { ...item, amount_valid: false } : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "payer_history_delay_inconsistent",
        reasons: [
          "payer_history_delay_inconsistent",
          "payer_history_sample_insufficient",
        ],
        mutate: (source) => ({
          ...source,
          payer_history: source.payer_history.map((item, index) =>
            index === 0 ? { ...item, delay_days: 999 } : item
          ),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "payer_history_sample_insufficient",
        mutate: (source) => ({
          ...source,
          payer_history: source.payer_history.slice(0, 2),
          source_counts: { ...source.source_counts, payer_history: 2 },
        }),
        decision: "yes",
        state: "partial",
        allEndingsNull: false,
      },
      {
        reason: "receivable_projection_invalid",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            due_date: "9999-12-31",
          })),
          payer_history: source.payer_history.map((item) => ({
            ...item,
            due_date: "2026-01-01",
            settled_on: "2026-01-02",
            delay_days: 1,
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
      {
        reason: "receivable_projection_overdue",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            due_date: "2026-08-20",
          })),
        }),
        decision: "yes",
        state: "partial",
        allEndingsNull: false,
      },
      {
        reason: "receivable_same_day_timing_unknown",
        mutate: (source) => ({
          ...source,
          receivables: source.receivables.map((item) => ({
            ...item,
            due_date: "2026-09-15",
          })),
        }),
        decision: "yes",
        state: "partial",
        allEndingsNull: false,
      },
      {
        reason: "financial_total_overflow",
        mutate: (source) => ({
          ...source,
          recurring_obligations: source.recurring_obligations.map((item) => ({
            ...item,
            amount: "90071992547409.91",
          })),
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: true,
      },
      {
        reason: "source_bound_reached",
        mutate: (source) => ({
          ...source,
          source_counts: { ...source.source_counts, receivables: 101 },
          source_bounds: { ...source.source_bounds, receivables: true },
        }),
        decision: "insufficient_evidence",
        state: "insufficient",
        allEndingsNull: false,
      },
    ];

    expect(cases.map((testCase) => testCase.reason)).toEqual(
      PAYROLL_READINESS_COMPLETENESS_REASONS
    );
    for (const testCase of cases) {
      let result: ReturnType<typeof calculatePayrollReadiness>;
      try {
        result = calculatePayrollReadiness(
          testCase.mutate(payrollReadinessSourceFixture()),
          testCase.input ?? { target_date: "2026-09-15" }
        );
      } catch (error) {
        throw new Error(`completeness case failed: ${testCase.reason}`, {
          cause: error,
        });
      }
      expect(result.completeness.reasons, testCase.reason).toEqual(
        testCase.reasons ?? [testCase.reason]
      );
      expect(result.decision, testCase.reason).toBe(testCase.decision);
      expect(result.completeness.state, testCase.reason).toBe(testCase.state);
      expect(
        result.scenarios.every((item) => item.ending_balance_minor === null),
        testCase.reason
      ).toBe(testCase.allEndingsNull);
    }
  });

  it("does not count a receivable predicted on payroll day because its time is unknown", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: { ...source.settings!, cash_balance: "7000.00" },
        receivables: source.receivables.map((invoice) => ({
          ...invoice,
          due_date: "2026-09-15",
        })),
      },
      { target_date: "2026-09-15" }
    );
    expect(scenario(result, "best").receivable_inflow_minor).toBe(0);
    expect(result.completeness.reasons).toContain(
      "receivable_same_day_timing_unknown"
    );
  });

  it("rejects receivable delivery timestamps after the observation instant", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        receivables: source.receivables.map((invoice) => ({
          ...invoice,
          sent_at: "2026-09-01T16:00:00.000001Z",
        })),
      },
      { target_date: "2026-09-15" }
    );
    expect(result.completeness.reasons).toContain("receivable_date_invalid");
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.receivables.unmodeled_refs).toEqual([
      `invoice:${OPEN_INVOICE_ID}`,
    ]);
  });

  it("does not recycle a missed receivable prediction into future cash", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: { ...source.settings!, cash_balance: "7000.00" },
        receivables: source.receivables.map((invoice) => ({
          ...invoice,
          due_date: "2026-08-20",
        })),
      },
      { target_date: "2026-09-15" }
    );

    expect(result.decision).toBe("insufficient_evidence");
    expect(scenario(result, "best").receivable_inflow_minor).toBe(0);
    expect(result.completeness.reasons).toContain(
      "receivable_projection_overdue"
    );
    expect(result.receivables.unmodeled_refs).toEqual([
      `invoice:${OPEN_INVOICE_ID}`,
    ]);
  });

  it("accepts legitimate imported settlement delays beyond ten years", () => {
    const source = payrollReadinessSourceFixture();
    const dueDate = "2010-01-01";
    const settledOn = source.payer_history[0]!.settled_on;
    const delayDays = Math.round(
      (Date.parse(`${settledOn}T00:00:00.000Z`) -
        Date.parse(`${dueDate}T00:00:00.000Z`)) /
        86_400_000
    );
    const result = calculatePayrollReadiness(
      {
        ...source,
        payer_history: source.payer_history.map((history, index) =>
          index === 0
            ? { ...history, due_date: dueDate, delay_days: delayDays }
            : history
        ),
      },
      { target_date: "2026-09-15" }
    );
    expect(result.payer_behaviors[0]!.sample_count).toBe(5);
    expect(result.completeness.reasons).not.toContain(
      "payer_history_delay_inconsistent"
    );
  });

  it("fails closed when a valid historical delay projects outside canonical calendar years", () => {
    const source = payrollReadinessSourceFixture();
    const maximumCanonicalDelay = Math.round(
      (Date.parse("9999-12-31T00:00:00.000Z") -
        Date.parse("0001-01-01T00:00:00.000Z")) /
        86_400_000
    );
    const scenarios = [
      {
        due_date: "2026-01-01",
        settled_on: "2026-01-02",
        delay_days: 1,
      },
      {
        due_date: "0001-01-01",
        settled_on: "9999-12-31",
        delay_days: maximumCanonicalDelay,
      },
    ];

    for (const history of scenarios) {
      const result = calculatePayrollReadiness(
        {
          ...source,
          receivables: source.receivables.map((invoice) => ({
            ...invoice,
            due_date: "9999-12-31",
          })),
          payer_history: source.payer_history.map((item) => ({
            ...item,
            ...history,
          })),
        },
        { target_date: "2026-09-15" }
      );
      expect(result.decision).toBe("insufficient_evidence");
      expect(result.completeness.reasons).toContain(
        "receivable_projection_invalid"
      );
      expect(result.receivables.unmodeled_refs).toEqual([
        `invoice:${OPEN_INVOICE_ID}`,
      ]);
    }
  });

  it("counts an overdue recurring obligation instead of silently dropping money already owed", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        recurring_obligations: source.recurring_obligations.map((obligation) =>
          obligation.obligation_kind === "other"
            ? { ...obligation, next_due_date: "2026-08-30" }
            : obligation
        ),
      },
      { target_date: "2026-09-15" }
    );

    expect(result.obligations.other_recurring_minor).toBe(200_000);
    expect(scenario(result, "worst").ending_balance_minor).toBe(150_000);
  });

  it("preserves literal years below 0100 and fails closed on an unbounded annual backlog", () => {
    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        recurring_obligations: source.recurring_obligations.map((obligation) =>
          obligation.obligation_kind === "other"
            ? {
                ...obligation,
                cadence: "annually",
                next_due_date: "0099-01-01",
              }
            : obligation
        ),
      },
      { target_date: "2026-09-15" }
    );
    expect(result.completeness.reasons).toContain(
      "obligation_schedule_invalid"
    );
    expect(result.obligations.other_recurring_minor).toBeNull();
    expect(result.decision).toBe("insufficient_evidence");
  });

  it("keeps malformed active schedules visible and returns their exact evidence gap", () => {
    const mutations = [
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        recurring_obligations: source.recurring_obligations.map((item) =>
          item.obligation_kind === "other"
            ? { ...item, cadence: "every-other-fortnight" }
            : item
        ),
      }),
      (source: ReturnType<typeof payrollReadinessSourceFixture>) => ({
        ...source,
        recurring_obligations: source.recurring_obligations.map((item) =>
          item.obligation_kind === "other"
            ? { ...item, end_date: "2026-09-01" }
            : item
        ),
      }),
    ];
    for (const mutate of mutations) {
      const result = calculatePayrollReadiness(
        mutate(payrollReadinessSourceFixture()),
        { target_date: "2026-09-15" }
      );
      expect(result.decision).toBe("insufficient_evidence");
      expect(result.completeness.reasons).toContain(
        "obligation_schedule_invalid"
      );
      expect(result.obligations.total_minor).toBeNull();
    }
  });

  it("uses an exhaustive versioned currency exponent table and fails closed on aggregate overflow", () => {
    expect(Object.keys(ISO_4217_MINOR_EXPONENTS_2026_01_01).sort()).toEqual(
      [...SUPPORTED_ISO_4217_CURRENCY_CODES].sort()
    );
    expect(ISO_4217_MINOR_EXPONENTS_2026_01_01.CAD).toBe(2);
    expect(ISO_4217_MINOR_EXPONENTS_2026_01_01.JPY).toBe(0);
    expect(ISO_4217_MINOR_EXPONENTS_2026_01_01.KWD).toBe(3);
    expect(ISO_4217_MINOR_EXPONENTS_2026_01_01.CLF).toBe(4);
    expect(ISO_4217_MINOR_EXPONENTS_2026_01_01.XDR).toBeNull();

    const source = payrollReadinessSourceFixture();
    const result = calculatePayrollReadiness(
      {
        ...source,
        settings: {
          ...source.settings!,
          cash_balance: "90071992547409.91",
        },
        recurring_obligations: source.recurring_obligations.map((item) => ({
          ...item,
          amount: "90071992547409.91",
        })),
        reimbursement_batches: [],
        source_counts: {
          ...source.source_counts,
          reimbursement_batches: 0,
        },
      },
      { target_date: "2026-09-15" }
    );
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.completeness.reasons).toContain("financial_total_overflow");
    expect(result.obligations.total_minor).toBeNull();

    const oversizedReceivables = source.receivables.flatMap((invoice) => [
      {
        ...invoice,
        total_amount: "90071992547409.91",
        stored_balance_due: "90071992547409.91",
        calculated_balance: "90071992547409.91",
      },
      {
        ...invoice,
        invoice_id: "99999999-9999-4999-8999-999999999999",
        total_amount: "90071992547409.91",
        stored_balance_due: "90071992547409.91",
        calculated_balance: "90071992547409.91",
      },
    ]);
    const receivableOverflow = calculatePayrollReadiness(
      {
        ...source,
        settings: {
          ...source.settings!,
          cash_balance: "90071992547409.91",
        },
        receivables: oversizedReceivables,
        source_counts: { ...source.source_counts, receivables: 2 },
      },
      { target_date: "2026-09-15" }
    );
    expect(receivableOverflow.decision).toBe("insufficient_evidence");
    expect(receivableOverflow.completeness.reasons).toContain(
      "financial_total_overflow"
    );
    expect(receivableOverflow.receivables.open_total_minor).toBeNull();
    expect(
      scenario(receivableOverflow, "best").receivable_inflow_minor
    ).toBeNull();
  });

  it("keeps the deterministic maximum source shape inside the advertised output ceiling", () => {
    const source = payrollReadinessSourceFixture();
    const uuid = (offset: number) =>
      `00000000-0000-4000-8000-${offset.toString(16).padStart(12, "0")}`;
    const recurring = Array.from({ length: 40 }, (_, index) => ({
      ...source.recurring_obligations[0]!,
      id: uuid(1_000 + index),
      amount: "1.00",
      cadence: "weekly",
      next_due_date: "2026-02-10",
      obligation_kind: index === 0 ? ("payroll" as const) : ("other" as const),
    }));
    const batches = Array.from({ length: 50 }, (_, index) => ({
      ...source.reimbursement_batches[0]!,
      id: uuid(2_000 + index),
      owed_amount: "1.00",
    }));
    const receivables = Array.from({ length: 100 }, (_, index) => ({
      ...source.receivables[0]!,
      invoice_id: uuid(3_000 + index),
      payer_id: uuid(4_000 + index),
      total_amount: "1.00",
      stored_balance_due: "1.00",
      calculated_balance: "1.00",
    }));
    const history = receivables.flatMap((invoice, payerIndex) =>
      Array.from({ length: 5 }, (_, historyIndex) => ({
        ...source.payer_history[historyIndex]!,
        invoice_id: uuid(5_000 + payerIndex * 5 + historyIndex),
        payer_id: invoice.payer_id,
      }))
    );
    const maximumSource = {
      ...source,
      settings: { ...source.settings!, cash_balance: "100000.00" },
      recurring_obligations: recurring,
      reimbursement_batches: batches,
      receivables,
      payer_history: history,
      source_counts: {
        recurring_obligations: 40,
        reimbursement_batches: 50,
        receivables: 100,
        payer_history: 500,
      },
    };
    expect(JSON.stringify(maximumSource).length).toBeLessThanOrEqual(
      PAYROLL_READINESS_MAX_SOURCE_SNAPSHOT_CHARACTERS
    );
    expect(JSON.stringify(maximumSource).length).toBe(154_555);
    const result = calculatePayrollReadiness(maximumSource, {
      target_date: "2026-09-15",
    });
    expect(result.supporting_records).toHaveLength(691);
    expect(result.obligations.items).toHaveLength(1_330);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      PAYROLL_READINESS_MAX_OUTPUT_CHARACTERS
    );
  });

  it("rejects past targets and dates beyond the server-owned horizon", () => {
    const source = payrollReadinessSourceFixture();
    expect(() =>
      calculatePayrollReadiness(
        { ...source, target_date: "2026-08-31" },
        { target_date: "2026-08-31" }
      )
    ).toThrow(PayrollReadinessTargetDateError);
    expect(() =>
      calculatePayrollReadiness(
        { ...source, target_date: "2026-12-04" },
        { target_date: "2026-12-04" }
      )
    ).toThrow(PayrollReadinessTargetDateError);
  });
});

describe("payroll readiness service", () => {
  it("reauthorizes immediately before one bounded read", async () => {
    const { actor, authorityClient } = await payrollReadinessActorFixture();
    const source = payrollReadinessSourceFixture();
    const rpc = vi.fn<PayrollReadinessRpcClient["rpc"]>(() =>
      Promise.resolve({ data: source, error: null })
    );
    const signal = new AbortController().signal;
    const service = createPayrollReadinessService({
      repository: createPayrollReadinessRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    const lookupsBefore = authorityClient.actorLookups.length;

    const result = await service.checkPayrollReadiness(
      actor,
      { target_date: source.target_date },
      { signal }
    );

    expect(result.decision).toBe("yes");
    expect(authorityClient.actorLookups).toHaveLength(lookupsBefore + 1);
    expect(authorityClient.actorSignals.at(-1)).toBe(signal);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("executes the inherited tool under a real v15 actor and v9 binding", async () => {
    const { actor, authorityClient } = await payrollReadinessActorFixture(
      PAYROLL_PERMISSIONS,
      "2026-09-01.capability-manifest.v15"
    );
    const source = payrollReadinessSourceFixture();
    const rpc = vi.fn<PayrollReadinessRpcClient["rpc"]>(() =>
      Promise.resolve({ data: source, error: null })
    );
    const service = createPayrollReadinessService({
      repository: createPayrollReadinessRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });

    await expect(
      service.checkPayrollReadiness(actor, {
        target_date: source.target_date,
      })
    ).resolves.toMatchObject({ decision: "yes" });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
      p_exposure_revision: "2026-09-01.mcp-exposure.v9",
    });
  });

  it("fails before source access when current finance authority is gone", async () => {
    const { actor, authorityClient } = await payrollReadinessActorFixture();
    authorityClient.mcpResult = payrollReadinessAuthority(
      PAYROLL_PERMISSIONS.filter((permission) => permission !== "invoices.view")
    );
    const rpc = vi.fn<PayrollReadinessRpcClient["rpc"]>(() =>
      Promise.resolve({ data: payrollReadinessSourceFixture(), error: null })
    );
    const service = createPayrollReadinessService({
      repository: createPayrollReadinessRepository({ rpc }),
      authorityRepository: authorityClient.repository,
    });

    await expect(
      service.checkPayrollReadiness(actor, { target_date: "2026-09-15" })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps invalid input, source failures, semantic target errors, and overflow to safe errors", async () => {
    const { actor, authorityClient } = await payrollReadinessActorFixture();
    const source = payrollReadinessSourceFixture();
    const validRepository = createPayrollReadinessRepository({
      rpc: () => Promise.resolve({ data: source, error: null }),
    });
    const service = createPayrollReadinessService({
      repository: validRepository,
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    await expect(
      service.checkPayrollReadiness(actor, {
        target_date: "2026-09-15",
        cash_balance: 10_000,
      } as never)
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });

    const unavailable = createPayrollReadinessService({
      repository: createPayrollReadinessRepository({
        rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
      }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    await expect(
      unavailable.checkPayrollReadiness(actor, {
        target_date: source.target_date,
      })
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });

    const rpcTargetError = createPayrollReadinessService({
      repository: createPayrollReadinessRepository({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "22023",
              message: "AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID",
            },
          }),
      }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    await expect(
      rpcTargetError.checkPayrollReadiness(actor, {
        target_date: source.target_date,
      })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });

    const outOfRange = createPayrollReadinessService({
      repository: createPayrollReadinessRepository({
        rpc: () =>
          Promise.resolve({
            data: { ...source, target_date: "2026-12-04" },
            error: null,
          }),
      }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    await expect(
      outOfRange.checkPayrollReadiness(actor, { target_date: "2026-12-04" })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    const overflow = createPayrollReadinessService({
      repository: validRepository,
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
      maxOutputCharacters: 10,
    });
    await expect(
      overflow.checkPayrollReadiness(actor, {
        target_date: source.target_date,
      })
    ).rejects.toBeInstanceOf(PayrollReadinessReadError);
    await expect(
      overflow.checkPayrollReadiness(actor, {
        target_date: source.target_date,
      })
    ).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });
});

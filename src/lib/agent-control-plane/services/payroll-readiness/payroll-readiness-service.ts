import "server-only";

import { z } from "zod-v4";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";

import {
  PAYROLL_READINESS_FRESHNESS_HOURS,
  PAYROLL_READINESS_HARD_REASONS,
  PAYROLL_READINESS_MAX_HORIZON_DAYS,
  PAYROLL_READINESS_MAX_OCCURRENCES_PER_OBLIGATION,
  PAYROLL_READINESS_MAX_OUTPUT_CHARACTERS,
  PAYROLL_READINESS_METRIC_DEFINITION_REVISION,
  PAYROLL_READINESS_MIN_PAYER_SAMPLE,
  PAYROLL_READINESS_PROMPT_SAFETY_DIRECTIVE,
  PAYROLL_READINESS_SCHEMA_REVISION,
  CanonicalPayrollDateSchema,
  CheckPayrollReadinessInputSchema,
  PayrollReadinessResultSchema,
  PayrollReadinessSourceSnapshotSchema,
  PayrollReadinessTargetDateError,
  type CheckPayrollReadinessInput,
  type PayrollReadinessResult,
  type PayrollReadinessSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/payroll-readiness";
import { SUPPORTED_ISO_4217_CURRENCY_CODES } from "@/lib/agent-control-plane/contracts/common";
import {
  AgentErrorSchema,
  CONTRACT_VERSION,
} from "@/lib/agent-control-plane/contracts";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
  resolveRecurringServicePriceChangeCapabilityAuthorization,
  resolvePayrollReadinessCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  PayrollReadinessRepositoryUnavailableError,
  isTrustedPayrollReadinessRepository,
  type PayrollReadinessRepository,
} from "./payroll-readiness-repository";

const DAY_MILLISECONDS = 86_400_000;
const MINUTE_NANOSECONDS = BigInt(60_000_000_000);
const FRESHNESS_NANOSECONDS =
  BigInt(PAYROLL_READINESS_FRESHNESS_HOURS) * BigInt(3_600_000_000_000);
const CAPABILITY_ID = "check_payroll_readiness" as const;
const DEFAULT_MAX_OUTPUT_CHARACTERS = PAYROLL_READINESS_MAX_OUTPUT_CHARACTERS;
const TRUSTED_SERVICES = new WeakSet<object>();

type CompletenessReason =
  PayrollReadinessResult["completeness"]["reasons"][number];
type SourceRef =
  PayrollReadinessResult["supporting_records"][number]["source_ref"];

const ZERO_MINOR_UNIT_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_MINOR_UNIT_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);
const FOUR_MINOR_UNIT_CURRENCIES = new Set(["CLF", "UYW"]);
const UNSUPPORTED_CURRENCIES = new Set([
  "XAD",
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XDR",
  "XPD",
  "XPT",
  "XSU",
  "XTS",
  "XUA",
  "XXX",
]);

export const ISO_4217_MINOR_EXPONENTS_2026_01_01 = Object.freeze(
  Object.fromEntries(
    SUPPORTED_ISO_4217_CURRENCY_CODES.map((currency) => [
      currency,
      UNSUPPORTED_CURRENCIES.has(currency)
        ? null
        : ZERO_MINOR_UNIT_CURRENCIES.has(currency)
          ? 0
          : THREE_MINOR_UNIT_CURRENCIES.has(currency)
            ? 3
            : FOUR_MINOR_UNIT_CURRENCIES.has(currency)
              ? 4
              : 2,
    ])
  ) as Readonly<
    Record<(typeof SUPPORTED_ISO_4217_CURRENCY_CODES)[number], number | null>
  >
);

const HARD_REASONS = new Set<CompletenessReason>(
  PAYROLL_READINESS_HARD_REASONS
);

const SUPPORTED_CADENCES = new Set([
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annually",
] as const);
type SupportedCadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annually";

function isSupportedCadence(value: string): value is SupportedCadence {
  return SUPPORTED_CADENCES.has(value as SupportedCadence);
}

function hasValidSchedule(
  obligation: PayrollReadinessSourceSnapshot["recurring_obligations"][number]
): boolean {
  return (
    isCanonicalDate(obligation.next_due_date) &&
    (obligation.end_date === null || isCanonicalDate(obligation.end_date)) &&
    isSupportedCadence(obligation.cadence) &&
    (obligation.end_date === null ||
      obligation.end_date >= obligation.next_due_date)
  );
}

function isCanonicalDate(value: string): boolean {
  return CanonicalPayrollDateSchema.safeParse(value).success;
}

function dateMilliseconds(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string | null {
  if (!isCanonicalDate(date) || !Number.isSafeInteger(days)) return null;
  const targetMilliseconds = dateMilliseconds(date) + days * DAY_MILLISECONDS;
  if (!Number.isFinite(targetMilliseconds)) return null;
  const instant = new Date(targetMilliseconds);
  if (Number.isNaN(instant.getTime())) return null;
  const candidate = instant.toISOString().slice(0, 10);
  return isCanonicalDate(candidate) ? candidate : null;
}

function addMonthsClamped(date: string, months: number): string | null {
  if (!isCanonicalDate(date) || !Number.isSafeInteger(months)) return null;
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  if (targetYear < 1 || targetYear > 9_999) return null;
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const leapYear =
    targetYear % 4 === 0 && (targetYear % 100 !== 0 || targetYear % 400 === 0);
  const lastDay = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][targetMonthIndex]!;
  const candidate = `${String(targetYear).padStart(4, "0")}-${String(
    targetMonthIndex + 1
  ).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  return isCanonicalDate(candidate) ? candidate : null;
}

function minorExponent(currency: string): number | null {
  if (!Object.hasOwn(ISO_4217_MINOR_EXPONENTS_2026_01_01, currency)) {
    return null;
  }
  return ISO_4217_MINOR_EXPONENTS_2026_01_01[
    currency as keyof typeof ISO_4217_MINOR_EXPONENTS_2026_01_01
  ];
}

function safeMinorTotal(
  value: bigint,
  reasons: Set<CompletenessReason>
): number | null {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    reasons.add("financial_total_overflow");
    return null;
  }
  return Number(value);
}

function exactMinor(amount: string, currency: string): number | null {
  const exponent = minorExponent(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (exponent === null || !match) return null;
  const sign = match[1] === "-" ? BigInt(-1) : BigInt(1);
  const whole = match[2]!;
  const rawFraction = match[3] ?? "";
  const retained = rawFraction.slice(0, exponent).padEnd(exponent, "0");
  const discarded = rawFraction.slice(exponent);
  if (discarded.length > 0 && /[1-9]/.test(discarded)) return null;
  const value =
    sign *
    (BigInt(whole) * BigInt(10) ** BigInt(exponent) + BigInt(retained || "0"));
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function utcTimestampNanoseconds(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    value
  );
  if (!match) return null;
  const wholeMilliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(wholeMilliseconds)) return null;
  const fraction = (match[2] ?? "").padEnd(9, "0");
  return BigInt(wholeMilliseconds) * BigInt(1_000_000) + BigInt(fraction);
}

function differenceDays(later: string, earlier: string): number {
  return (
    (dateMilliseconds(later) - dateMilliseconds(earlier)) / DAY_MILLISECONDS
  );
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function occurrenceDate(
  start: string,
  cadence: SupportedCadence,
  index: number
): string | null {
  if (cadence === "weekly") return addDays(start, index * 7);
  if (cadence === "biweekly") return addDays(start, index * 14);
  if (cadence === "monthly") return addMonthsClamped(start, index);
  if (cadence === "quarterly") return addMonthsClamped(start, index * 3);
  return addMonthsClamped(start, index * 12);
}

function occurrencesThrough(
  obligation: PayrollReadinessSourceSnapshot["recurring_obligations"][number],
  targetDate: string,
  reasons: Set<CompletenessReason>
): string[] {
  const cadence = obligation.cadence;
  if (
    !isCanonicalDate(obligation.next_due_date) ||
    (obligation.end_date !== null && !isCanonicalDate(obligation.end_date)) ||
    !isSupportedCadence(cadence) ||
    (obligation.end_date !== null &&
      obligation.end_date < obligation.next_due_date)
  ) {
    reasons.add("obligation_schedule_invalid");
    return [];
  }
  const dates: string[] = [];
  for (
    let index = 0;
    index <= PAYROLL_READINESS_MAX_OCCURRENCES_PER_OBLIGATION;
    index += 1
  ) {
    const date = occurrenceDate(obligation.next_due_date, cadence, index);
    if (date === null) {
      reasons.add("obligation_schedule_invalid");
      return [];
    }
    if (
      date > targetDate ||
      (obligation.end_date && date > obligation.end_date)
    ) {
      return dates;
    }
    if (index === PAYROLL_READINESS_MAX_OCCURRENCES_PER_OBLIGATION) {
      reasons.add("obligation_schedule_invalid");
      return [];
    }
    dates.push(date);
    if (date === targetDate) return dates;
  }
  reasons.add("obligation_schedule_invalid");
  return [];
}

function recordKind(
  reference: string
): PayrollReadinessResult["supporting_records"][number]["kind"] {
  return reference.slice(
    0,
    reference.indexOf(":")
  ) as PayrollReadinessResult["supporting_records"][number]["kind"];
}

function validateTarget(
  snapshot: PayrollReadinessSourceSnapshot,
  input: CheckPayrollReadinessInput
): void {
  const days = differenceDays(input.target_date, snapshot.business_date);
  if (
    snapshot.target_date !== input.target_date ||
    !Number.isInteger(days) ||
    days < 0 ||
    days > PAYROLL_READINESS_MAX_HORIZON_DAYS
  ) {
    throw new PayrollReadinessTargetDateError();
  }
}

function normalizedLocalTime(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(6, "0").slice(0, 6)}`;
}

function observedLocalDateTime(
  observedAt: string,
  timezone: string
): { readonly date: string; readonly time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(observedAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const fraction = /\.(\d{1,9})Z$/.exec(observedAt)?.[1] ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}.${fraction
      .padEnd(6, "0")
      .slice(0, 6)}`,
  };
}

export function calculatePayrollReadiness(
  rawSnapshot: PayrollReadinessSourceSnapshot,
  input: CheckPayrollReadinessInput
): PayrollReadinessResult {
  const snapshot = PayrollReadinessSourceSnapshotSchema.parse(rawSnapshot);
  validateTarget(snapshot, input);
  const reasons = new Set<CompletenessReason>();
  const supportingRefs = new Set<SourceRef>();
  const currency = snapshot.context.currency_code;
  const observedNanoseconds = utcTimestampNanoseconds(snapshot.observed_at)!;
  const settingsRef = snapshot.settings
    ? (`expense_settings:${snapshot.settings.id}` as SourceRef)
    : null;
  if (settingsRef) supportingRefs.add(settingsRef);

  if (Object.values(snapshot.source_bounds).some(Boolean)) {
    reasons.add("source_bound_reached");
  }

  let cashMinor: number | null = null;
  let cashAgeMinutes: number | null = null;
  let cashFresh = false;
  if (snapshot.settings?.cash_balance == null) {
    reasons.add("cash_missing");
  } else {
    cashMinor = exactMinor(snapshot.settings.cash_balance, currency);
    if (cashMinor === null) reasons.add("cash_amount_invalid");
  }
  if (snapshot.settings?.cash_balance_updated_at == null) {
    reasons.add("cash_timestamp_invalid");
  } else {
    const captured = utcTimestampNanoseconds(
      snapshot.settings.cash_balance_updated_at
    );
    const age = captured === null ? null : observedNanoseconds - captured;
    if (age === null || age < BigInt(0)) {
      reasons.add("cash_timestamp_invalid");
    } else {
      cashAgeMinutes = Number(age / MINUTE_NANOSECONDS);
      cashFresh = age <= FRESHNESS_NANOSECONDS;
      if (!cashFresh) reasons.add("cash_stale");
    }
  }

  const confirmedThrough =
    snapshot.settings?.obligations_confirmed_through ?? null;
  const confirmedAt = snapshot.settings?.obligations_confirmed_at ?? null;
  if (confirmedThrough === null || confirmedAt === null) {
    reasons.add("obligation_coverage_missing");
  } else {
    if (!isCanonicalDate(confirmedThrough)) {
      reasons.add("obligation_confirmation_invalid");
    } else if (confirmedThrough < input.target_date) {
      reasons.add("obligation_coverage_incomplete");
    }
    const confirmedNanoseconds = utcTimestampNanoseconds(confirmedAt);
    const age =
      confirmedNanoseconds === null
        ? null
        : observedNanoseconds - confirmedNanoseconds;
    if (age === null || age < BigInt(0)) {
      reasons.add("obligation_confirmation_invalid");
    } else if (age > FRESHNESS_NANOSECONDS) {
      reasons.add("obligation_confirmation_stale");
    }
    const obligationUpdateTimes = snapshot.recurring_obligations.map(
      (obligation) => utcTimestampNanoseconds(obligation.updated_at)
    );
    if (obligationUpdateTimes.some((updatedAt) => updatedAt === null)) {
      reasons.add("obligation_confirmation_invalid");
    } else if (
      confirmedNanoseconds !== null &&
      obligationUpdateTimes.some(
        (updatedAt) => updatedAt !== null && updatedAt > confirmedNanoseconds
      )
    ) {
      reasons.add("obligation_changed_after_confirmation");
    }
  }

  const occurrencesById = new Map<string, string[]>();
  const validSchedules = new Set<string>();
  for (const obligation of snapshot.recurring_obligations) {
    supportingRefs.add(`recurring_expense:${obligation.id}` as SourceRef);
    const occurrences = occurrencesThrough(
      obligation,
      input.target_date,
      reasons
    );
    occurrencesById.set(obligation.id, occurrences);
    if (hasValidSchedule(obligation) && occurrences.length > 0) {
      validSchedules.add(obligation.id);
    }
    if (obligation.obligation_kind === null)
      reasons.add("obligation_kind_missing");
    if (obligation.currency !== currency)
      reasons.add("obligation_currency_invalid");
    const amountMinor = exactMinor(obligation.amount, currency);
    if (amountMinor === null || amountMinor < 0) {
      reasons.add("obligation_amount_invalid");
    }
  }

  const targetPayroll = snapshot.recurring_obligations.filter(
    (obligation) =>
      obligation.obligation_kind === "payroll" &&
      occurrencesById.get(obligation.id)?.includes(input.target_date)
  );
  if (targetPayroll.length === 0) reasons.add("payroll_not_configured");
  if (targetPayroll.some((obligation) => obligation.due_time_local === null)) {
    reasons.add("payroll_timing_missing");
  }
  const payrollTimes = targetPayroll
    .map((obligation) => obligation.due_time_local)
    .filter((time): time is string => time !== null)
    .sort();
  const cutoffTime = payrollTimes.at(-1) ?? null;
  const localObserved = observedLocalDateTime(
    snapshot.observed_at,
    snapshot.context.timezone
  );
  const cutoffElapsedCandidate =
    cutoffTime !== null &&
    input.target_date === localObserved.date &&
    localObserved.time > normalizedLocalTime(cutoffTime);

  let payrollMinorExact = BigInt(0);
  let otherRecurringMinorExact = BigInt(0);
  let payrollArithmeticValid = cutoffTime !== null;
  let otherRecurringArithmeticValid = true;
  const payrollRefs = new Set<SourceRef>();
  const otherRecurringRefs = new Set<SourceRef>();
  const obligationItems: PayrollReadinessResult["obligations"]["items"] = [];
  for (const obligation of snapshot.recurring_obligations) {
    const amountMinor = exactMinor(obligation.amount, currency);
    if (
      obligation.currency !== currency ||
      amountMinor === null ||
      amountMinor < 0 ||
      obligation.obligation_kind === null ||
      !validSchedules.has(obligation.id)
    ) {
      if (obligation.obligation_kind === "payroll") {
        payrollArithmeticValid = false;
      } else if (obligation.obligation_kind === "other") {
        otherRecurringArithmeticValid = false;
      } else {
        payrollArithmeticValid = false;
        otherRecurringArithmeticValid = false;
      }
      continue;
    }
    for (const date of occurrencesById.get(obligation.id) ?? []) {
      if (date === input.target_date) {
        if (obligation.due_time_local === null) {
          reasons.add(
            obligation.obligation_kind === "payroll"
              ? "payroll_timing_missing"
              : "obligation_timing_missing"
          );
          if (obligation.obligation_kind === "payroll") {
            payrollArithmeticValid = false;
          } else {
            otherRecurringArithmeticValid = false;
          }
          continue;
        }
        if (cutoffTime === null) {
          if (obligation.obligation_kind === "other") {
            otherRecurringArithmeticValid = false;
          }
          continue;
        }
        if (obligation.due_time_local > cutoffTime) continue;
      }
      const reference = `recurring_expense:${obligation.id}` as SourceRef;
      if (obligation.obligation_kind === "payroll") {
        payrollMinorExact += BigInt(amountMinor);
        payrollRefs.add(reference);
        obligationItems.push({
          kind: "payroll",
          source_ref: reference,
          occurrence_date: date,
          due_time_local: obligation.due_time_local,
          amount_minor: amountMinor,
        });
      } else {
        otherRecurringMinorExact += BigInt(amountMinor);
        otherRecurringRefs.add(reference);
        obligationItems.push({
          kind: "other_recurring",
          source_ref: reference,
          occurrence_date: date,
          due_time_local: obligation.due_time_local,
          amount_minor: amountMinor,
        });
      }
    }
  }

  let reimbursementsMinorExact = BigInt(0);
  let reimbursementArithmeticValid = true;
  const reimbursementRefs = new Set<SourceRef>();
  for (const batch of snapshot.reimbursement_batches) {
    const reference = `expense_batch:${batch.id}` as SourceRef;
    supportingRefs.add(reference);
    if (
      batch.line_count === 0 ||
      batch.currency_codes.length !== 1 ||
      batch.currency_codes[0] !== currency
    ) {
      reasons.add("reimbursement_currency_invalid");
      reimbursementArithmeticValid = false;
      continue;
    }
    const amountMinor =
      batch.owed_amount === null
        ? null
        : exactMinor(batch.owed_amount, currency);
    if (amountMinor === null || amountMinor < 0) {
      reasons.add("reimbursement_amount_invalid");
      reimbursementArithmeticValid = false;
      continue;
    }
    reimbursementsMinorExact += BigInt(amountMinor);
    reimbursementRefs.add(reference);
    obligationItems.push({
      kind: "reimbursement",
      source_ref: reference,
      occurrence_date: snapshot.business_date,
      due_time_local: null,
      amount_minor: amountMinor,
    });
  }

  const payrollMinor = safeMinorTotal(payrollMinorExact, reasons);
  const otherRecurringMinor = safeMinorTotal(otherRecurringMinorExact, reasons);
  const reimbursementsMinor = safeMinorTotal(reimbursementsMinorExact, reasons);
  if (
    cutoffElapsedCandidate &&
    payrollArithmeticValid &&
    payrollMinor !== null
  ) {
    reasons.add("payroll_cutoff_elapsed");
  }
  const obligationsValid =
    payrollArithmeticValid &&
    otherRecurringArithmeticValid &&
    reimbursementArithmeticValid &&
    cutoffTime !== null &&
    payrollMinor !== null &&
    otherRecurringMinor !== null &&
    reimbursementsMinor !== null;
  const totalObligationsMinor = obligationsValid
    ? safeMinorTotal(
        payrollMinorExact + otherRecurringMinorExact + reimbursementsMinorExact,
        reasons
      )
    : null;

  const historyByPayer = new Map<string, typeof snapshot.payer_history>();
  for (const history of snapshot.payer_history) {
    const reference = `invoice:${history.invoice_id}` as SourceRef;
    supportingRefs.add(reference);
    if (history.identity_conflict)
      reasons.add("payer_history_identity_conflict");
    let historyValid = true;
    if (!history.amount_valid) {
      reasons.add("payer_history_amount_invalid");
      historyValid = false;
    }
    if (
      !isCanonicalDate(history.due_date) ||
      !isCanonicalDate(history.settled_on)
    ) {
      reasons.add("payer_history_date_invalid");
      historyValid = false;
    }
    if (!historyValid) continue;
    if (
      differenceDays(history.settled_on, history.due_date) !==
      history.delay_days
    ) {
      reasons.add("payer_history_delay_inconsistent");
      continue;
    }
    const group = historyByPayer.get(history.payer_id) ?? [];
    group.push(history);
    historyByPayer.set(history.payer_id, group);
  }

  const payerBehaviors: PayrollReadinessResult["payer_behaviors"] = [];
  const behaviorByPayer = new Map<
    string,
    PayrollReadinessResult["payer_behaviors"][number]
  >();
  for (const [payerId, rows] of [...historyByPayer.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const usable = rows.filter((row) => !row.identity_conflict);
    if (usable.length < PAYROLL_READINESS_MIN_PAYER_SAMPLE) continue;
    const delays = usable.map((row) => row.delay_days).sort((a, b) => a - b);
    const behavior: PayrollReadinessResult["payer_behaviors"][number] = {
      payer_ref: `client:${payerId}`,
      sample_count: usable.length,
      p25_delay_days: percentile(delays, 0.25),
      p50_delay_days: percentile(delays, 0.5),
      p75_delay_days: percentile(delays, 0.75),
      history_refs: usable.map(
        (row) => `invoice:${row.invoice_id}` as SourceRef
      ),
    };
    payerBehaviors.push(behavior);
    behaviorByPayer.set(payerId, behavior);
  }

  let openTotalMinorExact = BigInt(0);
  let receivableArithmeticValid = true;
  let bestInflowMinorExact = BigInt(0);
  let baseInflowMinorExact = BigInt(0);
  const bestReceivableRefs: SourceRef[] = [];
  const baseReceivableRefs: SourceRef[] = [];
  const modeledRefs: SourceRef[] = [];
  const unmodeledRefs: SourceRef[] = [];
  const receivableItems: PayrollReadinessResult["receivables"]["items"] = [];
  for (const invoice of snapshot.receivables) {
    const reference = `invoice:${invoice.invoice_id}` as SourceRef;
    const payerRef = `client:${invoice.payer_id}` as const;
    supportingRefs.add(reference);
    const total = exactMinor(invoice.total_amount, currency);
    const storedPaid = exactMinor(invoice.stored_amount_paid, currency);
    const storedBalance = exactMinor(invoice.stored_balance_due, currency);
    const calculatedBalance = exactMinor(invoice.calculated_balance, currency);
    const amountsValid =
      total !== null &&
      storedPaid !== null &&
      storedBalance !== null &&
      calculatedBalance !== null &&
      total >= 0 &&
      storedPaid >= 0 &&
      storedBalance >= 0 &&
      calculatedBalance > 0;
    if (!amountsValid) {
      reasons.add("receivable_amount_invalid");
      receivableArithmeticValid = false;
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: null,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    if (
      !isCanonicalDate(invoice.due_date) ||
      (invoice.sent_at !== null &&
        (utcTimestampNanoseconds(invoice.sent_at) === null ||
          utcTimestampNanoseconds(invoice.sent_at)! > observedNanoseconds))
    ) {
      reasons.add("receivable_date_invalid");
      receivableArithmeticValid = false;
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    openTotalMinorExact += BigInt(calculatedBalance);
    if (
      total - storedPaid !== storedBalance ||
      storedBalance !== calculatedBalance
    ) {
      reasons.add("receivable_balance_inconsistent");
      receivableArithmeticValid = false;
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    if (invoice.identity_conflict) {
      reasons.add("receivable_identity_conflict");
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    if (invoice.sent_at === null) {
      reasons.add("receivable_delivery_missing");
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    const behavior = behaviorByPayer.get(invoice.payer_id);
    if (!behavior) {
      reasons.add("payer_history_sample_insufficient");
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    const bestArrival = addDays(invoice.due_date, behavior.p25_delay_days);
    const baseArrival = addDays(invoice.due_date, behavior.p50_delay_days);
    if (bestArrival === null || baseArrival === null) {
      reasons.add("receivable_projection_invalid");
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: null,
        p50_arrival_date: null,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    if (bestArrival < snapshot.business_date) {
      reasons.add("receivable_projection_overdue");
      unmodeledRefs.push(reference);
      receivableItems.push({
        source_ref: reference,
        payer_ref: payerRef,
        balance_minor: calculatedBalance,
        p25_arrival_date: bestArrival,
        p50_arrival_date: baseArrival,
        included_best: false,
        included_base: false,
        modeled: false,
      });
      continue;
    }
    modeledRefs.push(reference);
    if (
      bestArrival === input.target_date ||
      baseArrival === input.target_date
    ) {
      reasons.add("receivable_same_day_timing_unknown");
    }
    if (bestArrival < input.target_date) {
      bestInflowMinorExact += BigInt(calculatedBalance);
      bestReceivableRefs.push(reference);
    }
    if (baseArrival < input.target_date) {
      baseInflowMinorExact += BigInt(calculatedBalance);
      baseReceivableRefs.push(reference);
    }
    receivableItems.push({
      source_ref: reference,
      payer_ref: payerRef,
      balance_minor: calculatedBalance,
      p25_arrival_date: bestArrival,
      p50_arrival_date: baseArrival,
      included_best: bestArrival < input.target_date,
      included_base: baseArrival < input.target_date,
      modeled: true,
    });
  }

  const openTotalMinor = safeMinorTotal(openTotalMinorExact, reasons);
  const bestInflowMinor = safeMinorTotal(bestInflowMinorExact, reasons);
  const baseInflowMinor = safeMinorTotal(baseInflowMinorExact, reasons);
  if (
    openTotalMinor === null ||
    bestInflowMinor === null ||
    baseInflowMinor === null
  ) {
    receivableArithmeticValid = false;
  }
  const arithmeticReady = cashMinor !== null && totalObligationsMinor !== null;
  const ending = (inflow: number | null): number | null => {
    if (!arithmeticReady || inflow === null) return null;
    return safeMinorTotal(
      BigInt(cashMinor!) + BigInt(inflow) - BigInt(totalObligationsMinor!),
      reasons
    );
  };
  const scenarios: PayrollReadinessResult["scenarios"] = [
    {
      name: "best",
      receivable_inflow_minor: bestInflowMinor,
      ending_balance_minor: ending(bestInflowMinor),
      receivable_refs: bestReceivableRefs,
    },
    {
      name: "base",
      receivable_inflow_minor: baseInflowMinor,
      ending_balance_minor: ending(baseInflowMinor),
      receivable_refs: baseReceivableRefs,
    },
    {
      name: "worst",
      receivable_inflow_minor: 0,
      ending_balance_minor: ending(0),
      receivable_refs: [],
    },
  ];
  const bestEnding = scenarios[0].ending_balance_minor;
  const worstEnding = scenarios[2].ending_balance_minor;
  const hardGap = [...reasons].some((reason) => HARD_REASONS.has(reason));
  const outcomeDependsOnUnknownReceivable =
    (unmodeledRefs.length > 0 ||
      reasons.has("receivable_same_day_timing_unknown")) &&
    worstEnding !== null &&
    worstEnding < 0;

  let decision: PayrollReadinessResult["decision"];
  if (
    hardGap ||
    bestEnding === null ||
    worstEnding === null ||
    outcomeDependsOnUnknownReceivable
  ) {
    decision = "insufficient_evidence";
  } else if (worstEnding >= 0) {
    decision = "yes";
  } else if (bestEnding < 0) {
    decision = "no";
  } else {
    decision = "at_risk";
  }

  const sortedReasons = [...reasons].sort() as CompletenessReason[];
  const completenessState: PayrollReadinessResult["completeness"]["state"] =
    decision === "insufficient_evidence"
      ? "insufficient"
      : sortedReasons.length > 0
        ? "partial"
        : "complete";
  const supportingRecords = [...supportingRefs]
    .sort()
    .map((source_ref) => ({ source_ref, kind: recordKind(source_ref) }));

  return PayrollReadinessResultSchema.parse({
    schema_revision: PAYROLL_READINESS_SCHEMA_REVISION,
    metric_definition_revision: PAYROLL_READINESS_METRIC_DEFINITION_REVISION,
    observed_at: snapshot.observed_at,
    decision,
    target_date: input.target_date,
    context: {
      timezone: snapshot.context.timezone,
      currency_code: currency,
    },
    payroll_cutoff:
      cutoffTime === null || !payrollArithmeticValid || payrollMinor === null
        ? null
        : {
            date: input.target_date,
            time_local: cutoffTime,
            timezone: snapshot.context.timezone,
          },
    cash: {
      current_minor: cashMinor,
      captured_at:
        snapshot.settings?.cash_balance_updated_at != null &&
        utcTimestampNanoseconds(snapshot.settings.cash_balance_updated_at) !==
          null
          ? snapshot.settings.cash_balance_updated_at
          : null,
      age_minutes: cashAgeMinutes,
      fresh: cashFresh,
      source_ref: settingsRef,
    },
    obligations: {
      payroll_minor: payrollArithmeticValid ? payrollMinor : null,
      other_recurring_minor: otherRecurringArithmeticValid
        ? otherRecurringMinor
        : null,
      reimbursements_minor: reimbursementArithmeticValid
        ? reimbursementsMinor
        : null,
      total_minor: totalObligationsMinor,
      payroll_refs: [...payrollRefs].sort(),
      other_recurring_refs: [...otherRecurringRefs].sort(),
      reimbursement_refs: [...reimbursementRefs].sort(),
      items: obligationItems.sort(
        (a, b) =>
          a.occurrence_date.localeCompare(b.occurrence_date) ||
          a.source_ref.localeCompare(b.source_ref)
      ),
    },
    payer_behaviors: payerBehaviors,
    receivables: {
      open_total_minor: receivableArithmeticValid ? openTotalMinor : null,
      modeled_refs: modeledRefs.sort(),
      unmodeled_refs: unmodeledRefs.sort(),
      items: receivableItems.sort((a, b) =>
        a.source_ref.localeCompare(b.source_ref)
      ),
    },
    scenarios,
    completeness: {
      state: completenessState,
      reasons: sortedReasons,
      source_counts: snapshot.source_counts,
      source_bounds: snapshot.source_bounds,
    },
    definitions: {
      horizon_days: PAYROLL_READINESS_MAX_HORIZON_DAYS,
      freshness_hours: PAYROLL_READINESS_FRESHNESS_HOURS,
      minimum_payer_sample: PAYROLL_READINESS_MIN_PAYER_SAMPLE,
      best_case_delay: "payer_empirical_p25",
      base_case_delay: "payer_empirical_p50",
      worst_case_receivables: "zero_not_guaranteed",
      same_day_receivables: "excluded_time_unknown",
    },
    source_revisions: snapshot.source_revisions,
    supporting_records: supportingRecords,
    prompt_safety: {
      content_kind: "untrusted_business_data",
      directive: PAYROLL_READINESS_PROMPT_SAFETY_DIRECTIVE,
    },
  });
}

export class PayrollReadinessReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_ARGUMENT"
    | "RESULT_TOO_LARGE"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: PayrollReadinessReadError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "Payroll readiness could not be checked.",
      INVALID_ARGUMENT: "Enter one valid payroll date within the next 93 days.",
      RESULT_TOO_LARGE: "The payroll readiness result is too large to return.",
      TEMPORARILY_UNAVAILABLE:
        "Payroll readiness is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "PayrollReadinessReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.code === "TEMPORARILY_UNAVAILABLE";
  }

  toAgentError() {
    if (this.code === "INVALID_ARGUMENT") {
      return AgentErrorSchema.parse({
        contract_version: CONTRACT_VERSION,
        code: "INVALID_ARGUMENT",
        request_id: this.requestId,
        message: this.message,
        retryable: false,
        details: {
          field_issues: [
            {
              path: ["target_date"],
              code: "PAYROLL_TARGET_DATE_INVALID",
              message: this.message,
            },
          ],
        },
      });
    }
    return toP2ReadAgentError({
      code: this.code,
      requestId: this.requestId,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

export interface PayrollReadinessService {
  checkPayrollReadiness(
    actorContext: ActorContext,
    input: CheckPayrollReadinessInput,
    options?: { signal?: AbortSignal }
  ): Promise<PayrollReadinessResult>;
}

export function createPayrollReadinessService(input: {
  repository: PayrollReadinessRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): PayrollReadinessService {
  if (!isTrustedPayrollReadinessRepository(input.repository)) {
    throw new TypeError("A trusted payroll readiness repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("A payroll readiness authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > DEFAULT_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Payroll readiness service options are invalid");
  }

  const service: PayrollReadinessService = {
    async checkPayrollReadiness(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "payroll_readiness_actor_context_untrusted"
        );
      }
      let parsedInput: z.infer<typeof CheckPayrollReadinessInputSchema>;
      try {
        parsedInput = CheckPayrollReadinessInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new PayrollReadinessReadError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }

      const usesAdditiveV9Manifest =
        actorContext.capabilityManifestRevision ===
        RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION;
      const resolveAuthorization = usesAdditiveV9Manifest
        ? resolveRecurringServicePriceChangeCapabilityAuthorization
        : resolvePayrollReadinessCapabilityAuthorization;
      const authorizationManifestRevision = usesAdditiveV9Manifest
        ? RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
        : PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION;
      const initial = resolveAuthorization(CAPABILITY_ID, parsedInput);
      if (initial.variants.length !== 1) {
        throw authorizationInternal(
          actorContext.requestId,
          "payroll_readiness_authorization_variant_invalid"
        );
      }
      authorizeCapability({
        actorContext,
        policy: initial.variants[0]!.policy,
      });
      const currentActor = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision: authorizationManifestRevision,
        signal: options?.signal,
      });
      const current = resolveAuthorization(CAPABILITY_ID, parsedInput);
      if (current.variants.length !== 1) {
        throw authorizationInternal(
          currentActor.requestId,
          "payroll_readiness_authorization_variant_invalid"
        );
      }
      authorizeCapability({
        actorContext: currentActor,
        policy: current.variants[0]!.policy,
      });

      try {
        const snapshot = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          observedAt: now().toISOString(),
          targetDate: parsedInput.target_date,
          signal: options?.signal,
        });
        const result = calculatePayrollReadiness(snapshot, parsedInput);
        if (JSON.stringify(result).length > maxOutputCharacters) {
          throw new PayrollReadinessReadError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof PayrollReadinessReadError) throw error;
        if (error instanceof PayrollReadinessTargetDateError) {
          throw new PayrollReadinessReadError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof PayrollReadinessRepositoryUnavailableError) {
          throw new PayrollReadinessReadError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new PayrollReadinessReadError({
          code: "INTERNAL",
          requestId: actorContext.requestId,
          cause: error,
        });
      }
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedPayrollReadinessService(
  value: unknown
): value is PayrollReadinessService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}

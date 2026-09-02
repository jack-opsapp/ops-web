import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { RRule } from "rrule";
import { z } from "zod-v4";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  ActorAccessError,
  authorizationInternal,
} from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";

import {
  CONTRACT_VERSION,
  AgentErrorSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  PrepareRecurringServicePriceChangeInputSchema,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_ACCOUNTS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_EVIDENCE_REFS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_EXCEPTIONS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS,
  RECURRING_SERVICE_PRICE_CHANGE_NOTICE_FORMATTER_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_PROMPT_SAFETY_DIRECTIVE,
  RECURRING_SERVICE_PRICE_CHANGE_SCHEMA_REVISION,
  RecurringServicePriceChangeResultSchema,
  type PrepareRecurringServicePriceChangeInput,
  type RecurringServicePriceChangeExclusionReason,
  type RecurringServicePriceChangeResult,
  type RecurringServicePriceChangeRecurrenceCatalog,
  type RecurringServicePriceChangeSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/recurring-service-price-change";
import { ISO_4217_MINOR_EXPONENTS_2026_01_01 } from "@/lib/agent-control-plane/services/payroll-readiness/payroll-readiness-service";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
  resolveRecurringServicePriceChangeCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  isTrustedRecurringServicePriceChangeRepository,
  RecurringServicePriceChangeRepositoryAuthorityError,
  RecurringServicePriceChangeRepositoryBoundError,
  RecurringServicePriceChangeRepositoryInputError,
  RecurringServicePriceChangeRepositoryStaleError,
  RecurringServicePriceChangeRepositoryUnavailableError,
  type RecurringServicePriceChangeRepository,
} from "./recurring-service-price-change-repository";

const DAY_MILLISECONDS = 86_400_000;
const PERCENT_SCALE = BigInt(10_000);
const ONE_HUNDRED_PERCENT_SCALED = BigInt(100) * PERCENT_SCALE;
const CAPABILITY_ID = "prepare_recurring_service_price_change" as const;
const TRUSTED_SERVICES = new WeakSet<object>();
const MAX_MONTH_OCCURRENCES = 31;
const MAX_VALIDATION_OCCURRENCES = 94;
const MAX_DIRECT_RRULE_OCCURRENCE_WORK = 10_000;
const MAX_CATALOG_CLASSIFICATION_WORK = 100_000;
const ALLOWED_RRULE_KEYS = new Set([
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "WKST",
  "BYMONTH",
  "BYMONTHDAY",
  "BYDAY",
  "BYSETPOS",
  "BYYEARDAY",
  "BYWEEKNO",
  "BYHOUR",
  "BYMINUTE",
  "BYSECOND",
  "BYEASTER",
]);

type SourceAccount =
  RecurringServicePriceChangeSourceSnapshot["accounts"][number];
type RecurrenceCarrier = Pick<SourceAccount, "recurrence">;
type Preview = RecurringServicePriceChangeResult["previews"][number];
type Exclusion = RecurringServicePriceChangeResult["exclusions"][number];
type SupportingRecord =
  RecurringServicePriceChangeResult["supporting_records"][number];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

function nextMonth(month: string): string {
  const [year, rawMonth] = month.split("-").map(Number) as [number, number];
  return rawMonth === 12
    ? `${String(year + 1).padStart(4, "0")}-01`
    : `${String(year).padStart(4, "0")}-${String(rawMonth + 1).padStart(2, "0")}`;
}

function validIntegerList(
  value: string,
  minimum: number,
  maximum: number,
  maximumItems: number,
  allowZero = false
): boolean {
  const items = value.split(",");
  return (
    items.length <= maximumItems &&
    new Set(items).size === items.length &&
    items.every((item) => {
      if (!/^-?(?:0|[1-9]\d{0,2})$/.test(item)) return false;
      const number = Number(item);
      return (
        Number.isSafeInteger(number) &&
        (allowZero || number !== 0) &&
        number >= minimum &&
        number <= maximum
      );
    })
  );
}

function validByDay(value: string): boolean {
  const items = value.split(",");
  if (items.length > 7 || new Set(items).size !== items.length) return false;
  return items.every((item) => {
    const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
    if (!match) return false;
    if (match[1] === undefined) return true;
    const ordinal = Number(match[1]);
    return ordinal !== 0 && ordinal >= -53 && ordinal <= 53;
  });
}

function validRruleValue(key: string, value: string): boolean {
  switch (key) {
    case "FREQ":
      return ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value);
    case "INTERVAL":
      return /^[1-9]\d{0,2}$/.test(value) && Number(value) <= 366;
    case "COUNT":
      return /^[1-9]\d{0,5}$/.test(value);
    case "UNTIL": {
      if (!/^\d{8}(?:T\d{6}Z)?$/.test(value)) return false;
      const compact = value.slice(0, 8);
      const canonical = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
      const time = value.includes("T")
        ? `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`
        : "00:00:00";
      const parsed = new Date(`${canonical}T${time}.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 19) === `${canonical}T${time}`
      );
    }
    case "WKST":
      return /^(MO|TU|WE|TH|FR|SA|SU)$/.test(value);
    case "BYMONTH":
      return validIntegerList(value, 1, 12, 12);
    case "BYMONTHDAY":
      return validIntegerList(value, -31, 31, 62);
    case "BYDAY":
      return validByDay(value);
    case "BYSETPOS":
    case "BYYEARDAY":
      return validIntegerList(value, -366, 366, 366);
    case "BYEASTER":
      return (
        /^-?(?:0|[1-9]\d{0,2})$/.test(value) && Math.abs(Number(value)) <= 366
      );
    case "BYWEEKNO":
      return validIntegerList(value, -53, 53, 106);
    case "BYHOUR":
      return validIntegerList(value, 0, 23, 24, true);
    case "BYMINUTE":
    case "BYSECOND":
      return validIntegerList(value, 0, 59, 60, true);
    default:
      return false;
  }
}

function validRruleCombinations(values: ReadonlyMap<string, string>): boolean {
  const frequency = values.get("FREQ");
  const byDay = values.get("BYDAY")?.split(",") ?? [];
  const hasOrdinalByDay = byDay.some((item) => /^[+-]?\d/.test(item));
  const hasSetPositionSource = [
    "BYMONTH",
    "BYMONTHDAY",
    "BYDAY",
    "BYYEARDAY",
    "BYWEEKNO",
    "BYHOUR",
    "BYMINUTE",
    "BYSECOND",
  ].some((key) => values.has(key));
  if (
    (frequency === "WEEKLY" && values.has("BYMONTHDAY")) ||
    (["DAILY", "WEEKLY", "MONTHLY"].includes(frequency ?? "") &&
      values.has("BYYEARDAY")) ||
    (frequency !== "YEARLY" && values.has("BYWEEKNO")) ||
    (frequency !== "YEARLY" && values.has("BYEASTER")) ||
    (["DAILY", "WEEKLY"].includes(frequency ?? "") && hasOrdinalByDay) ||
    (frequency === "YEARLY" && values.has("BYWEEKNO") && hasOrdinalByDay)
  ) {
    return false;
  }
  if (values.has("BYSETPOS") && !hasSetPositionSource) return false;
  if (
    frequency === "MONTHLY" &&
    byDay.some((item) => {
      const ordinal = /^([+-]?\d{1,2})/.exec(item)?.[1];
      return ordinal !== undefined && Math.abs(Number(ordinal)) > 5;
    })
  ) {
    return false;
  }
  return true;
}

function monthOffsetDate(anchor: string, monthOffset: number): Date | null {
  const [year, month, day] = anchor.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const totalMonths = year * 12 + month - 1 + monthOffset;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12;
  const candidate = new Date(Date.UTC(targetYear, targetMonth, day));
  return candidate.getUTCFullYear() === targetYear &&
    candidate.getUTCMonth() === targetMonth &&
    candidate.getUTCDate() === day
    ? candidate
    : null;
}

function shiftedRuleAnchor(
  anchor: string,
  referenceDate: string,
  frequency: number,
  interval: number
): Date | null {
  const anchorInstant = Date.parse(`${anchor}T00:00:00.000Z`);
  const referenceInstant = Date.parse(`${referenceDate}T00:00:00.000Z`);
  if (!Number.isFinite(anchorInstant) || !Number.isFinite(referenceInstant)) {
    return null;
  }
  if (referenceInstant <= anchorInstant) return new Date(anchorInstant);
  if (frequency === RRule.DAILY || frequency === RRule.WEEKLY) {
    const stepDays = interval * (frequency === RRule.WEEKLY ? 7 : 1);
    const elapsedDays = Math.floor(
      (referenceInstant - anchorInstant) / DAY_MILLISECONDS
    );
    const cycles = Math.max(0, Math.floor(elapsedDays / stepDays) - 2);
    return new Date(anchorInstant + cycles * stepDays * DAY_MILLISECONDS);
  }
  const [anchorYear, anchorMonth] = anchor.split("-").map(Number) as [
    number,
    number,
  ];
  const [referenceYear, referenceMonth] = referenceDate
    .split("-")
    .map(Number) as [number, number];
  const periodDistance =
    frequency === RRule.MONTHLY
      ? (referenceYear - anchorYear) * 12 + referenceMonth - anchorMonth
      : referenceYear - anchorYear;
  let cycles = Math.max(0, Math.floor(periodDistance / interval) - 2);
  for (let attempt = 0; attempt <= 400 && cycles >= 0; attempt += 1) {
    const monthOffset =
      frequency === RRule.MONTHLY ? cycles * interval : cycles * interval * 12;
    const candidate = monthOffsetDate(anchor, monthOffset);
    if (candidate) return candidate;
    cycles -= 1;
  }
  return null;
}

type ParsedRruleSource = ReturnType<typeof RRule.parseString> & {
  readonly freq: number;
};

function parseRruleSource(source: string): {
  parsed: ParsedRruleSource;
  valuesByKey: ReadonlyMap<string, string>;
} | null {
  try {
    if (source.includes("\n") || source.includes("\r") || source.includes(":"))
      return null;
    const parts = source.split(";");
    if (parts.length === 0 || !parts[0]!.startsWith("FREQ=")) return null;
    const seenKeys = new Set<string>();
    const valuesByKey = new Map<string, string>();
    for (const part of parts) {
      const [key, value, ...rest] = part.split("=");
      if (
        rest.length > 0 ||
        !key ||
        !value ||
        !ALLOWED_RRULE_KEYS.has(key) ||
        seenKeys.has(key) ||
        !validRruleValue(key, value)
      ) {
        return null;
      }
      seenKeys.add(key);
      valuesByKey.set(key, value);
    }
    if (
      (seenKeys.has("COUNT") && seenKeys.has("UNTIL")) ||
      !validRruleCombinations(valuesByKey)
    ) {
      return null;
    }
    const parsed = RRule.parseString(source);
    if (
      parsed.freq === undefined ||
      ![RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY, RRule.YEARLY].includes(
        parsed.freq
      )
    ) {
      return null;
    }
    return { parsed: parsed as ParsedRruleSource, valuesByKey };
  } catch {
    return null;
  }
}

function boundedRule(
  account: RecurrenceCarrier,
  referenceDate: string
): RRule | null {
  try {
    const parsedSource = parseRruleSource(account.recurrence.rrule);
    if (
      !parsedSource ||
      (parsedSource.valuesByKey.has("UNTIL") &&
        account.recurrence.end_anchor !== null)
    ) {
      return null;
    }
    const { parsed, valuesByKey } = parsedSource;
    const interval = parsed.interval ?? 1;
    const originalStart = new Date(
      `${account.recurrence.start_anchor}T00:00:00.000Z`
    );
    const shiftedStart = shiftedRuleAnchor(
      account.recurrence.start_anchor,
      referenceDate,
      parsed.freq,
      interval
    );
    if (!shiftedStart) return null;
    const count = parsed.count ?? null;
    if (count === null) {
      return new RRule({ ...parsed, dtstart: shiftedStart });
    }

    const simpleCountRule = [...valuesByKey.keys()].every((key) =>
      ["FREQ", "INTERVAL", "COUNT", "WKST"].includes(key)
    );
    if (
      simpleCountRule &&
      (parsed.freq === RRule.DAILY || parsed.freq === RRule.WEEKLY)
    ) {
      const stepDays = interval * (parsed.freq === RRule.WEEKLY ? 7 : 1);
      const referenceInstant = Date.parse(`${referenceDate}T00:00:00.000Z`);
      const elapsedDays = Math.max(
        0,
        Math.floor(
          (referenceInstant - originalStart.getTime()) / DAY_MILLISECONDS
        )
      );
      const occurrencesBefore =
        referenceInstant <= originalStart.getTime()
          ? 0
          : Math.floor((elapsedDays - 1) / stepDays) + 1;
      if (count <= occurrencesBefore) {
        return new RRule({
          ...parsed,
          count: undefined,
          dtstart: shiftedStart,
          until: new Date(shiftedStart.getTime() - DAY_MILLISECONDS),
        });
      }
      const remaining = count - occurrencesBefore;
      const firstAtOrAfterReference = new Date(
        originalStart.getTime() +
          occurrencesBefore * stepDays * DAY_MILLISECONDS
      );
      return new RRule({
        ...parsed,
        count: remaining,
        dtstart: firstAtOrAfterReference,
      });
    }

    const elapsedDays = Math.max(
      0,
      Math.floor(
        (Date.parse(`${referenceDate}T00:00:00.000Z`) -
          originalStart.getTime()) /
          DAY_MILLISECONDS
      )
    );
    const timeMultiplicity =
      (valuesByKey.get("BYHOUR")?.split(",").length ?? 1) *
      (valuesByKey.get("BYMINUTE")?.split(",").length ?? 1) *
      (valuesByKey.get("BYSECOND")?.split(",").length ?? 1);
    const calendarPeriods =
      parsed.freq === RRule.DAILY
        ? Math.ceil(elapsedDays / interval)
        : parsed.freq === RRule.WEEKLY
          ? Math.ceil(elapsedDays / (7 * interval))
          : parsed.freq === RRule.MONTHLY
            ? Math.ceil(elapsedDays / (28 * interval))
            : Math.ceil(elapsedDays / (365 * interval));
    const listSize = (key: string): number | null => {
      const value = valuesByKey.get(key);
      return value === undefined ? null : value.split(",").length;
    };
    const byDayValues = valuesByKey.get("BYDAY")?.split(",") ?? [];
    const byDayMaximum = (nonOrdinalMaximum: number): number | null =>
      byDayValues.length === 0
        ? null
        : byDayValues.reduce(
            (total, value) =>
              total + (/^[+-]?\d/.test(value) ? 1 : nonOrdinalMaximum),
            0
          );
    const bySetPositionCount = listSize("BYSETPOS");
    let maximumDatesPerPeriod: number;
    if (parsed.freq === RRule.DAILY) {
      maximumDatesPerPeriod = 1;
    } else if (parsed.freq === RRule.WEEKLY) {
      maximumDatesPerPeriod = byDayMaximum(1) ?? 7;
    } else if (parsed.freq === RRule.MONTHLY) {
      maximumDatesPerPeriod = listSize("BYMONTHDAY") ?? byDayMaximum(5) ?? 1;
    } else if (listSize("BYYEARDAY") !== null) {
      maximumDatesPerPeriod = listSize("BYYEARDAY")!;
    } else if (listSize("BYWEEKNO") !== null) {
      maximumDatesPerPeriod = listSize("BYWEEKNO")! * (byDayMaximum(1) ?? 7);
    } else if (listSize("BYEASTER") !== null) {
      maximumDatesPerPeriod = 1;
    } else {
      const monthCount = listSize("BYMONTH") ?? 12;
      maximumDatesPerPeriod =
        listSize("BYMONTHDAY") !== null
          ? monthCount * listSize("BYMONTHDAY")!
          : byDayMaximum(5) !== null
            ? monthCount * byDayMaximum(5)!
            : listSize("BYMONTH") !== null
              ? monthCount
              : 1;
    }
    if (bySetPositionCount !== null) {
      maximumDatesPerPeriod = Math.min(
        maximumDatesPerPeriod,
        bySetPositionCount
      );
    }
    const maximumPriorOccurrences =
      calendarPeriods * maximumDatesPerPeriod * timeMultiplicity;
    if (count > maximumPriorOccurrences + MAX_VALIDATION_OCCURRENCES) {
      return new RRule({ ...parsed, count: undefined, dtstart: shiftedStart });
    }
    const boundedOccurrenceWork = Math.min(
      count,
      maximumPriorOccurrences + MAX_VALIDATION_OCCURRENCES
    );
    if (boundedOccurrenceWork > MAX_DIRECT_RRULE_OCCURRENCE_WORK) {
      return null;
    }
    return new RRule({ ...parsed, dtstart: originalStart });
  } catch {
    return null;
  }
}

function inRecurrenceBounds(account: RecurrenceCarrier, date: string): boolean {
  return (
    date >= account.recurrence.start_anchor &&
    (account.recurrence.end_anchor === null ||
      date <= account.recurrence.end_anchor)
  );
}

function recurrenceDates(
  account: RecurrenceCarrier,
  month: string
): { dates: string[] } | null {
  try {
    const validationStartDate = addDays(`${month}-01`, -31);
    const rule = boundedRule(account, validationStartDate);
    if (!rule) return null;
    const endMonth = nextMonth(month);
    const validationEndDate = addDays(`${endMonth}-01`, 31);
    const validationDates = rule
      .between(
        new Date(`${validationStartDate}T00:00:00.000Z`),
        new Date(`${validationEndDate}T00:00:00.000Z`),
        true,
        (_date, length) => length < MAX_VALIDATION_OCCURRENCES + 1
      )
      .map((date) => date.toISOString().slice(0, 10))
      .filter((date) => inRecurrenceBounds(account, date));
    if (validationDates.length > MAX_VALIDATION_OCCURRENCES) return null;
    const dates = validationDates.filter((date) =>
      date.startsWith(`${month}-`)
    );
    if (dates.length > MAX_MONTH_OCCURRENCES) return null;
    const validationDateSet = new Set(validationDates);
    for (const exception of account.recurrence.exceptions) {
      const exceptionRule = validationDateSet.has(exception.original_date)
        ? rule
        : boundedRule(account, exception.original_date);
      const originalMatchesRule =
        exceptionRule !== null &&
        exceptionRule
          .between(
            new Date(`${exception.original_date}T00:00:00.000Z`),
            new Date(`${exception.original_date}T00:00:00.000Z`),
            true,
            (_date, length) => length < 2
          )
          .some(
            (date) =>
              date.toISOString().slice(0, 10) === exception.original_date
          );
      if (
        !inRecurrenceBounds(account, exception.original_date) ||
        !originalMatchesRule
      ) {
        return null;
      }
    }
    const byOriginal = new Map(
      account.recurrence.exceptions.map((exception) => [
        exception.original_date,
        exception,
      ])
    );
    const resolved = dates.flatMap((date) => {
      const exception = byOriginal.get(date);
      if (!exception) return [date];
      if (exception.action === "skip") return [];
      return exception.new_date?.startsWith(`${month}-`)
        ? [exception.new_date]
        : [];
    });
    for (const exception of account.recurrence.exceptions) {
      if (
        exception.action === "reschedule" &&
        exception.new_date?.startsWith(`${month}-`) &&
        !dates.includes(exception.original_date)
      ) {
        resolved.push(exception.new_date);
      }
    }
    if (new Set(resolved).size !== resolved.length) return null;
    return { dates: resolved.sort() };
  } catch {
    return null;
  }
}

function recurrenceProvablyEndedBeforeMonth(
  account: RecurrenceCarrier,
  month: string,
  workBudget: { remaining: number }
): boolean | "work_exceeded" {
  if (
    account.recurrence.exceptions.length >
      RECURRING_SERVICE_PRICE_CHANGE_MAX_EXCEPTIONS ||
    account.recurrence.exceptions.length > 0
  ) {
    return false;
  }
  try {
    const monthStart = `${month}-01`;
    const parsedSource = parseRruleSource(account.recurrence.rrule);
    if (!parsedSource) return false;
    const { parsed, valuesByKey } = parsedSource;
    if (valuesByKey.has("UNTIL")) {
      if (account.recurrence.end_anchor !== null) return false;
      return (
        parsed.until instanceof Date &&
        parsed.until.toISOString().slice(0, 10) < monthStart
      );
    }
    const count = parsed.count ?? null;
    if (count === null) return false;
    const simpleCountRule = [...valuesByKey.keys()].every((key) =>
      ["FREQ", "INTERVAL", "COUNT", "WKST"].includes(key)
    );
    const originalStart = new Date(
      `${account.recurrence.start_anchor}T00:00:00.000Z`
    );
    if (count === 1 && simpleCountRule) {
      return account.recurrence.start_anchor < monthStart;
    }
    const interval = parsed.interval ?? 1;
    if (
      simpleCountRule &&
      (parsed.freq === RRule.DAILY || parsed.freq === RRule.WEEKLY)
    ) {
      const stepDays = interval * (parsed.freq === RRule.WEEKLY ? 7 : 1);
      const lastOccurrence = new Date(
        originalStart.getTime() + (count - 1) * stepDays * DAY_MILLISECONDS
      );
      return lastOccurrence.toISOString().slice(0, 10) < monthStart;
    }

    const [startYear, startMonth] = account.recurrence.start_anchor
      .split("-")
      .map(Number) as [number, number];
    const [targetYear, targetMonth] = monthStart.split("-").map(Number) as [
      number,
      number,
    ];
    const elapsedDays = Math.max(
      0,
      Math.ceil(
        (Date.parse(`${monthStart}T00:00:00.000Z`) - originalStart.getTime()) /
          DAY_MILLISECONDS
      )
    );
    const periods =
      parsed.freq === RRule.DAILY
        ? Math.ceil(elapsedDays / interval)
        : parsed.freq === RRule.WEEKLY
          ? Math.ceil(elapsedDays / (7 * interval))
          : parsed.freq === RRule.MONTHLY
            ? Math.ceil(
                ((targetYear - startYear) * 12 + targetMonth - startMonth) /
                  interval
              )
            : Math.ceil((targetYear - startYear) / interval);
    const listSize = (key: string): number | null =>
      valuesByKey.get(key)?.split(",").length ?? null;
    const byDay = valuesByKey.get("BYDAY")?.split(",") ?? [];
    const byDayMaximum = (nonOrdinalMaximum: number): number | null =>
      byDay.length === 0
        ? null
        : byDay.reduce(
            (total, value) =>
              total + (/^[+-]?\d/.test(value) ? 1 : nonOrdinalMaximum),
            0
          );
    let maximumDatesPerPeriod = 1;
    if (parsed.freq === RRule.WEEKLY) {
      maximumDatesPerPeriod = byDayMaximum(1) ?? 1;
    } else if (parsed.freq === RRule.MONTHLY) {
      maximumDatesPerPeriod = listSize("BYMONTHDAY") ?? byDayMaximum(5) ?? 1;
    } else if (parsed.freq === RRule.YEARLY) {
      if (listSize("BYYEARDAY") !== null) {
        maximumDatesPerPeriod = listSize("BYYEARDAY")!;
      } else if (listSize("BYWEEKNO") !== null) {
        maximumDatesPerPeriod = listSize("BYWEEKNO")! * (byDayMaximum(1) ?? 7);
      } else if (listSize("BYEASTER") !== null) {
        maximumDatesPerPeriod = listSize("BYEASTER")!;
      } else {
        const monthCount = listSize("BYMONTH") ?? 12;
        maximumDatesPerPeriod =
          listSize("BYMONTHDAY") !== null
            ? monthCount * listSize("BYMONTHDAY")!
            : byDayMaximum(5) !== null
              ? monthCount * byDayMaximum(5)!
              : listSize("BYMONTH") !== null
                ? monthCount
                : 1;
      }
    }
    if (listSize("BYSETPOS") !== null) {
      maximumDatesPerPeriod = Math.min(
        maximumDatesPerPeriod,
        listSize("BYSETPOS")!
      );
    }
    const timeMultiplicity =
      (listSize("BYHOUR") ?? 1) *
      (listSize("BYMINUTE") ?? 1) *
      (listSize("BYSECOND") ?? 1);
    const estimatedWork =
      (Math.max(0, periods) + 1) * maximumDatesPerPeriod * timeMultiplicity;
    if (
      !Number.isSafeInteger(estimatedWork) ||
      estimatedWork > workBudget.remaining
    ) {
      return "work_exceeded";
    }
    workBudget.remaining -= estimatedWork;
    const rule = new RRule({ ...parsed, dtstart: originalStart });
    const prior = rule.between(
      originalStart,
      new Date(Date.parse(`${monthStart}T00:00:00.000Z`) - 1),
      true,
      (_date, length) => length < count + 1
    );
    return prior.length === count;
  } catch {
    return false;
  }
}

function selectRecurringServicePriceChangeRecurrenceIdsWithBudget(
  catalog: RecurringServicePriceChangeRecurrenceCatalog,
  requestId: string,
  workBudget: { remaining: number }
): string[] {
  if (catalog.overflow) {
    throw new RecurringServicePriceChangePrepareError({
      code: "RESULT_TOO_LARGE",
      requestId,
    });
  }
  const selected: typeof catalog.recurrences = [];
  for (const entry of catalog.recurrences) {
    const ended = recurrenceProvablyEndedBeforeMonth(
      entry,
      catalog.request.effective_month,
      workBudget
    );
    if (ended === "work_exceeded") {
      throw new RecurringServicePriceChangePrepareError({
        code: "RESULT_TOO_LARGE",
        requestId,
      });
    }
    if (!ended) selected.push(entry);
  }
  if (new Set(selected.map((entry) => entry.client_id)).size > 100) {
    throw new RecurringServicePriceChangePrepareError({
      code: "RESULT_TOO_LARGE",
      requestId,
    });
  }
  return selected
    .map((entry) => entry.recurrence.recurrence_id)
    .sort(compareUtf8);
}

export function selectRecurringServicePriceChangeRecurrenceIds(
  catalog: RecurringServicePriceChangeRecurrenceCatalog,
  requestId: string
): string[] {
  return selectRecurringServicePriceChangeRecurrenceIdsWithBudget(
    catalog,
    requestId,
    { remaining: MAX_CATALOG_CLASSIFICATION_WORK }
  );
}

function detailMatchesCatalogSelection(input: {
  catalog: RecurringServicePriceChangeRecurrenceCatalog;
  snapshot: RecurringServicePriceChangeSourceSnapshot;
  selectedRecurrenceIds: readonly string[];
}): boolean {
  const { catalog, snapshot, selectedRecurrenceIds } = input;
  if (
    canonicalHash(snapshot.request) !== canonicalHash(catalog.request) ||
    canonicalHash(snapshot.context) !== canonicalHash(catalog.context) ||
    canonicalHash(snapshot.service_resolution) !==
      canonicalHash(catalog.service_resolution) ||
    snapshot.observed_at !== catalog.observed_at ||
    snapshot.business_date !== catalog.business_date
  ) {
    return false;
  }
  const selectedSet = new Set(selectedRecurrenceIds);
  const byClient = new Map<
    string,
    RecurringServicePriceChangeRecurrenceCatalog["recurrences"]
  >();
  for (const entry of catalog.recurrences) {
    if (!selectedSet.has(entry.recurrence.recurrence_id)) continue;
    const existing = byClient.get(entry.client_id) ?? [];
    existing.push(entry);
    byClient.set(entry.client_id, existing);
  }
  if (
    [...byClient.values()].reduce(
      (count, entries) => count + entries.length,
      0
    ) !== selectedRecurrenceIds.length ||
    snapshot.accounts.length !== byClient.size
  ) {
    return false;
  }
  for (const account of snapshot.accounts) {
    const entries = [...(byClient.get(account.client_id) ?? [])].sort(
      (left, right) =>
        compareUtf8(
          left.recurrence.recurrence_id,
          right.recurrence.recurrence_id
        )
    );
    const canonical = entries[0];
    const additional = entries[1];
    if (
      canonical === undefined ||
      account.recurrence.recurrence_id !== canonical.recurrence.recurrence_id ||
      account.recurrence.source_sha256 !== canonical.recurrence.source_sha256 ||
      account.recurrence_match_count !== Math.min(entries.length, 2) ||
      account.additional_recurrence_sources.length !==
        (additional === undefined ? 0 : 1) ||
      (additional !== undefined &&
        (account.additional_recurrence_sources[0]?.recurrence_id !==
          additional.recurrence.recurrence_id ||
          account.additional_recurrence_sources[0]?.source_sha256 !==
            additional.recurrence.source_sha256))
    ) {
      return false;
    }
  }
  return true;
}

function currencyMinorExponent(currency: string): number | null {
  if (!Object.hasOwn(ISO_4217_MINOR_EXPONENTS_2026_01_01, currency)) {
    return null;
  }
  return ISO_4217_MINOR_EXPONENTS_2026_01_01[
    currency as keyof typeof ISO_4217_MINOR_EXPONENTS_2026_01_01
  ];
}

function decimalParts(
  value: string
): { negative: boolean; whole: string; fraction: string } | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  return match
    ? { negative: match[1] === "-", whole: match[2]!, fraction: match[3] ?? "" }
    : null;
}

function exactMinor(value: string, exponent: number): bigint | null {
  const parts = decimalParts(value);
  if (!parts) return null;
  const retained = parts.fraction.slice(0, exponent).padEnd(exponent, "0");
  if (/[1-9]/.test(parts.fraction.slice(exponent))) return null;
  const magnitude =
    BigInt(parts.whole) * BigInt(10) ** BigInt(exponent) +
    BigInt(retained || "0");
  return parts.negative ? -magnitude : magnitude;
}

function scaledPercent(value: string): bigint | null {
  const parts = decimalParts(value);
  if (!parts || parts.negative) return null;
  const fraction = parts.fraction.replace(/0+$/, "");
  if (fraction.length > 4) return null;
  return BigInt(parts.whole) * PERCENT_SCALE + BigInt(fraction.padEnd(4, "0"));
}

function divideHalfAwayFromZero(
  numerator: bigint,
  denominator: bigint
): bigint {
  const negative = numerator < BigInt(0);
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded =
    remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
  return negative ? -rounded : rounded;
}

function safeNumber(value: bigint): number | null {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return Number(value);
}

function money(minor: number, currency: string, exponent: number): string {
  const digits = String(minor).padStart(exponent + 1, "0");
  if (exponent === 0) return `${currency} ${digits}`;
  return `${currency} ${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

function humanDate(date: string): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ] as const;
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return `${months[month - 1]} ${day}, ${year}`;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const codePoint of value) {
    const nextBytes = Buffer.byteLength(codePoint, "utf8");
    if (bytes + nextBytes > maximumBytes) break;
    result += codePoint;
    bytes += nextBytes;
  }
  return result;
}

function sourceRefs(account: SourceAccount): SupportingRecord[] {
  const records: SupportingRecord[] = [
    {
      source_ref: `recurrence:${account.recurrence.recurrence_id}`,
      source_sha256: account.recurrence.source_sha256,
      kind: "recurrence",
    },
  ];
  for (const recurrence of account.additional_recurrence_sources) {
    records.push({
      source_ref: `recurrence:${recurrence.recurrence_id}`,
      source_sha256: recurrence.source_sha256,
      kind: "recurrence",
    });
  }
  if (account.policy) {
    records.push({
      source_ref: account.policy.policy_source_ref,
      source_sha256: account.policy.policy_source_sha256,
      kind: "policy",
    });
  }
  if (account.pricing) {
    records.push({
      source_ref: `${account.pricing.document_kind}:${account.pricing.document_id}:line_item:${account.pricing.line_item_id}`,
      source_sha256: account.pricing.source_sha256,
      kind: "price_source",
    });
    if (account.pricing.tax_rate_id) {
      records.push({
        source_ref: `tax_rate:${account.pricing.tax_rate_id}`,
        source_sha256: account.pricing.tax_rate_source_sha256!,
        kind: "tax_rate",
      });
    }
  }
  if (account.contact) {
    records.push({
      source_ref: `contact_identity:${account.contact.contact_kind}:${account.contact.contact_id}`,
      source_sha256: account.contact.source_sha256,
      kind: "contact_identity",
    });
  }
  if (
    account.correspondence.latest_outbound_source_ref &&
    account.correspondence.latest_outbound_source_sha256
  ) {
    records.push({
      source_ref: account.correspondence.latest_outbound_source_ref,
      source_sha256: account.correspondence.latest_outbound_source_sha256,
      kind: "provider_delivery",
    });
  }
  for (const signal of account.correspondence.risk_signals) {
    records.push({
      source_ref: signal.source_ref,
      source_sha256: signal.source_sha256,
      kind: "provider_delivery",
    });
  }
  for (const late of account.late_payment_evidence) {
    records.push({
      source_ref: late.source_ref,
      source_sha256: late.source_sha256,
      kind: "invoice",
    });
  }
  return records;
}

function uniqueRecords(
  records: readonly SupportingRecord[]
): SupportingRecord[] {
  const byKey = new Map<string, SupportingRecord>();
  for (const record of records) {
    byKey.set(`${record.source_ref}:${record.source_sha256}`, record);
  }
  return [...byKey.values()].sort((left, right) =>
    compareUtf8(left.source_ref, right.source_ref)
  );
}

function risk(
  account: SourceAccount,
  observedAt: string
): Preview["churn_risk"] {
  const coverage = {
    correspondence_window: {
      start: new Date(
        Date.parse(observedAt) -
          account.correspondence.lookback_days * DAY_MILLISECONDS
      ).toISOString(),
      end: observedAt,
    },
  } as const;
  if (account.correspondence.unreadable_count > 0) {
    return {
      ...coverage,
      level: "unknown",
      confidence: "unknown",
      correspondence_evidence_complete_within_window: false,
      signal_codes: ["unreadable_correspondence"],
      evidence: [],
      explanation:
        "Risk is unknown because provider correspondence coverage is incomplete.",
    };
  }
  const codes = [
    ...new Set(account.correspondence.risk_signals.map((item) => item.code)),
  ].sort();
  if (
    codes.includes("explicit_cancellation") ||
    codes.includes("price_objection")
  ) {
    const evidence = account.correspondence.risk_signals
      .filter(
        (signal) =>
          signal.code === "explicit_cancellation" ||
          signal.code === "price_objection"
      )
      .map((signal) => ({ ...signal }))
      .sort((left, right) =>
        compareUtf8(
          `${left.code}:${left.source_ref}`,
          `${right.code}:${right.source_ref}`
        )
      );
    return {
      ...coverage,
      level: "high",
      confidence: "high",
      correspondence_evidence_complete_within_window: true,
      signal_codes: [...new Set(evidence.map((record) => record.code))].sort(),
      evidence,
      explanation:
        "High risk is based on explicit customer cancellation or price-objection evidence.",
    };
  }
  if (
    codes.includes("service_complaint") ||
    codes.includes("overcharge_complaint") ||
    account.late_payment_evidence.length > 0
  ) {
    const evidence: Preview["churn_risk"]["evidence"] = [
      ...account.correspondence.risk_signals
        .filter(
          (signal) =>
            signal.code === "service_complaint" ||
            signal.code === "overcharge_complaint"
        )
        .map((signal) => ({ ...signal })),
      ...account.late_payment_evidence.map((record) => ({
        code: "late_payment" as const,
        ...record,
      })),
    ].sort((left, right) =>
      compareUtf8(
        `${left.code}:${left.source_ref}`,
        `${right.code}:${right.source_ref}`
      )
    );
    return {
      ...coverage,
      level: "medium",
      confidence: "medium",
      correspondence_evidence_complete_within_window: true,
      signal_codes: [...new Set(evidence.map((record) => record.code))].sort(),
      evidence,
      explanation:
        "Medium risk is based on customer complaint, overcharge, or late-payment evidence.",
    };
  }
  return {
    ...coverage,
    level: "unknown",
    confidence: "unknown",
    correspondence_evidence_complete_within_window: true,
    signal_codes: ["insufficient_history"],
    evidence: [],
    explanation:
      "Risk is unknown because the readable account history is insufficient.",
  };
}

function evaluateAccount(input: {
  account: SourceAccount;
  source: RecurringServicePriceChangeSourceSnapshot;
  increasePercent: bigint;
}): { preview?: Preview; exclusion?: Exclusion; records: SupportingRecord[] } {
  const { account, source, increasePercent } = input;
  const reasons = new Set<RecurringServicePriceChangeExclusionReason>();
  const records = sourceRefs(account);
  const policy = account.policy;
  const pricing = account.pricing;
  const contact = account.contact;
  if (!policy) reasons.add("terms_unavailable");
  if (
    policy &&
    (!policy.adjustment_allowed ||
      scaledPercent(policy.authorized_increase_percent) !== increasePercent ||
      policy.authorized_effective_month !== source.request.effective_month)
  )
    reasons.add("adjustment_not_allowed");
  if (!pricing) reasons.add("pricing_unavailable");
  if (
    policy &&
    pricing &&
    (policy.price_source_line_item_id !== pricing.line_item_id ||
      policy.price_source_sha256 !== pricing.source_sha256)
  ) {
    reasons.add("pricing_source_stale");
  }
  if (
    pricing &&
    !(
      (pricing.document_kind === "estimate" &&
        ["approved", "converted"].includes(pricing.document_status)) ||
      (pricing.document_kind === "invoice" &&
        [
          "sent",
          "awaiting_payment",
          "partially_paid",
          "paid",
          "past_due",
        ].includes(pricing.document_status))
    )
  ) {
    reasons.add("pricing_unavailable");
  }
  if (!contact) reasons.add("contact_unavailable");
  if (
    policy &&
    contact &&
    (policy.notice_contact_kind !== contact.contact_kind ||
      policy.notice_contact_id !== contact.contact_id)
  ) {
    reasons.add("contact_unavailable");
  }
  if (contact && contact.active_identity_count !== 1) {
    reasons.add("contact_ambiguous");
  }
  if (
    account.correspondence.overflow ||
    account.correspondence.oversized_text_count > 0 ||
    account.correspondence.unreadable_count > 0 ||
    account.correspondence.latest_outbound_source_ref === null ||
    account.correspondence.latest_outbound_source_sha256 === null
  ) {
    reasons.add("correspondence_unavailable");
  }

  const recurrence = recurrenceDates(account, source.request.effective_month);
  if (recurrence === null) reasons.add("recurrence_unavailable");
  if (recurrence?.dates.length === 0) reasons.add("no_occurrence_in_month");
  const effectiveDate = recurrence?.dates[0] ?? null;
  if (
    policy &&
    effectiveDate &&
    (policy.effective_from > effectiveDate ||
      (policy.effective_to !== null && policy.effective_to < effectiveDate))
  ) {
    reasons.add("terms_unavailable");
  }
  if (
    policy &&
    effectiveDate &&
    policy.grandfathered_until !== null &&
    policy.grandfathered_until >= effectiveDate
  ) {
    reasons.add("grandfathered");
  }
  const latestNoticeDate =
    policy && effectiveDate
      ? addDays(effectiveDate, -policy.notice_period_days)
      : null;
  if (latestNoticeDate !== null && source.business_date > latestNoticeDate) {
    reasons.add("notice_period_not_met");
  }

  const exponent = currencyMinorExponent(source.context.currency_code);
  if (exponent === null) reasons.add("currency_unsupported");
  const currentMinorExact =
    pricing && exponent !== null
      ? exactMinor(pricing.unit_price, exponent)
      : null;
  if (currentMinorExact === null || currentMinorExact <= BigInt(0)) {
    reasons.add("pricing_unavailable");
  }
  if (
    pricing &&
    (scaledPercent(pricing.quantity) !== PERCENT_SCALE ||
      scaledPercent(pricing.discount_percent) !== BigInt(0) ||
      pricing.unit_label === null ||
      (pricing.minimum_charge !== null &&
        scaledPercent(pricing.minimum_charge) !== BigInt(0)))
  ) {
    reasons.add("pricing_terms_complex");
  }
  let proposedMinorExact: bigint | null = null;
  if (currentMinorExact !== null) {
    proposedMinorExact = divideHalfAwayFromZero(
      currentMinorExact * (ONE_HUNDRED_PERCENT_SCALED + increasePercent),
      ONE_HUNDRED_PERCENT_SCALED
    );
    if (proposedMinorExact <= currentMinorExact) {
      reasons.add("increase_below_currency_precision");
    }
  }
  const currentMinor =
    currentMinorExact === null ? null : safeNumber(currentMinorExact);
  const proposedMinor =
    proposedMinorExact === null ? null : safeNumber(proposedMinorExact);
  if (currentMinor === null || proposedMinor === null)
    reasons.add("pricing_unavailable");

  let proposedTax = BigInt(0);
  if (pricing?.is_taxable) {
    if (
      pricing.tax_rate_id === null ||
      pricing.tax_rate_name === null ||
      pricing.tax_rate_percent === null
    ) {
      reasons.add("tax_unavailable");
    } else {
      const taxPercent = scaledPercent(pricing.tax_rate_percent);
      if (
        taxPercent === null ||
        taxPercent > ONE_HUNDRED_PERCENT_SCALED ||
        proposedMinorExact === null
      ) {
        reasons.add("tax_unavailable");
      } else {
        proposedTax = divideHalfAwayFromZero(
          proposedMinorExact * taxPercent,
          ONE_HUNDRED_PERCENT_SCALED
        );
      }
    }
  } else if (
    pricing &&
    (pricing.tax_rate_id !== null ||
      pricing.tax_rate_name !== null ||
      pricing.tax_rate_percent !== null)
  ) {
    reasons.add("tax_unavailable");
  }
  const proposedTaxMinor = safeNumber(proposedTax);
  const proposedTotalMinor =
    proposedMinorExact === null
      ? null
      : safeNumber(proposedMinorExact + proposedTax);
  if (proposedTaxMinor === null || proposedTotalMinor === null) {
    reasons.add("tax_unavailable");
  }

  const reasonCodes = [...reasons].sort();
  if (
    reasonCodes.length > 0 ||
    !policy ||
    !pricing ||
    pricing.unit_label === null ||
    !contact ||
    !effectiveDate ||
    latestNoticeDate === null ||
    exponent === null ||
    currentMinor === null ||
    proposedMinor === null ||
    proposedTaxMinor === null ||
    proposedTotalMinor === null
  ) {
    return {
      exclusion: {
        client_id: account.client_id,
        client_name: account.client_name,
        service_name: account.service_name,
        reason_codes:
          reasonCodes.length > 0 ? reasonCodes : ["pricing_unavailable"],
        supporting_record_refs: records
          .map((record) => record.source_ref)
          .slice(0, 20),
      },
      records,
    };
  }

  const taxPhrase = pricing.is_taxable
    ? `, plus ${pricing.tax_rate_name} at ${pricing.tax_rate_percent}%`
    : ", with no tax applied";
  const unitPhrase = ` per ${pricing.unit_label}`;
  const subjectSuffix = " rate update";
  const draft = {
    formatter_revision:
      RECURRING_SERVICE_PRICE_CHANGE_NOTICE_FORMATTER_REVISION,
    subject: `${truncateUtf8(
      account.service_name,
      200 - Buffer.byteLength(subjectSuffix, "utf8")
    )}${subjectSuffix}`,
    body:
      `Hi ${contact.display_name},\n\n` +
      `Starting ${humanDate(effectiveDate)}, the ${account.service_name} rate will change from ${money(currentMinor, source.context.currency_code, exponent)} to ${money(proposedMinor, source.context.currency_code, exponent)}${unitPhrase}${taxPhrase}.\n\n` +
      `Your service schedule stays the same.\n\n` +
      `${source.context.company_name}`,
    send_state: "not_sent" as const,
  };
  const previewIdentity = {
    schema_revision: RECURRING_SERVICE_PRICE_CHANGE_SCHEMA_REVISION,
    company_id: source.context.company_id,
    company_name: source.context.company_name,
    currency_code: source.context.currency_code,
    currency_minor_exponent: exponent,
    business_date: source.business_date,
    client_id: account.client_id,
    task_type_id: account.task_type_id,
    recurrence_id: account.recurrence.recurrence_id,
    policy_id: policy.policy_id,
    price_source_sha256: pricing.source_sha256,
    source_revision: account.source_revision,
    increase_percent: source.request.increase_percent,
    effective_date: effectiveDate,
    recipient: contact.normalized_email,
  };
  const preview: Preview = {
    preview_id: canonicalHash(previewIdentity),
    client_id: account.client_id,
    client_name: account.client_name,
    service_name: account.service_name,
    task_type_id: account.task_type_id,
    recurrence_id: account.recurrence.recurrence_id,
    contact: {
      kind: contact.contact_kind,
      id: contact.contact_id,
      display_name: contact.display_name,
      channel: "email",
      address: contact.normalized_email,
    },
    pricing: {
      currency_code: source.context.currency_code,
      currency_minor_exponent: exponent,
      current_unit_minor: currentMinor,
      proposed_unit_minor: proposedMinor,
      increase_percent: source.request.increase_percent,
      rounding_rule: "half_away_from_zero_at_currency_minor_unit",
      unit_label: pricing.unit_label,
      tax: {
        taxable: pricing.is_taxable,
        rate_name: pricing.tax_rate_name,
        rate_percent: pricing.tax_rate_percent,
        proposed_unit_tax_minor: proposedTaxMinor,
        proposed_unit_total_minor: proposedTotalMinor,
      },
    },
    schedule: {
      recurrence_rule: account.recurrence.rrule,
      effective_date: effectiveDate,
      requested_month: source.request.effective_month,
    },
    notice_rule: {
      notice_period_days: policy.notice_period_days,
      latest_notice_date: latestNoticeDate,
      evaluation_date: source.business_date,
      satisfied: true,
      grandfathered_until: policy.grandfathered_until,
    },
    draft,
    churn_risk: risk(account, source.observed_at),
    supporting_record_refs: records
      .map((record) => record.source_ref)
      .slice(0, 20),
  };
  return { preview, records };
}

export class RecurringServicePriceChangePrepareError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_ARGUMENT"
    | "RESULT_TOO_LARGE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: RecurringServicePriceChangePrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "The recurring-service price preview could not be prepared.",
      INVALID_ARGUMENT:
        "Enter one service, a valid percentage, and an effective month.",
      RESULT_TOO_LARGE: "The preview exceeds a safe processing limit.",
      STALE_CONTEXT:
        "The recurring-service source changed. Prepare the preview again.",
      TEMPORARILY_UNAVAILABLE:
        "The recurring-service price preview is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "RecurringServicePriceChangePrepareError";
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
              path: [],
              code: "PRICE_PREVIEW_INPUT_INVALID",
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

export function calculateRecurringServicePriceChange(
  source: RecurringServicePriceChangeSourceSnapshot,
  rawInput: PrepareRecurringServicePriceChangeInput,
  requestId: string
): RecurringServicePriceChangeResult {
  const input = PrepareRecurringServicePriceChangeInputSchema.parse(rawInput);
  if (
    source.request.service_selector !== input.service_selector ||
    source.request.increase_percent !== input.increase_percent ||
    source.request.effective_month !== input.effective_month
  ) {
    throw new RecurringServicePriceChangePrepareError({
      code: "STALE_CONTEXT",
      requestId,
    });
  }
  if (
    source.overflow ||
    source.accounts.length > RECURRING_SERVICE_PRICE_CHANGE_MAX_ACCOUNTS ||
    source.accounts.some(
      (account) =>
        account.recurrence.exceptions.length >
        RECURRING_SERVICE_PRICE_CHANGE_MAX_EXCEPTIONS
    )
  ) {
    throw new RecurringServicePriceChangePrepareError({
      code: "RESULT_TOO_LARGE",
      requestId,
    });
  }
  if (
    source.service_resolution.state !== "exact" &&
    source.accounts.length > 0
  ) {
    throw new RecurringServicePriceChangePrepareError({
      code: "STALE_CONTEXT",
      requestId,
    });
  }
  const increasePercent = scaledPercent(input.increase_percent);
  if (increasePercent === null) {
    throw new RecurringServicePriceChangePrepareError({
      code: "INVALID_ARGUMENT",
      requestId,
    });
  }
  const ordered = [...source.accounts].sort((left, right) =>
    compareUtf8(
      `${left.client_id}:${left.recurrence.recurrence_id}`,
      `${right.client_id}:${right.recurrence.recurrence_id}`
    )
  );
  const previews: Preview[] = [];
  const exclusions: Exclusion[] = [];
  const supporting: SupportingRecord[] = [];
  for (const account of ordered) {
    if (account.recurrence_match_count !== 1) {
      const records = sourceRefs(account);
      exclusions.push({
        client_id: account.client_id,
        client_name: account.client_name,
        service_name: account.service_name,
        reason_codes: ["duplicate_account_service"],
        supporting_record_refs: records
          .map((record) => record.source_ref)
          .slice(0, 20),
      });
      supporting.push(...records);
      continue;
    }
    const evaluated = evaluateAccount({ account, source, increasePercent });
    if (evaluated.preview) previews.push(evaluated.preview);
    if (evaluated.exclusion) exclusions.push(evaluated.exclusion);
    supporting.push(...evaluated.records);
  }
  const identityByRef = new Map<
    string,
    Pick<SupportingRecord, "source_sha256" | "kind">
  >();
  for (const record of supporting) {
    const prior = identityByRef.get(record.source_ref);
    if (
      prior !== undefined &&
      (prior.source_sha256 !== record.source_sha256 ||
        prior.kind !== record.kind)
    ) {
      throw new RecurringServicePriceChangePrepareError({
        code: "STALE_CONTEXT",
        requestId,
      });
    }
    identityByRef.set(record.source_ref, {
      source_sha256: record.source_sha256,
      kind: record.kind,
    });
  }
  const records = uniqueRecords(supporting);
  if (records.length > RECURRING_SERVICE_PRICE_CHANGE_MAX_EVIDENCE_REFS) {
    throw new RecurringServicePriceChangePrepareError({
      code: "RESULT_TOO_LARGE",
      requestId,
    });
  }
  const selectionState = source.service_resolution.state;
  const specialReasons =
    selectionState === "not_found"
      ? ["service_not_found" as const]
      : selectionState === "ambiguous"
        ? ["service_ambiguous" as const]
        : ordered.length === 0
          ? ["no_recurring_accounts" as const]
          : [];
  const reasons = [
    ...new Set([
      ...specialReasons,
      ...exclusions.flatMap((exclusion) => exclusion.reason_codes),
    ]),
  ].sort();
  const status =
    previews.length > 0 && exclusions.length === 0
      ? "ready"
      : previews.length > 0
        ? "partial"
        : "blocked";
  const completenessState =
    status === "ready"
      ? "complete"
      : status === "partial"
        ? "partial"
        : "unavailable";
  const expiresAt = new Date(
    Date.parse(source.observed_at) + DAY_MILLISECONDS
  ).toISOString();
  const previewsForIdentity = previews.map(
    ({ churn_risk: churnRisk, ...preview }) => ({
      ...preview,
      churn_risk: {
        ...churnRisk,
        correspondence_window: {
          lookback_days: 365,
        },
      },
    })
  );
  const planIdentity = {
    schema_revision: RECURRING_SERVICE_PRICE_CHANGE_SCHEMA_REVISION,
    company_id: source.context.company_id,
    business_date: source.business_date,
    request: source.request,
    selection: source.service_resolution,
    evaluated_source_revisions: ordered.map((account) => ({
      client_id: account.client_id,
      task_type_id: account.task_type_id,
      recurrence_id: account.recurrence.recurrence_id,
      source_revision: account.source_revision,
    })),
    previews: previewsForIdentity,
    exclusions,
    supporting_records: records,
  };
  return RecurringServicePriceChangeResultSchema.parse({
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    schema_revision: RECURRING_SERVICE_PRICE_CHANGE_SCHEMA_REVISION,
    observed_at: source.observed_at,
    expires_at: expiresAt,
    status,
    action: {
      operation: "prepare",
      risk_tier: "high",
      mass_action: true,
      exact_plan_hash_required: true,
    },
    request: source.request,
    selection: {
      state: selectionState,
      service_name: source.service_resolution.service_name,
      task_type_id: source.service_resolution.task_type_id,
      total_accounts: ordered.length,
      included_count: previews.length,
      excluded_count: exclusions.length,
    },
    previews,
    exclusions,
    completeness: {
      state: completenessState,
      total_accounts: ordered.length,
      evaluated_accounts: ordered.length,
      ready_accounts: previews.length,
      blocked_accounts: exclusions.length,
      reasons,
    },
    supporting_records: records,
    plan_hash: canonicalHash(planIdentity),
    safety: {
      ephemeral: true,
      preview_content_stored: false,
      transport_audit_metadata_recorded: true,
      sent: false,
      prices_changed: false,
      contracts_changed: false,
      invoices_changed: false,
      service_changed: false,
      commit_capability_available: false,
    },
    prompt_safety: RECURRING_SERVICE_PRICE_CHANGE_PROMPT_SAFETY_DIRECTIVE,
  });
}

export interface RecurringServicePriceChangeService {
  prepareRecurringServicePriceChange(
    actorContext: ActorContext,
    input: PrepareRecurringServicePriceChangeInput,
    options?: { signal?: AbortSignal }
  ): Promise<RecurringServicePriceChangeResult>;
}

function authorizePricePreview(
  actorContext: ActorContext,
  input: PrepareRecurringServicePriceChangeInput
): void {
  const resolved = resolveRecurringServicePriceChangeCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "recurring_service_price_change_authorization_variant_invalid"
    );
  }
  authorizeCapability({
    actorContext,
    policy: resolved.variants[0]!.policy,
  });
}

export function createRecurringServicePriceChangeService(input: {
  repository: RecurringServicePriceChangeRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): RecurringServicePriceChangeService {
  if (!isTrustedRecurringServicePriceChangeRepository(input.repository)) {
    throw new TypeError(
      "A trusted recurring-service price repository is required"
    );
  }
  if (!input.authorityRepository) {
    throw new TypeError(
      "A recurring-service price authority repository is required"
    );
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ??
    RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Recurring-service price service options are invalid");
  }

  const service: RecurringServicePriceChangeService = {
    async prepareRecurringServicePriceChange(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "recurring_service_price_change_actor_context_untrusted"
        );
      }
      let parsedInput: PrepareRecurringServicePriceChangeInput;
      try {
        parsedInput =
          PrepareRecurringServicePriceChangeInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new RecurringServicePriceChangePrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }
      authorizePricePreview(actorContext, parsedInput);
      const currentActor = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision:
          RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });
      authorizePricePreview(currentActor, parsedInput);

      try {
        const observedAt = now();
        if (Number.isNaN(observedAt.getTime())) {
          throw new Error("Invalid server clock");
        }
        const catalog = await input.repository.readRecurrenceCatalog({
          actorContext: currentActor,
          observedAt: observedAt.toISOString(),
          input: parsedInput,
          signal: options?.signal,
        });
        const classificationWorkBudget = {
          remaining: MAX_CATALOG_CLASSIFICATION_WORK,
        };
        const selectedRecurrenceIds =
          selectRecurringServicePriceChangeRecurrenceIdsWithBudget(
            catalog,
            currentActor.requestId,
            classificationWorkBudget
          );
        const detail = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          observedAt: observedAt.toISOString(),
          input: parsedInput,
          selectedRecurrenceIds,
          signal: options?.signal,
        });
        const currentSelectedRecurrenceIds =
          selectRecurringServicePriceChangeRecurrenceIdsWithBudget(
            detail.catalog,
            currentActor.requestId,
            classificationWorkBudget
          );
        if (
          canonicalHash(catalog) !== canonicalHash(detail.catalog) ||
          canonicalHash(selectedRecurrenceIds) !==
            canonicalHash(currentSelectedRecurrenceIds) ||
          !detailMatchesCatalogSelection({
            catalog: detail.catalog,
            snapshot: detail.snapshot,
            selectedRecurrenceIds,
          })
        ) {
          throw new RecurringServicePriceChangePrepareError({
            code: "STALE_CONTEXT",
            requestId: currentActor.requestId,
          });
        }
        const finalActor = await reauthorizeResolvedMcpActor({
          actorContext: currentActor,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizePricePreview(finalActor, parsedInput);
        const result = calculateRecurringServicePriceChange(
          detail.snapshot,
          parsedInput,
          finalActor.requestId
        );
        if (serializeUntrustedPromptData(result).length > maxOutputCharacters) {
          throw new RecurringServicePriceChangePrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
          });
        }
        await input.repository.assertCurrentAuthority({
          actorContext: finalActor,
          signal: options?.signal,
        });
        return result;
      } catch (error) {
        if (
          error instanceof RecurringServicePriceChangePrepareError ||
          error instanceof ActorAccessError
        ) {
          throw error;
        }
        if (
          error instanceof
            RecurringServicePriceChangeRepositoryAuthorityError ||
          error instanceof RecurringServicePriceChangeRepositoryStaleError
        ) {
          throw new RecurringServicePriceChangePrepareError({
            code: "STALE_CONTEXT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof RecurringServicePriceChangeRepositoryInputError) {
          throw new RecurringServicePriceChangePrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof RecurringServicePriceChangeRepositoryBoundError) {
          throw new RecurringServicePriceChangePrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (
          error instanceof RecurringServicePriceChangeRepositoryUnavailableError
        ) {
          throw new RecurringServicePriceChangePrepareError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new RecurringServicePriceChangePrepareError({
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

export function isTrustedRecurringServicePriceChangeService(
  value: unknown
): value is RecurringServicePriceChangeService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}

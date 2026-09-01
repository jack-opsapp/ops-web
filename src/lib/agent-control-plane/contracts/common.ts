import { z } from "zod-v4";

export const MAX_OPAQUE_ID_LENGTH = 512;
export const DEFAULT_CURSOR_LIMIT = 25;
export const MAX_CURSOR_LIMIT = 50;
export const MAX_SOURCE_VERSIONS = 100;
export const MAX_EVIDENCE_REFS = 100;
export const MAX_AGENT_WARNINGS = 50;

/**
 * ISO 4217 List One current currency and fund codes, frozen for the v1
 * contract from the SIX Maintenance Agency List One published on 2026-01-01
 * and verified on 2026-08-07. Historical codes are deliberately excluded.
 */
export const SUPPORTED_ISO_4217_CURRENCY_CODES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BOV",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SVC",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XCG",
  "XDR",
  "XOF",
  "XPF",
  "XSU",
  "YER",
  "ZAR",
  "ZMW",
  "ZWG",
  "CHE",
  "CHW",
  "CLF",
  "COU",
  "MXV",
  "USN",
  "UYI",
  "UYW",
  "VED",
  "XAD",
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XPD",
  "XPT",
  "XTS",
  "XUA",
  "XXX",
] as const;

export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(MAX_OPAQUE_ID_LENGTH)
  .refine((value) => value.trim().length > 0, "ID cannot be blank");

export const Rfc3339UtcTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith("Z"), "Timestamp must be UTC");

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidLocalDateTime(value: string): boolean {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
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
  ];

  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizedFraction(value: string): string {
  const fraction = /\.(\d+)(?:Z)?$/.exec(value)?.[1]?.replace(/0+$/, "") ?? "";
  return fraction.length > 0 ? `.${fraction}` : "";
}

function localProjection(utc: string, timezone: string): string | null {
  const instant = new Date(utc);
  if (Number.isNaN(instant.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const valueByPart = new Map(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    const year = valueByPart.get("year");
    const month = valueByPart.get("month");
    const day = valueByPart.get("day");
    const hour = valueByPart.get("hour");
    const minute = valueByPart.get("minute");
    const second = valueByPart.get("second");
    if (!year || !month || !day || !hour || !minute || !second) return null;

    return `${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedFraction(
      utc
    )}`;
  } catch {
    return null;
  }
}

export const LocalDateTimeSchema = z
  .string()
  .refine(isValidLocalDateTime, "Invalid local date-time");

export const IanaTimeZoneSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isIanaTimeZone, "Invalid IANA timezone");

export const ScheduleInstantSchema = z
  .object({
    utc: Rfc3339UtcTimestampSchema,
    local: LocalDateTimeSchema,
    timezone: IanaTimeZoneSchema,
  })
  .strict()
  .superRefine((schedule, context) => {
    const expectedLocal = localProjection(schedule.utc, schedule.timezone);
    const normalizedLocal = schedule.local.replace(
      /(?:\.(\d+))?$/,
      (_match, fraction: string | undefined) =>
        fraction ? normalizedFraction(`.${fraction}`) : ""
    );

    if (expectedLocal === null || normalizedLocal !== expectedLocal) {
      context.addIssue({
        code: "custom",
        path: ["local"],
        message: "Local date-time must match the UTC instant in the timezone",
      });
    }
  });

export const CurrencyCodeSchema = z.enum(SUPPORTED_ISO_4217_CURRENCY_CODES);

export const MoneySchema = z
  .object({
    amount_minor: z.number().int().safe(),
    currency: CurrencyCodeSchema,
  })
  .strict();

export const ContractCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const ContractSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_:-]*$/);

export const AgentWarningSchema = z
  .object({
    code: ContractCodeSchema,
    message: z.string().min(1).max(1_000),
  })
  .strict();

export const CursorRequestSchema = z
  .object({
    cursor: OpaqueIdSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_CURSOR_LIMIT)
      .default(DEFAULT_CURSOR_LIMIT),
  })
  .strict();

export const CursorPageSchema = z
  .object({
    next_cursor: OpaqueIdSchema.nullable(),
    has_more: z.boolean(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.has_more === (page.next_cursor === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: page.has_more
          ? "A page with more results requires a continuation cursor"
          : "A terminal page cannot include a continuation cursor",
        path: ["next_cursor"],
      });
    }
  });

export type OpaqueId = z.infer<typeof OpaqueIdSchema>;
export type Rfc3339UtcTimestamp = z.infer<typeof Rfc3339UtcTimestampSchema>;
export type LocalDateTime = z.infer<typeof LocalDateTimeSchema>;
export type IanaTimeZone = z.infer<typeof IanaTimeZoneSchema>;
export type ScheduleInstant = z.infer<typeof ScheduleInstantSchema>;
export type Money = z.infer<typeof MoneySchema>;
export type AgentWarning = z.infer<typeof AgentWarningSchema>;
export type CursorRequest = z.infer<typeof CursorRequestSchema>;
export type CursorPage = z.infer<typeof CursorPageSchema>;

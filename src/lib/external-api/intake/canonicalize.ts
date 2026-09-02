import "server-only";

import { createHash } from "node:crypto";

import type { SubmissionRequest } from "@/lib/external-api/contracts/intake";

import { canonicalizeContactIdentity } from "./contact-identity";

export const CANONICAL_SUBMISSION_VERSION = 1 as const;

type JsonPrimitive = boolean | null | number | string;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function normalizeCanonicalText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function canonicalValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return typeof value === "string" ? value.normalize("NFC") : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON does not permit non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("canonical JSON requires plain objects");
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as object).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new Error("canonical JSON does not permit undefined values");
      }
      result[key.normalize("NFC")] = canonicalValue(child);
    }
    return result;
  }
  throw new Error("canonical JSON value is unsupported");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

type IntakeAnswer = SubmissionRequest["answers"][number];

function compareCanonicalText(left: string, right: string): number {
  const leftKey = left.toLocaleLowerCase("en-US");
  const rightKey = right.toLocaleLowerCase("en-US");
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStringList(values: string[]): string[] {
  const byComparisonKey = new Map<string, string>();
  for (const raw of values) {
    const value = normalizeCanonicalText(raw);
    const comparisonKey = value.toLocaleLowerCase("en-US");
    if (!byComparisonKey.has(comparisonKey)) {
      byComparisonKey.set(comparisonKey, value);
    }
  }
  return [...byComparisonKey.values()].sort(compareCanonicalText);
}

export function canonicalizeAnswers(
  answers: SubmissionRequest["answers"]
): IntakeAnswer[] {
  return answers
    .map((answer): IntakeAnswer => {
      const base = {
        fieldKey: normalizeCanonicalText(answer.fieldKey),
        label: normalizeCanonicalText(answer.label),
      };
      switch (answer.type) {
        case "string":
        case "single_choice":
          return {
            ...base,
            type: answer.type,
            value: normalizeCanonicalText(answer.value),
          };
        case "string_list":
          return {
            ...base,
            type: answer.type,
            value: canonicalStringList(answer.value),
          };
        case "number":
          return {
            ...base,
            type: answer.type,
            value: Object.is(answer.value, -0) ? 0 : answer.value,
          };
        case "boolean":
          return { ...base, type: answer.type, value: answer.value };
        case "date":
          return { ...base, type: answer.type, value: answer.value };
      }
    })
    .sort((left, right) => compareCanonicalText(left.fieldKey, right.fieldKey));
}

export interface NormalizedAttributionUrl {
  host: string;
  path: string;
  normalizedUrl: string;
}

export function normalizeAttributionUrl(raw: string): NormalizedAttributionUrl {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("attribution URL must use HTTP or HTTPS");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const host = url.hostname.toLowerCase();
  const path = url.pathname || "/";
  return Object.freeze({
    host,
    path,
    normalizedUrl: `${url.protocol}//${url.host.toLowerCase()}${path}`,
  });
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  return normalizeCanonicalText(value);
}

function canonicalizeAttribution(
  attribution: SubmissionRequest["attribution"]
) {
  if (!attribution) return null;
  return {
    utmSource: normalizeOptionalText(attribution.utmSource),
    utmMedium: normalizeOptionalText(attribution.utmMedium),
    utmCampaign: normalizeOptionalText(attribution.utmCampaign),
    utmTerm: normalizeOptionalText(attribution.utmTerm),
    utmContent: normalizeOptionalText(attribution.utmContent),
    externalCampaignId: normalizeOptionalText(attribution.externalCampaignId),
    clickProviderCode: attribution.clickProviderCode ?? null,
    clickId: normalizeOptionalText(attribution.clickId),
    landingPage: attribution.landingPageUrl
      ? normalizeAttributionUrl(attribution.landingPageUrl)
      : null,
    referrer: attribution.referrerUrl
      ? normalizeAttributionUrl(attribution.referrerUrl)
      : null,
  };
}

export function canonicalizeSubmission(
  input: SubmissionRequest | (SubmissionRequest & Record<string, unknown>),
  options: Readonly<{ defaultPhoneRegion?: string }> = {}
): {
  version: typeof CANONICAL_SUBMISSION_VERSION;
  value: JsonValue;
  canonicalJson: string;
  sha256: string;
} {
  const contact = canonicalizeContactIdentity(input.contact, options);
  const rawValue = {
    version: CANONICAL_SUBMISSION_VERSION,
    sourceId: input.sourceId,
    formId: input.formId,
    contact: {
      name: contact.evidence.name,
      email: contact.normalizedEmail,
      phoneEvidence: contact.evidence.phone ?? null,
      phoneRegion: contact.evidence.phoneRegion ?? null,
      normalizedPhone: contact.normalizedPhone,
      organizationName: normalizeOptionalText(input.contact.organizationName),
    },
    serviceAddress: input.serviceAddress
      ? {
          line1: normalizeCanonicalText(input.serviceAddress.line1),
          line2: normalizeOptionalText(input.serviceAddress.line2),
          city: normalizeCanonicalText(input.serviceAddress.city),
          region: normalizeCanonicalText(input.serviceAddress.region),
          postalCode: normalizeCanonicalText(input.serviceAddress.postalCode),
          countryCode: input.serviceAddress.countryCode,
        }
      : null,
    workSummary: normalizeOptionalText(input.workSummary),
    preferredTiming: normalizeOptionalText(input.preferredTiming),
    answers: canonicalizeAnswers(input.answers),
    attribution: canonicalizeAttribution(input.attribution),
    uploadIds: [...input.uploadIds].sort(),
    externalSubmissionId: normalizeOptionalText(input.externalSubmissionId),
  };
  const value = canonicalValue(rawValue);
  const encoded = JSON.stringify(value);
  return Object.freeze({
    version: CANONICAL_SUBMISSION_VERSION,
    value,
    canonicalJson: encoded,
    sha256: createHash("sha256").update(encoded, "utf8").digest("hex"),
  });
}

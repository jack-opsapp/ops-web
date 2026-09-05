import { z } from "zod-v4";

import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";

import { discoveryTextUsesUnicode15 } from "./discovery-unicode15";
import { ContractSlugSchema, MoneySchema, OpaqueIdSchema } from "./common";
import { PostgresUuidSchema } from "./postgres-uuid";

export const P2_MAX_PAGE_ITEMS = 25;
export const P2_FETCH_LIMIT = P2_MAX_PAGE_ITEMS + 1;
export const P2_MAX_SOURCE_ROWS = 501;
export const P2_CURSOR_TTL_SECONDS = 15 * 60;
export const P2_MAX_SERIALIZED_CHARACTERS = 60_000;

const P2_CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const P2_FORBIDDEN_CONTROL_OR_BIDI_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/u;
const UTF8_ENCODER = new TextEncoder();

export const P2CanonicalUuidSchema = PostgresUuidSchema;

export const P2CanonicalTimestampSchema = z
  .string()
  .regex(P2_CANONICAL_TIMESTAMP_PATTERN)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const instant = new Date(value);
    return (
      year >= 1 &&
      year <= 9_999 &&
      !Number.isNaN(instant.getTime()) &&
      instant.toISOString() === value
    );
  }, "Timestamp must be a canonical UTC instant");

/** Normalize only user-supplied read windows; evidence and RPC outputs stay exact. */
export const P2ReadTimestampInputSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  .describe(
    "UTC timestamp ending in Z, with seconds and optional 1-3 fractional digits; for example 2026-09-07T07:00:00Z. Local times and offsets are not accepted."
  )
  .transform((value) => {
    const [seconds, fraction = ""] = value.slice(0, -1).split(".");
    return `${seconds}.${fraction.padEnd(3, "0")}Z`;
  })
  .pipe(P2CanonicalTimestampSchema);

export interface P2CanonicalTextBounds {
  readonly minimumScalars: number;
  readonly maximumScalars: number;
  readonly maximumUtf8Bytes: number;
  readonly allowTextWhitespace?: boolean;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function createP2CanonicalTextSchema(bounds: P2CanonicalTextBounds) {
  if (
    !Number.isInteger(bounds.minimumScalars) ||
    bounds.minimumScalars < 0 ||
    !isPositiveInteger(bounds.maximumScalars) ||
    bounds.minimumScalars > bounds.maximumScalars ||
    !isPositiveInteger(bounds.maximumUtf8Bytes)
  ) {
    throw new TypeError("P2_TEXT_BOUNDS_INVALID");
  }

  return z.string().superRefine((value, context) => {
    const scalarCount = Array.from(value).length;
    const hasForbiddenControl = bounds.allowTextWhitespace
      ? [...value].some(
          (character) =>
            character !== "\n" &&
            character !== "\t" &&
            P2_FORBIDDEN_CONTROL_OR_BIDI_PATTERN.test(character)
        )
      : P2_FORBIDDEN_CONTROL_OR_BIDI_PATTERN.test(value);
    if (
      scalarCount < bounds.minimumScalars ||
      scalarCount > bounds.maximumScalars ||
      UTF8_ENCODER.encode(value).length > bounds.maximumUtf8Bytes ||
      value !== value.normalize("NFC") ||
      value.trim() !== value ||
      hasForbiddenControl ||
      hasUnpairedSurrogate(value) ||
      !discoveryTextUsesUnicode15(value)
    ) {
      context.addIssue({
        code: "custom",
        message: "P2_TEXT_INVALID",
      });
    }
  });
}

export const P2ListRequestSchema = z
  .object({
    cursor: OpaqueIdSchema.optional(),
    limit: z.number().int().min(1).max(P2_MAX_PAGE_ITEMS).default(25),
  })
  .strict();

export function createP2SourceListSchema<TItemSchema extends z.ZodType>(
  itemSchema: TItemSchema
) {
  return z
    .object({
      rows: z.array(itemSchema).max(P2_MAX_SOURCE_ROWS),
    })
    .strict();
}

export const P2DomainRevisionSchema = z
  .object({
    domain: ContractSlugSchema,
    source_revision: z.number().int().safe().nonnegative(),
  })
  .strict();

function hasStrictlyAscendingKeys<T>(
  values: readonly T[],
  key: (value: T) => string
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (key(values[index - 1]!) >= key(values[index]!)) return false;
  }
  return true;
}

export const P2DomainRevisionVectorSchema = z
  .array(P2DomainRevisionSchema)
  .min(1)
  .max(64)
  .refine(
    (revisions) => hasStrictlyAscendingKeys(revisions, (item) => item.domain),
    "P2_DOMAIN_REVISION_VECTOR_NOT_CANONICAL"
  );

export const P2ComponentSelectionOriginSchema = z.enum(["explicit", "default"]);

export const P2ComponentSelectionSchema = z
  .object({
    component: ContractSlugSchema,
    origin: P2ComponentSelectionOriginSchema,
  })
  .strict();

export const P2ComponentSelectionVectorSchema = z
  .array(P2ComponentSelectionSchema)
  .min(1)
  .max(64)
  .refine(
    (selections) =>
      hasStrictlyAscendingKeys(selections, (item) => item.component),
    "P2_COMPONENT_SELECTION_VECTOR_NOT_CANONICAL"
  );

export const P2WarningSchema = z
  .object({
    code: z.literal("DEFAULT_COMPONENT_OMITTED"),
    component: ContractSlugSchema,
  })
  .strict();

export const P2GapSchema = z
  .object({
    code: z.enum(["SOURCE_UNAVAILABLE", "SOURCE_DATA_INVALID", "SOURCE_STALE"]),
    source: ContractSlugSchema,
  })
  .strict();

/** P2 monetary values reuse the one canonical OPS money contract by identity. */
export const P2MoneySchema = MoneySchema;

export function assertP2SerializedCharacterBudget(value: unknown): string {
  const serialized = serializeUntrustedPromptData(value);
  if (serialized.length > P2_MAX_SERIALIZED_CHARACTERS) {
    throw new RangeError("P2_RESULT_BUDGET_EXCEEDED");
  }
  return serialized;
}

const P2_FORBIDDEN_FIELD_NAMES = new Set([
  "access_token",
  "token",
  "tokens",
  "refresh_token",
  "id_token",
  "authorization_header",
  "api_key",
  "secret",
  "secret_key",
  "password",
  "password_hash",
  "credential",
  "credentials",
  "raw_payload",
  "raw_provider_payload",
  "raw_database_row",
  "raw_data",
  "migration_name",
  "source_json",
  "schema_name",
  "table_name",
  "column_name",
  "sql",
  "queue_id",
  "lease_id",
  "retry_count",
  "provider_id",
  "sync_cursor",
  "webhook_id",
  "client_state",
  "encryption_key",
  "session_id",
  "storage_path",
  "object_key",
  "signed_url",
  "permanent_url",
  "deleted_at",
  "deleted_data",
  "deletion_metadata",
  "audit_log",
  "audit_records",
  "security_context",
  "security_internals",
  "security_policy",
  "role_administration",
  "permission_override",
  "payroll_details",
  "stripe_customer_id",
  "billing_provider_id",
  "bank_account",
  "bank_routing",
  "routing_number",
  "account_number",
  "tax_id",
  "payment_instrument_id",
  "private_employee_details",
  "private_employee_email",
  "private_employee_phone",
  "employee_home_address",
  "employee_emergency_contact",
  "employee_live_location",
  "employee_device_id",
  "employee_firebase_uid",
  "employee_auth_user_id",
  "merged_away_id",
  "soft_deleted_at",
  "superseded_by",
  "cross_company_id",
  "raw_settings",
  "model_prompt",
  "memory",
  "company_export",
  "attachment_provenance",
  "file_body",
  "internal_notes",
  "export_url",
  "export_data",
]);

function canonicalFieldName(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

const P2_PROVIDER_SPECIFIC_ID_PATTERN =
  /^(?:provider|gmail|google|microsoft|outlook|stripe|quickbooks|sage|twilio|sendgrid|firebase)(?:_[a-z0-9]+)*_id$/;
const P2_WEBHOOK_MATERIAL_PATTERN =
  /^webhook_(?:[a-z0-9]+_)*(?:id|identifier|secret|token|signature|key|hash|payload|url)$/;
const P2_TOKEN_MATERIAL_PATTERN = /(?:^|_)(?:access|refresh|page)_token$/;
const P2_CLIENT_STATE_PATTERN = /(?:^|_)client_state(?:_|$)/;
const P2_LEASE_INTERNAL_PATTERN =
  /^lease_(?:id|owner(?:_id)?|expires(?:_at)?)$/;
const P2_RETRY_INTERNAL_PATTERN =
  /^retry_(?:count|at|after(?:_[a-z0-9]+)*|attempts|state)$/;

function isForbiddenP2FieldName(field: string): boolean {
  return (
    P2_FORBIDDEN_FIELD_NAMES.has(field) ||
    field.startsWith("raw_") ||
    P2_WEBHOOK_MATERIAL_PATTERN.test(field) ||
    P2_TOKEN_MATERIAL_PATTERN.test(field) ||
    P2_PROVIDER_SPECIFIC_ID_PATTERN.test(field) ||
    P2_CLIENT_STATE_PATTERN.test(field) ||
    P2_LEASE_INTERNAL_PATTERN.test(field) ||
    P2_RETRY_INTERNAL_PATTERN.test(field)
  );
}

export function assertP2NoForbiddenFields(value: unknown): void {
  const seen = new WeakSet<object>();
  const inspect = (current: unknown): void => {
    if (typeof current !== "object" || current === null) return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach(inspect);
      return;
    }

    for (const [field, nested] of Object.entries(current)) {
      if (isForbiddenP2FieldName(canonicalFieldName(field))) {
        throw new TypeError("P2_FORBIDDEN_FIELD");
      }
      inspect(nested);
    }
  };

  inspect(value);
}

export type P2DomainRevision = z.infer<typeof P2DomainRevisionSchema>;
export type P2ComponentSelection = z.infer<typeof P2ComponentSelectionSchema>;
export type P2Warning = z.infer<typeof P2WarningSchema>;
export type P2Gap = z.infer<typeof P2GapSchema>;

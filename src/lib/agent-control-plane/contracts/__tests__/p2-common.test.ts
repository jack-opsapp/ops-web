import { describe, expect, it } from "vitest";

import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2ComponentSelectionVectorSchema,
  P2_CURSOR_TTL_SECONDS,
  P2DomainRevisionVectorSchema,
  P2_FETCH_LIMIT,
  P2GapSchema,
  P2_MAX_PAGE_ITEMS,
  P2_MAX_SERIALIZED_CHARACTERS,
  P2_MAX_SOURCE_ROWS,
  P2MoneySchema,
  P2ListRequestSchema,
  P2WarningSchema,
  assertP2NoForbiddenFields,
  assertP2SerializedCharacterBudget,
  createP2CanonicalTextSchema,
  createP2SourceListSchema,
} from "../p2-common";
import { MoneySchema } from "../common";
import { z } from "zod-v4";

const PERMANENTLY_FORBIDDEN_P2_FIELDS = [
  // Database, schema, queue, lease, retry, and audit internals.
  "raw_database_row",
  "sql",
  "schema_name",
  "table_name",
  "migration_name",
  "queue_id",
  "lease_id",
  "retry_count",
  "audit_records",
  // OAuth, provider, webhook, cursor, encryption, and session internals.
  "access_token",
  "token",
  "refreshToken",
  "apiKey",
  "credentials",
  "password_hash",
  "secretKey",
  "provider_id",
  "sync_cursor",
  "webhook_id",
  "client_state",
  "encryption_key",
  "session_id",
  // Billing, banking, payroll, tax, and payment instruments.
  "stripe_customer_id",
  "billing_provider_id",
  "bank_account",
  "routing_number",
  "account_number",
  "payroll_details",
  "tax_id",
  "payment_instrument_id",
  // Private employee, role-administration, and security internals.
  "private_employee_email",
  "private_employee_phone",
  "employee_home_address",
  "employee_emergency_contact",
  "employee_live_location",
  "employee_device_id",
  "employee_firebase_uid",
  "employee_auth_user_id",
  "role_administration",
  "permission_override",
  "security_policy",
  "security_internals",
  // Deleted, merged, superseded, and cross-company internals.
  "deleted_at",
  "deleted_data",
  "merged_away_id",
  "soft_deleted_at",
  "superseded_by",
  "cross_company_id",
  // Raw providers/settings, prompts, memory, and exports.
  "raw_provider_payload",
  "source_json",
  "raw_settings",
  "model_prompt",
  "memory",
  "company_export",
  "export_url",
  "export_data",
  // Storage, provenance, unbounded bodies, and internal notes.
  "storage_path",
  "signedUrl",
  "attachment_provenance",
  "file_body",
  "internal_notes",
  // Canonical aliases must not bypass the boundary.
  "provider_message_id",
  "gmail_message_id",
  "webhook_client_state_hash",
  "mailbox_access_token",
  "provider_page_token",
  "lease_owner",
  "retry_at",
  "raw_settings_json",
] as const;

describe("P2 common contracts", () => {
  it("pins the public page, lookahead, source sentinel, and cursor TTL", () => {
    expect(P2_MAX_PAGE_ITEMS).toBe(25);
    expect(P2_FETCH_LIMIT).toBe(26);
    expect(P2_MAX_SOURCE_ROWS).toBe(501);
    expect(P2_CURSOR_TTL_SECONDS).toBe(15 * 60);

    expect(P2ListRequestSchema.parse({})).toEqual({ limit: 25 });
    expect(P2ListRequestSchema.parse({ limit: 25 })).toEqual({ limit: 25 });
    expect(P2ListRequestSchema.safeParse({ limit: 26 }).success).toBe(false);
    expect(P2ListRequestSchema.safeParse({ extra: true }).success).toBe(false);

    const sourceSchema = createP2SourceListSchema(
      z.object({ id: z.number().int() }).strict()
    );
    expect(
      sourceSchema.safeParse({
        rows: Array.from({ length: 501 }, (_, id) => ({ id })),
      }).success
    ).toBe(true);
    expect(
      sourceSchema.safeParse({
        rows: Array.from({ length: 502 }, (_, id) => ({ id })),
      }).success
    ).toBe(false);
    expect(sourceSchema.safeParse({ rows: [], extra: true }).success).toBe(
      false
    );
  });

  it("accepts only canonical UUID, UTC time, and Unicode text", () => {
    expect(
      P2CanonicalUuidSchema.parse("de305d54-75b4-431b-adb2-eb6b9e546014")
    ).toBe("de305d54-75b4-431b-adb2-eb6b9e546014");
    expect(
      P2CanonicalUuidSchema.safeParse("DE305D54-75B4-431B-ADB2-EB6B9E546014")
        .success
    ).toBe(false);
    expect(P2CanonicalTimestampSchema.parse("2026-08-23T07:30:00.000Z")).toBe(
      "2026-08-23T07:30:00.000Z"
    );
    expect(
      P2CanonicalTimestampSchema.safeParse("2026-08-23T07:30:00Z").success
    ).toBe(false);
    expect(
      P2CanonicalTimestampSchema.safeParse("2026-08-23T00:30:00-07:00").success
    ).toBe(false);
    expect(P2CanonicalTimestampSchema.parse("0001-01-01T00:00:00.000Z")).toBe(
      "0001-01-01T00:00:00.000Z"
    );
    expect(P2CanonicalTimestampSchema.parse("9999-12-31T23:59:59.999Z")).toBe(
      "9999-12-31T23:59:59.999Z"
    );
    expect(
      P2CanonicalTimestampSchema.safeParse("0000-01-01T00:00:00.000Z").success
    ).toBe(false);
    expect(
      P2CanonicalTimestampSchema.safeParse("10000-01-01T00:00:00.000Z").success
    ).toBe(false);
    expect(
      P2CanonicalTimestampSchema.safeParse("2025-02-29T00:00:00.000Z").success
    ).toBe(false);
    expect(
      P2CanonicalTimestampSchema.safeParse("2026-04-31T00:00:00.000Z").success
    ).toBe(false);

    const textSchema = createP2CanonicalTextSchema({
      minimumScalars: 1,
      maximumScalars: 16,
      maximumUtf8Bytes: 32,
    });
    expect(textSchema.parse("café")).toBe("café");
    expect(textSchema.safeParse("cafe\u0301").success).toBe(false);
    expect(textSchema.safeParse("hidden\u202epath").success).toBe(false);
    expect(textSchema.safeParse("line\nbreak").success).toBe(false);
    expect(textSchema.safeParse("abcdefghijklmnopq").success).toBe(false);
  });

  it("requires sorted, unique safe-integer domain revision vectors", () => {
    expect(
      P2DomainRevisionVectorSchema.parse([
        { domain: "artifacts", source_revision: 7 },
        { domain: "tasks", source_revision: 11 },
      ])
    ).toEqual([
      { domain: "artifacts", source_revision: 7 },
      { domain: "tasks", source_revision: 11 },
    ]);
    expect(
      P2DomainRevisionVectorSchema.safeParse([
        { domain: "tasks", source_revision: 11 },
        { domain: "artifacts", source_revision: 7 },
      ]).success
    ).toBe(false);
    expect(
      P2DomainRevisionVectorSchema.safeParse([
        { domain: "tasks", source_revision: 11 },
        { domain: "tasks", source_revision: 12 },
      ]).success
    ).toBe(false);
    expect(
      P2DomainRevisionVectorSchema.safeParse([
        { domain: "tasks", source_revision: Number.MAX_SAFE_INTEGER + 1 },
      ]).success
    ).toBe(false);
  });

  it("preserves explicit versus documented-default component semantics", () => {
    expect(
      P2ComponentSelectionVectorSchema.parse([
        { component: "financial_attention", origin: "default" },
        { component: "work_due", origin: "explicit" },
      ])
    ).toEqual([
      { component: "financial_attention", origin: "default" },
      { component: "work_due", origin: "explicit" },
    ]);
    expect(
      P2ComponentSelectionVectorSchema.safeParse([
        { component: "work_due", origin: "explicit" },
        { component: "work_due", origin: "default" },
      ]).success
    ).toBe(false);
    expect(
      P2ComponentSelectionVectorSchema.safeParse([
        { component: "work_due", origin: "inferred" },
      ]).success
    ).toBe(false);
  });

  it("reuses MoneySchema and permits only fixed privacy-safe warning and gap shapes", () => {
    expect(P2MoneySchema).toBe(MoneySchema);
    expect(
      P2MoneySchema.parse({ amount_minor: 12_345, currency: "CAD" })
    ).toEqual({ amount_minor: 12_345, currency: "CAD" });
    expect(
      P2MoneySchema.safeParse({ amount: 123.45, currency: "CAD" }).success
    ).toBe(false);

    expect(
      P2WarningSchema.parse({
        code: "DEFAULT_COMPONENT_OMITTED",
        component: "financial_attention",
      })
    ).toEqual({
      code: "DEFAULT_COMPONENT_OMITTED",
      component: "financial_attention",
    });
    expect(
      P2WarningSchema.safeParse({
        code: "DEFAULT_COMPONENT_OMITTED",
        component: "financial_attention",
        message: "raw provider error",
      }).success
    ).toBe(false);
    expect(
      P2GapSchema.parse({ code: "SOURCE_UNAVAILABLE", source: "inventory" })
    ).toEqual({ code: "SOURCE_UNAVAILABLE", source: "inventory" });
    expect(
      P2GapSchema.safeParse({ code: "DATABASE_TIMEOUT", source: "inventory" })
        .success
    ).toBe(false);
  });

  it("measures the exact MCP serialization budget at 60,000 characters", () => {
    expect(P2_MAX_SERIALIZED_CHARACTERS).toBe(60_000);
    const envelopeOverhead = '{"data":""}'.length;
    const exact = { data: "x".repeat(60_000 - envelopeOverhead) };
    const oversized = { data: "x".repeat(60_001 - envelopeOverhead) };

    expect(assertP2SerializedCharacterBudget(exact)).toHaveLength(60_000);
    expect(() => assertP2SerializedCharacterBudget(oversized)).toThrow(
      "P2_RESULT_BUDGET_EXCEEDED"
    );
    expect(() =>
      assertP2SerializedCharacterBudget({ data: "<".repeat(10_000) })
    ).toThrow("P2_RESULT_BUDGET_EXCEEDED");
  });

  it("permits safe public provider, opaque cursor, and retryability fields", () => {
    expect(() =>
      assertP2NoForbiddenFields({
        safe: [
          {
            evidence_ref: "opaque",
            provider: "calendar",
            provider_type: "calendar",
            next_cursor: "opaque-signed-cursor",
            retryable: false,
          },
        ],
      })
    ).not.toThrow();
  });

  it.each(PERMANENTLY_FORBIDDEN_P2_FIELDS)(
    "recursively rejects permanent boundary field %s",
    (forbidden) => {
      expect(() =>
        assertP2NoForbiddenFields({ safe: [{ [forbidden]: "secret" }] })
      ).toThrow("P2_FORBIDDEN_FIELD");
    }
  );
});

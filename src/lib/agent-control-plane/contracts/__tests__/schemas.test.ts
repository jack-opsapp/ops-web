import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod-v4";

import {
  AGENT_ERROR_CODES,
  AgentErrorCodeSchema,
  AgentErrorSchema,
  ContractVersionSchema,
  CursorPageSchema,
  CursorRequestSchema,
  EvidenceRefSchema,
  EvidenceTrustSchema,
  JobConversationRefSchema,
  JobRefSchema,
  MoneySchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
  ScheduleInstantSchema,
  createAgentResultSchema,
} from "../index";
import {
  v1CursorPageFixture,
  v1ErrorResultFixture,
  v1EvidenceResultFixture,
  v1SuccessResultFixture,
} from "../__fixtures__/v1";

const SuccessDataSchema = JobConversationRefSchema.safeExtend({
  schedule: ScheduleInstantSchema,
  budget: MoneySchema,
});

const CONTRACT_SCHEMA_FILES = [
  "version.ts",
  "common.ts",
  "errors.ts",
  "jobs.ts",
  "conversation.ts",
  "evidence.ts",
  "__tests__/schemas.test.ts",
] as const;

describe("OPS agent control-plane v1 contracts", () => {
  it("uses only the isolated Zod 4 package for MCP-compatible contracts", async () => {
    const contractRoot = path.join(
      process.cwd(),
      "src/lib/agent-control-plane/contracts"
    );
    const inspections = await Promise.all(
      CONTRACT_SCHEMA_FILES.map(async (file) => ({
        file,
        source: await readFile(path.join(contractRoot, file), "utf8"),
      }))
    );

    const violations = inspections
      .filter(
        ({ source }) =>
          /from\s+["'](?:zod|zod\/v4)["']/.test(source) ||
          !source.includes('from "zod-v4"')
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);

    const standard = (
      ContractVersionSchema as unknown as {
        "~standard"?: {
          jsonSchema?: { input?: unknown; output?: unknown };
        };
      }
    )["~standard"];
    expect(standard?.jsonSchema?.input).toBeTypeOf("function");
    expect(standard?.jsonSchema?.output).toBeTypeOf("function");
  });

  it("accepts only the exact v1 contract version", () => {
    expect(ContractVersionSchema.parse("2026-08-07.v1")).toBe("2026-08-07.v1");
    expect(ContractVersionSchema.safeParse("2026-08-07.v2").success).toBe(
      false
    );
  });

  it("discriminates opportunity and project job references", () => {
    expect(
      JobRefSchema.parse({
        kind: "opportunity",
        id: "provider/opportunity:<opaque>",
      })
    ).toEqual({
      kind: "opportunity",
      id: "provider/opportunity:<opaque>",
    });
    expect(
      JobRefSchema.parse({ kind: "project", id: "project:opaque/001" })
    ).toEqual({ kind: "project", id: "project:opaque/001" });
    expect(
      JobRefSchema.safeParse({ kind: "client", id: "client:001" }).success
    ).toBe(false);
  });

  it("treats IDs as bounded opaque strings rather than UUIDs", () => {
    expect(OpaqueIdSchema.parse("gmail/message:<opaque/ABC==>")).toBe(
      "gmail/message:<opaque/ABC==>"
    );
    expect(OpaqueIdSchema.safeParse("   ").success).toBe(false);
    expect(OpaqueIdSchema.safeParse("x".repeat(513)).success).toBe(false);
  });

  it("accepts RFC 3339 UTC timestamps and rejects offsets or local dates", () => {
    expect(Rfc3339UtcTimestampSchema.parse("2026-08-07T20:15:30.123Z")).toBe(
      "2026-08-07T20:15:30.123Z"
    );
    expect(
      Rfc3339UtcTimestampSchema.safeParse("2026-08-07T13:15:30-07:00").success
    ).toBe(false);
    expect(Rfc3339UtcTimestampSchema.safeParse("2026-08-07").success).toBe(
      false
    );
  });

  it("keeps schedule instants explicit in UTC, local time, and IANA timezone", () => {
    const schedule = {
      utc: "2026-11-01T16:30:00.000Z",
      local: "2026-11-01T09:30:00",
      timezone: "America/Vancouver",
    };

    expect(ScheduleInstantSchema.parse(schedule)).toEqual(schedule);
    expect(
      ScheduleInstantSchema.safeParse({
        ...schedule,
        timezone: "Pacific/Vancouver-ish",
      }).success
    ).toBe(false);
    expect(
      ScheduleInstantSchema.safeParse({
        ...schedule,
        local: "2026-11-01T08:30:00Z",
      }).success
    ).toBe(false);
  });

  it("requires local schedule time to be the exact timezone projection of UTC", () => {
    expect(
      ScheduleInstantSchema.safeParse({
        utc: "2026-03-08T09:30:00.000Z",
        local: "2026-03-08T01:30:00",
        timezone: "America/Vancouver",
      }).success
    ).toBe(true);
    expect(
      ScheduleInstantSchema.safeParse({
        utc: "2026-03-08T10:30:00.000Z",
        local: "2026-03-08T03:30:00",
        timezone: "America/Vancouver",
      }).success
    ).toBe(true);
    expect(
      ScheduleInstantSchema.safeParse({
        utc: "2026-03-08T10:30:00.000Z",
        local: "2026-03-08T02:30:00",
        timezone: "America/Vancouver",
      }).success
    ).toBe(false);
    expect(
      ScheduleInstantSchema.safeParse({
        utc: "2026-11-01T08:30:00.000Z",
        local: "2026-11-01T01:30:00",
        timezone: "America/Vancouver",
      }).success
    ).toBe(true);
    expect(
      ScheduleInstantSchema.safeParse({
        utc: "2026-11-01T09:30:00.000Z",
        local: "2026-11-01T02:30:00",
        timezone: "America/Vancouver",
      }).success
    ).toBe(true);
    expect(
      ScheduleInstantSchema.safeParse({
        utc: "2026-11-01T09:30:00.000Z",
        local: "2026-11-01T01:30:00",
        timezone: "America/Vancouver",
      }).success
    ).toBe(false);
  });

  it("represents money only as safe integer minor units and ISO-style currency", () => {
    expect(
      MoneySchema.parse({ amount_minor: -125050, currency: "CAD" })
    ).toEqual({ amount_minor: -125050, currency: "CAD" });
    expect(
      MoneySchema.safeParse({ amount_minor: 1250.5, currency: "CAD" }).success
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount_minor: 125050, currency: "cad" }).success
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount_minor: 125050, currency: "ZZZ" }).success
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount_minor: 125050, currency: "BGN" }).success
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount_minor: 125050, currency: "XAD" }).success
    ).toBe(true);
  });

  it("requires versioned evidence and the stable trust labels", () => {
    expect(EvidenceTrustSchema.options).toEqual([
      "authoritative_ops",
      "delivered_correspondence",
      "operator_document",
      "model_transcribed",
    ]);

    const evidence = v1EvidenceResultFixture.data;
    expect(EvidenceRefSchema.parse(evidence)).toEqual(evidence);
    expect(
      EvidenceRefSchema.safeParse({ ...evidence, version: undefined }).success
    ).toBe(false);
    expect(
      EvidenceRefSchema.safeParse({ ...evidence, trust: "model_guess" }).success
    ).toBe(false);
  });

  it("bounds cursor tool input, supplies its default, and rejects tenant input", () => {
    expect(CursorRequestSchema.parse({})).toEqual({ limit: 25 });
    expect(CursorRequestSchema.parse({ limit: 50 })).toEqual({ limit: 50 });
    expect(CursorRequestSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(CursorRequestSchema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(
      CursorRequestSchema.safeParse({
        limit: 25,
        company_id: "attacker-selected-company",
      }).success
    ).toBe(false);
  });

  it("requires a continuation cursor exactly when a page has more results", () => {
    expect(CursorPageSchema.parse(v1CursorPageFixture)).toEqual(
      v1CursorPageFixture
    );
    expect(
      CursorPageSchema.safeParse({ next_cursor: null, has_more: true }).success
    ).toBe(false);
    expect(
      CursorPageSchema.safeParse({
        next_cursor: "cursor:extra",
        has_more: false,
      }).success
    ).toBe(false);
  });

  it("rejects duplicate or same-kind conversation job anchors", () => {
    expect(
      JobConversationRefSchema.safeParse({
        conversation_id: "conversation:001",
        job_refs: [
          { kind: "opportunity", id: "opportunity:001" },
          { kind: "opportunity", id: "opportunity:001" },
        ],
      }).success
    ).toBe(false);
    expect(
      JobConversationRefSchema.safeParse({
        conversation_id: "conversation:001",
        job_refs: [
          { kind: "project", id: "project:001" },
          { kind: "opportunity", id: "opportunity:001" },
        ],
      }).success
    ).toBe(false);
    expect(
      JobConversationRefSchema.safeParse({
        conversation_id: "conversation:001",
        job_refs: [
          { kind: "project", id: "project:001" },
          { kind: "project", id: "project:002" },
        ],
      }).success
    ).toBe(false);
    expect(
      JobConversationRefSchema.safeParse({
        conversation_id: "conversation:001",
        job_refs: [
          { kind: "opportunity", id: "shared:001" },
          { kind: "project", id: "shared:001" },
        ],
      }).success
    ).toBe(false);
    expect(
      JobConversationRefSchema.safeParse({
        conversation_id: "conversation:001",
        job_refs: [
          { kind: "opportunity", id: "opportunity:001" },
          { kind: "project", id: "project:001" },
        ],
      }).success
    ).toBe(true);
  });

  it("keeps the stable error-code union exact and rejects invented codes", () => {
    expect(AGENT_ERROR_CODES).toEqual([
      "UNAUTHENTICATED",
      "INSUFFICIENT_SCOPE",
      "FORBIDDEN",
      "NOT_FOUND",
      "INVALID_ARGUMENT",
      "RESULT_TOO_LARGE",
      "AMBIGUOUS",
      "STALE_CONTEXT",
      "CONFIRMATION_REQUIRED",
      "CONFIRMATION_EXPIRED",
      "IDEMPOTENCY_CONFLICT",
      "RATE_LIMITED",
      "TEMPORARILY_UNAVAILABLE",
      "INTERNAL",
    ]);
    expect(AgentErrorCodeSchema.parse("STALE_CONTEXT")).toBe("STALE_CONTEXT");
    expect(AgentErrorCodeSchema.parse("RESULT_TOO_LARGE")).toBe(
      "RESULT_TOO_LARGE"
    );
    expect(AgentErrorCodeSchema.safeParse("DATABASE_ERROR").success).toBe(
      false
    );
  });

  it("requires code-specific error details and rejects unrelated details", () => {
    const base = {
      contract_version: "2026-08-07.v1",
      request_id: "request:error/001",
      message: "Safe error message.",
      retryable: false,
    } as const;

    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "INSUFFICIENT_SCOPE",
      }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "INSUFFICIENT_SCOPE",
        details: { required_scope: "ops.jobs.read" },
      }).success
    ).toBe(true);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "INSUFFICIENT_SCOPE",
        details: { retry_after_seconds: 30 },
      }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({ ...base, code: "STALE_CONTEXT" }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "STALE_CONTEXT",
        details: {
          current_source_versions:
            v1ErrorResultFixture.details.current_source_versions,
        },
      }).success
    ).toBe(true);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "STALE_CONTEXT",
        details: { required_scope: "ops.jobs.read" },
      }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "FORBIDDEN",
        details: {},
      }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "RESULT_TOO_LARGE",
      }).success
    ).toBe(true);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "RESULT_TOO_LARGE",
        details: {},
      }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({
        ...base,
        code: "RATE_LIMITED",
        retryable: true,
        details: { retry_after_seconds: 30 },
      }).success
    ).toBe(true);
  });

  it("enforces hard maxima on result and error reference collections", () => {
    const successSchema = createAgentResultSchema(SuccessDataSchema);
    const sourceVersion = v1SuccessResultFixture.freshness.source_versions[0];
    const evidence = v1SuccessResultFixture.evidence[0];
    const warning = v1SuccessResultFixture.warnings[0];

    expect(
      successSchema.safeParse({
        ...v1SuccessResultFixture,
        freshness: {
          ...v1SuccessResultFixture.freshness,
          source_versions: Array.from({ length: 101 }, (_, index) => ({
            ...sourceVersion,
            source_id: `source:${index}`,
          })),
        },
      }).success
    ).toBe(false);
    expect(
      successSchema.safeParse({
        ...v1SuccessResultFixture,
        evidence: Array.from({ length: 101 }, (_, index) => ({
          ...evidence,
          evidence_id: `evidence:${index}`,
        })),
      }).success
    ).toBe(false);
    expect(
      successSchema.safeParse({
        ...v1SuccessResultFixture,
        warnings: Array.from({ length: 51 }, () => warning),
      }).success
    ).toBe(false);
    expect(
      AgentErrorSchema.safeParse({
        ...v1ErrorResultFixture,
        details: {
          ...v1ErrorResultFixture.details,
          current_source_versions: Array.from({ length: 101 }, (_, index) => ({
            ...sourceVersion,
            source_id: `source:${index}`,
          })),
        },
      }).success
    ).toBe(false);
  });

  it("parses and deterministically serializes the frozen v1 fixtures", () => {
    const successSchema = createAgentResultSchema(SuccessDataSchema);
    const evidenceResultSchema = createAgentResultSchema(EvidenceRefSchema);

    const parsedSuccess = successSchema.parse(v1SuccessResultFixture);
    const parsedPage = CursorPageSchema.parse(v1CursorPageFixture);
    const parsedEvidence = evidenceResultSchema.parse(v1EvidenceResultFixture);
    const parsedError = AgentErrorSchema.parse(v1ErrorResultFixture);

    expect(JSON.parse(JSON.stringify(parsedSuccess))).toEqual(
      v1SuccessResultFixture
    );
    expect(JSON.parse(JSON.stringify(parsedPage))).toEqual(v1CursorPageFixture);
    expect(JSON.parse(JSON.stringify(parsedEvidence))).toEqual(
      v1EvidenceResultFixture
    );
    expect(JSON.parse(JSON.stringify(parsedError))).toEqual(
      v1ErrorResultFixture
    );
  });

  it("infers result payload types from the runtime Zod schema", () => {
    const resultSchema = createAgentResultSchema(
      z.object({ value: z.string() }).strict()
    );
    const parsed = resultSchema.parse({
      ...v1SuccessResultFixture,
      data: { value: "typed-by-zod" },
    });

    expect(parsed.data.value).toBe("typed-by-zod");
  });
});

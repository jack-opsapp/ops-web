import { createHash } from "node:crypto";

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const JOB_MEMORY_SCHEMA_VERSION = "ops.job-memory.v1" as const;
export const MAX_MEMORY_DOCUMENT_CHARACTERS = 60_000;

export const MemoryEvidenceRelationshipSchema = z.enum([
  "supports",
  "contradicts",
  "supersedes",
]);

export const MemoryEvidenceLinkSchema = z
  .object({
    evidence_id: z.string().trim().min(1).max(256),
    relationship: MemoryEvidenceRelationshipSchema,
  })
  .strict();

const EvidenceLinksSchema = z.array(MemoryEvidenceLinkSchema).min(1).max(8);
const StatementSchema = z.string().trim().min(1).max(1_000);
const ParticipantIdSchema = z.string().trim().min(1).max(512);
const NullableParticipantIdSchema = ParticipantIdSchema.nullable();
const NullableTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .nullable();

export const JobMemoryDocumentSchema = z
  .object({
    schema_version: z.literal(JOB_MEMORY_SCHEMA_VERSION),
    facts: z
      .array(
        z
          .object({
            statement: StatementSchema,
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(20),
    decisions: z
      .array(
        z
          .object({
            statement: StatementSchema,
            decided_by_participant_id: NullableParticipantIdSchema,
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(15),
    commitments: z
      .array(
        z
          .object({
            statement: StatementSchema,
            owner_participant_id: NullableParticipantIdSchema,
            due_at: NullableTimestampSchema,
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(20),
    preferences: z
      .array(
        z
          .object({
            statement: StatementSchema,
            participant_id: ParticipantIdSchema,
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(15),
    open_questions: z
      .array(
        z
          .object({
            question: StatementSchema,
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(20),
    contradictions: z
      .array(
        z
          .object({
            topic: z.string().trim().min(1).max(300),
            competing_claims: z
              .array(
                z
                  .object({
                    statement: StatementSchema,
                    evidence: EvidenceLinksSchema,
                  })
                  .strict()
              )
              .min(2)
              .max(4),
          })
          .strict()
      )
      .max(15),
    schedule_assertions: z
      .array(
        z
          .object({
            statement: StatementSchema,
            asserted_by_participant_id: ParticipantIdSchema,
            start_at: NullableTimestampSchema,
            end_at: NullableTimestampSchema,
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(20),
    financial_facts: z
      .array(
        z
          .object({
            statement: StatementSchema,
            kind: z.enum([
              "quote",
              "estimate",
              "invoice",
              "payment",
              "cost",
              "other",
            ]),
            currency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .nullable(),
            amount_minor: z.number().int().safe().nullable(),
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(20),
    excluded_assumptions: z
      .array(
        z
          .object({
            assumption: StatementSchema,
            reason: z.string().trim().min(1).max(500),
            evidence: EvidenceLinksSchema,
          })
          .strict()
      )
      .max(20),
  })
  .strict();

export type MemoryEvidenceRelationship = z.infer<
  typeof MemoryEvidenceRelationshipSchema
>;
export type MemoryEvidenceLink = z.infer<typeof MemoryEvidenceLinkSchema>;
export type JobMemoryDocument = z.infer<typeof JobMemoryDocumentSchema>;

export const EMPTY_MEMORY_DOCUMENT: JobMemoryDocument = {
  schema_version: JOB_MEMORY_SCHEMA_VERSION,
  facts: [],
  decisions: [],
  commitments: [],
  preferences: [],
  open_questions: [],
  contradictions: [],
  schedule_assertions: [],
  financial_facts: [],
  excluded_assumptions: [],
};

export interface MemorySemanticContext {
  readonly allowedEvidenceIds: ReadonlySet<string>;
  readonly resolvedParticipantByEvidenceId: ReadonlyMap<string, string>;
}

export class MemorySchemaError extends Error {
  readonly code:
    | "MEMORY_DOCUMENT_INVALID"
    | "MEMORY_DOCUMENT_TOO_LARGE"
    | "MEMORY_EVIDENCE_NOT_ALLOWED"
    | "MEMORY_EVIDENCE_DUPLICATE"
    | "MEMORY_PARTICIPANT_NOT_RESOLVED"
    | "MEMORY_PARTICIPANT_EVIDENCE_MISMATCH"
    | "MEMORY_FINANCIAL_FACT_INVALID";

  constructor(code: MemorySchemaError["code"], options?: ErrorOptions) {
    super(code, options);
    this.name = "MemorySchemaError";
    this.code = code;
  }
}

export function parseAndValidateMemoryDocument(
  value: unknown,
  context: MemorySemanticContext
): JobMemoryDocument {
  const parsed = JobMemoryDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new MemorySchemaError("MEMORY_DOCUMENT_INVALID", {
      cause: parsed.error,
    });
  }

  const canonical = canonicalizeMemoryDocument(parsed.data);
  assertEvidenceLinks(canonical, context.allowedEvidenceIds);
  assertResolvedAttribution(canonical, context.resolvedParticipantByEvidenceId);
  for (const fact of canonical.financial_facts) {
    if ((fact.currency === null) !== (fact.amount_minor === null)) {
      throw new MemorySchemaError("MEMORY_FINANCIAL_FACT_INVALID");
    }
  }
  if (JSON.stringify(canonical).length > MAX_MEMORY_DOCUMENT_CHARACTERS) {
    throw new MemorySchemaError("MEMORY_DOCUMENT_TOO_LARGE");
  }
  return canonical;
}

export function canonicalizeMemoryDocument(
  document: JobMemoryDocument
): JobMemoryDocument {
  const evidence = (links: readonly MemoryEvidenceLink[]) =>
    [...links]
      .map((link) => ({
        evidence_id: link.evidence_id,
        relationship: link.relationship,
      }))
      .sort((left, right) =>
        `${left.evidence_id}\u0000${left.relationship}`.localeCompare(
          `${right.evidence_id}\u0000${right.relationship}`
        )
      );
  const sortBy = <T>(values: readonly T[], key: (value: T) => string) =>
    [...values].sort((left, right) => key(left).localeCompare(key(right)));

  return {
    schema_version: JOB_MEMORY_SCHEMA_VERSION,
    facts: sortBy(
      document.facts.map((item) => ({
        statement: item.statement,
        evidence: evidence(item.evidence),
      })),
      (item) => item.statement
    ),
    decisions: sortBy(
      document.decisions.map((item) => ({
        statement: item.statement,
        decided_by_participant_id: item.decided_by_participant_id,
        evidence: evidence(item.evidence),
      })),
      (item) => item.statement
    ),
    commitments: sortBy(
      document.commitments.map((item) => ({
        statement: item.statement,
        owner_participant_id: item.owner_participant_id,
        due_at: item.due_at,
        evidence: evidence(item.evidence),
      })),
      (item) => item.statement
    ),
    preferences: sortBy(
      document.preferences.map((item) => ({
        statement: item.statement,
        participant_id: item.participant_id,
        evidence: evidence(item.evidence),
      })),
      (item) => item.statement
    ),
    open_questions: sortBy(
      document.open_questions.map((item) => ({
        question: item.question,
        evidence: evidence(item.evidence),
      })),
      (item) => item.question
    ),
    contradictions: sortBy(
      document.contradictions.map((item) => ({
        topic: item.topic,
        competing_claims: sortBy(
          item.competing_claims.map((claim) => ({
            statement: claim.statement,
            evidence: evidence(claim.evidence),
          })),
          (claim) => claim.statement
        ),
      })),
      (item) => item.topic
    ),
    schedule_assertions: sortBy(
      document.schedule_assertions.map((item) => ({
        statement: item.statement,
        asserted_by_participant_id: item.asserted_by_participant_id,
        start_at: item.start_at,
        end_at: item.end_at,
        evidence: evidence(item.evidence),
      })),
      (item) => item.statement
    ),
    financial_facts: sortBy(
      document.financial_facts.map((item) => ({
        statement: item.statement,
        kind: item.kind,
        currency: item.currency,
        amount_minor: item.amount_minor,
        evidence: evidence(item.evidence),
      })),
      (item) => `${item.kind}\u0000${item.statement}`
    ),
    excluded_assumptions: sortBy(
      document.excluded_assumptions.map((item) => ({
        assumption: item.assumption,
        reason: item.reason,
        evidence: evidence(item.evidence),
      })),
      (item) => item.assumption
    ),
  };
}

export function collectMemoryEvidenceLinks(
  document: JobMemoryDocument
): readonly MemoryEvidenceLink[] {
  const links: MemoryEvidenceLink[] = [];
  const collect = (
    items: readonly { evidence: readonly MemoryEvidenceLink[] }[]
  ) => {
    for (const item of items) links.push(...item.evidence);
  };
  collect(document.facts);
  collect(document.decisions);
  collect(document.commitments);
  collect(document.preferences);
  collect(document.open_questions);
  for (const contradiction of document.contradictions) {
    collect(contradiction.competing_claims);
  }
  collect(document.schedule_assertions);
  collect(document.financial_facts);
  collect(document.excluded_assumptions);
  return links;
}

export function filterMemoryDocumentByEvidence(
  document: JobMemoryDocument,
  invalidatedEvidenceIds: ReadonlySet<string>
): JobMemoryDocument {
  const retained = <T extends { evidence: readonly MemoryEvidenceLink[] }>(
    item: T
  ) =>
    !item.evidence.some((link) => invalidatedEvidenceIds.has(link.evidence_id));

  return canonicalizeMemoryDocument({
    ...document,
    facts: document.facts.filter(retained),
    decisions: document.decisions.filter(retained),
    commitments: document.commitments.filter(retained),
    preferences: document.preferences.filter(retained),
    open_questions: document.open_questions.filter(retained),
    contradictions: document.contradictions.filter((item) =>
      item.competing_claims.every(retained)
    ),
    schedule_assertions: document.schedule_assertions.filter(retained),
    financial_facts: document.financial_facts.filter(retained),
    excluded_assumptions: document.excluded_assumptions.filter(retained),
  });
}

export function hashCanonicalJson(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

export function jobMemoryOpenAiJsonSchema(): Record<string, unknown> {
  const converted = zodToJsonSchema(JobMemoryDocumentSchema, {
    target: "openAi",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const { $schema: _schema, ...schema } = converted;
  return schema;
}

function assertEvidenceLinks(
  document: JobMemoryDocument,
  allowedEvidenceIds: ReadonlySet<string>
): void {
  const seenByClaim = (links: readonly MemoryEvidenceLink[]) => {
    const seen = new Set<string>();
    for (const link of links) {
      if (!allowedEvidenceIds.has(link.evidence_id)) {
        throw new MemorySchemaError("MEMORY_EVIDENCE_NOT_ALLOWED");
      }
      const key = `${link.evidence_id}\u0000${link.relationship}`;
      if (seen.has(key)) {
        throw new MemorySchemaError("MEMORY_EVIDENCE_DUPLICATE");
      }
      seen.add(key);
    }
  };
  const visit = (
    items: readonly { evidence: readonly MemoryEvidenceLink[] }[]
  ) => items.forEach((item) => seenByClaim(item.evidence));
  visit(document.facts);
  visit(document.decisions);
  visit(document.commitments);
  visit(document.preferences);
  visit(document.open_questions);
  document.contradictions.forEach((item) => visit(item.competing_claims));
  visit(document.schedule_assertions);
  visit(document.financial_facts);
  visit(document.excluded_assumptions);
}

function assertResolvedAttribution(
  document: JobMemoryDocument,
  resolvedParticipantByEvidenceId: ReadonlyMap<string, string>
): void {
  const resolvedParticipantIds = new Set(
    resolvedParticipantByEvidenceId.values()
  );
  const assert = (
    participantId: string | null,
    evidence: readonly MemoryEvidenceLink[]
  ) => {
    if (participantId === null) return;
    if (!resolvedParticipantIds.has(participantId)) {
      throw new MemorySchemaError("MEMORY_PARTICIPANT_NOT_RESOLVED");
    }
    if (
      !evidence.some(
        (link) =>
          resolvedParticipantByEvidenceId.get(link.evidence_id) ===
          participantId
      )
    ) {
      throw new MemorySchemaError("MEMORY_PARTICIPANT_EVIDENCE_MISMATCH");
    }
  };
  document.decisions.forEach((item) =>
    assert(item.decided_by_participant_id, item.evidence)
  );
  document.commitments.forEach((item) =>
    assert(item.owner_participant_id, item.evidence)
  );
  document.preferences.forEach((item) =>
    assert(item.participant_id, item.evidence)
  );
  document.schedule_assertions.forEach((item) =>
    assert(item.asserted_by_participant_id, item.evidence)
  );
}

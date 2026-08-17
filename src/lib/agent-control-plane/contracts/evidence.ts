import { z } from "zod-v4";

import {
  AgentWarningSchema,
  ContractSlugSchema,
  CursorPageSchema,
  MAX_AGENT_WARNINGS,
  MAX_EVIDENCE_REFS,
  MAX_SOURCE_VERSIONS,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "./common";
import { ContractVersionSchema } from "./version";

export const SourceVersionSchema = z
  .object({
    source_domain: ContractSlugSchema,
    source_type: ContractSlugSchema,
    source_id: OpaqueIdSchema,
    version: OpaqueIdSchema,
  })
  .strict();

export const EvidenceRelationshipSchema = z.enum([
  "supports",
  "contradicts",
  "supersedes",
]);

export const EvidenceTrustSchema = z.enum([
  "authoritative_ops",
  "delivered_correspondence",
  "operator_document",
  "model_transcribed",
]);

export const EvidenceRefSchema = SourceVersionSchema.extend({
  evidence_id: OpaqueIdSchema,
  occurred_at: Rfc3339UtcTimestampSchema,
  relationship: EvidenceRelationshipSchema,
  excerpt: z.string().min(1).max(4_000).optional(),
  locator: z.string().min(1).max(2_048),
  trust: EvidenceTrustSchema,
}).strict();

export const AgentActorRefSchema = z
  .object({
    user_id: OpaqueIdSchema,
    permission_snapshot_revision: OpaqueIdSchema,
  })
  .strict();

export const AgentFreshnessSchema = z
  .object({
    read_at: Rfc3339UtcTimestampSchema,
    source_versions: z.array(SourceVersionSchema).max(MAX_SOURCE_VERSIONS),
    stale_after: Rfc3339UtcTimestampSchema.nullable(),
    memory_version: z.number().int().nonnegative().optional(),
    turn_high_watermark_id: OpaqueIdSchema.optional(),
  })
  .strict();

const AgentResultEnvelopeSchema = z
  .object({
    contract_version: ContractVersionSchema,
    request_id: OpaqueIdSchema,
    generated_at: Rfc3339UtcTimestampSchema,
    company_id: OpaqueIdSchema,
    actor: AgentActorRefSchema,
    freshness: AgentFreshnessSchema,
    evidence: z.array(EvidenceRefSchema).max(MAX_EVIDENCE_REFS),
    page: CursorPageSchema.optional(),
    warnings: z.array(AgentWarningSchema).max(MAX_AGENT_WARNINGS),
  })
  .strict();

export function createAgentResultSchema<TDataSchema extends z.ZodType>(
  dataSchema: TDataSchema
) {
  return AgentResultEnvelopeSchema.extend({ data: dataSchema });
}

export type SourceVersion = z.infer<typeof SourceVersionSchema>;
export type EvidenceRelationship = z.infer<typeof EvidenceRelationshipSchema>;
export type EvidenceTrust = z.infer<typeof EvidenceTrustSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type AgentActorRef = z.infer<typeof AgentActorRefSchema>;
export type AgentFreshness = z.infer<typeof AgentFreshnessSchema>;
export type AgentResult<TData> = z.infer<typeof AgentResultEnvelopeSchema> & {
  data: TData;
};

import { z } from "zod-v4";

import { ContractSlugSchema } from "./common";
import {
  P2CanonicalTimestampSchema,
  P2DomainRevisionVectorSchema,
  P2_MAX_PAGE_ITEMS,
} from "./p2-common";

const P2_PROOF_REF_PATTERN = /^ops_proof:v1:[A-Za-z0-9_-]{32,128}$/;
const P2_EVIDENCE_REF_PATTERN = /^ops_evidence:v1:[A-Za-z0-9_-]{32,128}$/;

export const P2ProofRefSchema = z.string().regex(P2_PROOF_REF_PATTERN);
export const P2EvidenceRefSchema = z.string().regex(P2_EVIDENCE_REF_PATTERN);

const P2ProofIdentitySchema = z
  .object({
    proof_ref: P2ProofRefSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: P2DomainRevisionVectorSchema,
  })
  .strict();

export const P2EntityProofSchema = P2ProofIdentitySchema;

export const P2CollectionProofSchema = P2ProofIdentitySchema.extend({
  returned_count: z.number().int().min(0).max(P2_MAX_PAGE_ITEMS),
  has_more: z.boolean(),
})
  .strict()
  .superRefine((proof, context) => {
    if (proof.has_more && proof.returned_count === 0) {
      context.addIssue({
        code: "custom",
        path: ["has_more"],
        message: "P2_EMPTY_COLLECTION_CANNOT_HAVE_MORE",
      });
    }
  });

export const P2EvidenceIdentitySchema = z
  .object({
    evidence_ref: P2EvidenceRefSchema,
    source_domain: ContractSlugSchema,
    source_type: ContractSlugSchema,
    occurred_at: P2CanonicalTimestampSchema,
  })
  .strict();

export type P2EntityProof = z.infer<typeof P2EntityProofSchema>;
export type P2CollectionProof = z.infer<typeof P2CollectionProofSchema>;
export type P2EvidenceIdentity = z.infer<typeof P2EvidenceIdentitySchema>;

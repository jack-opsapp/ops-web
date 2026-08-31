import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  COLLECTIONS_MAX_DEBTORS,
  COLLECTIONS_MAX_EVIDENCE_REFS,
  COLLECTIONS_SCHEMA_REVISION,
  CommitCollectionsDraftInputSchema,
  PrepareCollectionsInputSchema,
} from "@/lib/agent-control-plane/contracts/collections";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"]),
  });
}

const AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "owner_collections",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.financial_documents.read",
        "ops.operations.prepare",
        "ops.operations.read",
      ]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([
          permission("clients.view"),
          permission("email.view"),
          permission("invoices.view"),
          permission("reports.view"),
        ]),
      ]),
    }),
  ]),
});

export const PREPARE_COLLECTIONS_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_collections",
  schemaRevision: COLLECTIONS_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "collections",
  description:
    "Return exact receivables aging and prepare one immutable collection draft per eligible debtor for review. Sends nothing, moves no money, and issues no financial document.",
  inputSchema: PrepareCollectionsInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "medium",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 120_000,
    maxResultItems: COLLECTIONS_MAX_DEBTORS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: COLLECTIONS_MAX_EVIDENCE_REFS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_prepare",
  rateLimitBucket: "prepare",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "change_set_preview",
    exactPreviewRequired: true,
    expires: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.prepare_collections",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_COLLECTIONS_DRAFT_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_collections_draft",
  schemaRevision: COLLECTIONS_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "collections",
  description:
    "Approve one exact prepared collection draft inside OPS. This action never sends the draft, moves money, or issues a financial document.",
  inputSchema: CommitCollectionsDraftInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "medium",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 20_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: COLLECTIONS_MAX_EVIDENCE_REFS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_commit",
  rateLimitBucket: "commit",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "confirmation_receipt",
    prepareCapability: "prepare_collections",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_collections_draft",
} as const satisfies ImplementationOnlyCapabilityDefinition);

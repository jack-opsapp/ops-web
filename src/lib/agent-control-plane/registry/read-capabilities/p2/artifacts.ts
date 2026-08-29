import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  ARTIFACT_MAX_PAGE_ITEMS,
  ARTIFACT_SOURCE_KINDS,
  ARTIFACT_SOURCE_SCHEMA_REVISION,
  GetJobArtifactEvidenceInputSchema,
  JobArtifactListInputSchema,
  type ArtifactJobRef,
  type ArtifactSourceKind,
  type GetJobArtifactEvidenceInput,
  type JobArtifactListInput,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const ARTIFACT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "job_opportunity",
  "job_project",
  "deck_design",
  "email_attachment",
  "expense_receipt",
  "generated_estimate",
  "generated_invoice",
  "project_note_opportunity",
  "project_note_project",
  "project_photo",
  "site_visit_artifact",
] as const);
export type ArtifactAuthorizationVariantKey =
  (typeof ARTIFACT_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permissionName: CapabilityPermissionRequirement["permission"],
  allowedScopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze([...allowedScopes]),
  });
}

// Task 25 owns the shared selector vocabulary. These implementation-only
// selectors are frozen here so dark candidates can prove their final policies
// without mutating the active registry.
function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

const VARIANTS = [
  {
    key: "job_opportunity",
    selector: pendingSelector({
      kind: "input_object_discriminator",
      field: "job_ref",
      discriminator: "kind",
      value: "opportunity",
    }),
    requiredOAuthScopes: ["ops.files.read"],
    permissionRequirementGroups: [
      [permission("pipeline.view", ["all", "assigned"])],
    ],
  },
  {
    key: "job_project",
    selector: pendingSelector({
      kind: "input_object_discriminator",
      field: "job_ref",
      discriminator: "kind",
      value: "project",
    }),
    requiredOAuthScopes: ["ops.files.read"],
    permissionRequirementGroups: [
      [permission("projects.view", ["all", "assigned"])],
    ],
  },
  {
    key: "deck_design",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "deck_design",
    }),
    requiredOAuthScopes: ["ops.files.read", "ops.jobs.read"],
    permissionRequirementGroups: [
      [permission("deck_builder.view", ["all", "assigned"])],
    ],
  },
  {
    key: "email_attachment",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "email_attachment",
    }),
    requiredOAuthScopes: ["ops.correspondence.read", "ops.files.read"],
    permissionRequirementGroups: [
      [
        permission("email.view", ["all", "own"]),
        permission("inbox.view", ["all", "assigned", "own"]),
      ],
    ],
  },
  {
    key: "expense_receipt",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "expense_receipt",
    }),
    requiredOAuthScopes: ["ops.expenses.read", "ops.files.read"],
    permissionRequirementGroups: [
      [permission("expenses.view", ["all", "own"])],
    ],
  },
  {
    key: "generated_estimate",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "generated_estimate",
    }),
    requiredOAuthScopes: ["ops.files.read", "ops.financial_documents.read"],
    permissionRequirementGroups: [
      [
        permission("documents.view", ["all"]),
        permission("estimates.view", ["all", "assigned"]),
      ],
    ],
  },
  {
    key: "generated_invoice",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "generated_invoice",
    }),
    requiredOAuthScopes: ["ops.files.read", "ops.financial_documents.read"],
    permissionRequirementGroups: [
      [
        permission("documents.view", ["all"]),
        permission("invoices.view", ["all", "assigned"]),
      ],
    ],
  },
  {
    key: "project_note_opportunity",
    selector: pendingSelector({
      kind: "input_source_and_job_kind",
      sourceKind: "project_note",
      jobKind: "opportunity",
    }),
    requiredOAuthScopes: ["ops.files.read"],
    permissionRequirementGroups: [
      [permission("pipeline.view", ["all", "assigned"])],
    ],
  },
  {
    key: "project_note_project",
    selector: pendingSelector({
      kind: "input_source_and_job_kind",
      sourceKind: "project_note",
      jobKind: "project",
    }),
    requiredOAuthScopes: ["ops.files.read"],
    permissionRequirementGroups: [
      [permission("projects.view", ["all", "assigned"])],
    ],
  },
  {
    key: "project_photo",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "project_photo",
    }),
    requiredOAuthScopes: ["ops.files.read"],
    permissionRequirementGroups: [
      [permission("photos.view", ["all", "assigned"])],
    ],
  },
  {
    key: "site_visit_artifact",
    selector: pendingSelector({
      kind: "input_source_kind",
      value: "site_visit_artifact",
    }),
    requiredOAuthScopes: [
      "ops.customers.read",
      "ops.files.read",
      "ops.schedule.read",
      "ops.site_visits.read",
    ],
    permissionRequirementGroups: [
      [
        permission("calendar.view", ["all", "own"]),
        permission("clients.view", ["all", "assigned"]),
        permission("photos.view", ["all", "assigned"]),
        permission("pipeline.view", ["all", "assigned"]),
      ],
    ],
  },
] as const;

function definition(input: {
  readonly name: "get_job_artifact_evidence" | "list_job_artifacts";
  readonly description: string;
  readonly inputSchema:
    | typeof GetJobArtifactEvidenceInputSchema
    | typeof JobArtifactListInputSchema;
  readonly maxResultItems: number;
  readonly inputEvidence: "not_required" | "required";
  readonly rateLimitBucket: "evidence_search" | "lightweight_read";
}): ImplementationOnlyCapabilityDefinition {
  return {
    name: input.name,
    schemaRevision: ARTIFACT_SOURCE_SCHEMA_REVISION,
    operation: "read",
    description: input.description,
    inputSchema: input.inputSchema,
    authorization: { variants: VARIANTS },
    riskTier: "high",
    bounds: {
      maxInputBytes: 8_192,
      maxOutputCharacters: 60_000,
      maxResultItems: input.maxResultItems,
    },
    evidencePolicy: {
      input: input.inputEvidence,
      output: "required",
      maxEvidenceRefs: input.maxResultItems,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: "sensitive_read",
    rateLimitBucket: input.rateLimitBucket,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    confirmationPolicy: { kind: "not_required" },
    idempotencyPolicy: { kind: "inherent" },
    availability: { implementation: "available" },
    rolloutFlag: `agent_control_plane.capability.${input.name}`,
  };
}

export const LIST_JOB_ARTIFACTS_CANDIDATE = mintP2CandidateCapability(
  definition({
    name: "list_job_artifacts",
    description: "List safe metadata for selected current evidence on one job.",
    inputSchema: JobArtifactListInputSchema,
    maxResultItems: ARTIFACT_MAX_PAGE_ITEMS,
    inputEvidence: "not_required",
    rateLimitBucket: "evidence_search",
  })
);

export const GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE = mintP2CandidateCapability(
  definition({
    name: "get_job_artifact_evidence",
    description:
      "Return the safe source state for one discovered job artifact.",
    inputSchema: GetJobArtifactEvidenceInputSchema,
    maxResultItems: 1,
    inputEvidence: "required",
    rateLimitBucket: "lightweight_read",
  })
);

function jobVariant(jobRef: ArtifactJobRef): ArtifactAuthorizationVariantKey {
  return jobRef.kind === "project" ? "job_project" : "job_opportunity";
}

function sourceVariant(
  sourceKind: ArtifactSourceKind,
  jobRef: ArtifactJobRef
): ArtifactAuthorizationVariantKey {
  if (sourceKind === "project_note") {
    return jobRef.kind === "project"
      ? "project_note_project"
      : "project_note_opportunity";
  }
  return sourceKind;
}

export function selectedListJobArtifactsVariantKeys(
  input: JobArtifactListInput
): readonly ArtifactAuthorizationVariantKey[] {
  const parsed = JobArtifactListInputSchema.parse(input);
  const selected = new Set(parsed.source_kinds);
  const keys: ArtifactAuthorizationVariantKey[] = [jobVariant(parsed.job_ref)];
  for (const sourceKind of ARTIFACT_SOURCE_KINDS) {
    if (selected.has(sourceKind)) {
      keys.push(sourceVariant(sourceKind, parsed.job_ref));
    }
  }
  return Object.freeze(keys);
}

export function selectedGetJobArtifactEvidenceVariantKeys(
  input: GetJobArtifactEvidenceInput
): readonly ArtifactAuthorizationVariantKey[] {
  const parsed = GetJobArtifactEvidenceInputSchema.parse(input);
  return Object.freeze([
    jobVariant(parsed.job_ref),
    sourceVariant(parsed.source_kind, parsed.job_ref),
  ]);
}

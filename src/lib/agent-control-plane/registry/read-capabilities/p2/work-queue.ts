import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  ListWorkQueueInputSchema,
  WORK_QUEUE_MAX_PAGE_ITEMS,
  WORK_QUEUE_SCHEMA_REVISION,
  WORK_QUEUE_SOURCES,
  normalizeWorkQueueSelections,
  type ListWorkQueueInput,
  type WorkQueueSource,
} from "@/lib/agent-control-plane/contracts/work-queue";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const WORK_QUEUE_AUTHORIZATION_VARIANT_KEYS = WORK_QUEUE_SOURCES;
export type WorkQueueAuthorizationVariantKey =
  (typeof WORK_QUEUE_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permission: CapabilityPermissionRequirement["permission"],
  allowedScopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission,
    allowedScopes: Object.freeze([...allowedScopes]),
  });
}
function selector(source: WorkQueueSource): CapabilityAuthorizationSelector {
  return {
    kind: "work_queue_source",
    field: "sources",
    value: source,
    defaultWhenOmitted: true,
  } as unknown as CapabilityAuthorizationSelector;
}
const correspondenceGroups = Object.freeze([
  Object.freeze([
    permission("email.view", ["all", "own"]),
    permission("inbox.view", ["all", "assigned", "own"]),
    permission("pipeline.view", ["all", "assigned"]),
  ]),
]);
const matchReviewGroups = Object.freeze([
  Object.freeze([
    permission("email.view", ["all", "own"]),
    permission("inbox.view", ["all", "assigned", "own"]),
    permission("pipeline.view", ["all", "assigned"]),
    permission("projects.view", ["all", "assigned"]),
  ]),
]);
const variants = [
  {
    key: "task",
    requiredOAuthScopes: ["ops.operations.read", "ops.tasks.read"],
    permissionRequirementGroups: [
      [
        permission("tasks.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
      ],
    ],
  },
  {
    key: "lead",
    requiredOAuthScopes: ["ops.jobs.read", "ops.operations.read"],
    permissionRequirementGroups: [
      [permission("pipeline.view", ["all", "assigned"])],
    ],
  },
  {
    key: "correspondence",
    requiredOAuthScopes: ["ops.correspondence.read", "ops.operations.read"],
    permissionRequirementGroups: correspondenceGroups,
  },
  {
    key: "commitment",
    requiredOAuthScopes: ["ops.correspondence.read", "ops.operations.read"],
    permissionRequirementGroups: correspondenceGroups,
  },
  {
    key: "match_review",
    requiredOAuthScopes: ["ops.correspondence.read", "ops.operations.read"],
    permissionRequirementGroups: matchReviewGroups,
  },
  {
    key: "schedule",
    requiredOAuthScopes: ["ops.operations.read", "ops.schedule.read"],
    permissionRequirementGroups: [
      [
        permission("calendar.view", ["all", "own"]),
        permission("tasks.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
      ],
    ],
  },
  {
    key: "financial_document",
    requiredOAuthScopes: [
      "ops.financial_documents.read",
      "ops.operations.read",
    ],
    permissionRequirementGroups: [
      [
        permission("estimates.view", ["all", "assigned"]),
        permission("invoices.view", ["all", "assigned"]),
        permission("pipeline.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
        permission("projects.view_financials", ["all"]),
      ],
    ],
  },
  {
    key: "payment",
    requiredOAuthScopes: ["ops.operations.read", "ops.payments.read"],
    permissionRequirementGroups: [
      [
        permission("finances.view", ["all"]),
        permission("invoices.view", ["all", "assigned"]),
        permission("pipeline.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
      ],
    ],
  },
  {
    key: "expense",
    requiredOAuthScopes: ["ops.expenses.read", "ops.operations.read"],
    permissionRequirementGroups: [
      [
        permission("expenses.approve", ["all", "assigned"]),
        permission("expenses.view", ["all"]),
      ],
      [permission("expenses.view", ["all", "own"])],
    ],
  },
] as const;

const DEFINITION = {
  name: "list_work_queue",
  schemaRevision: WORK_QUEUE_SCHEMA_REVISION,
  operation: "read",
  description:
    "List one bounded actor-visible queue of independently authorized operational attention cards.",
  inputSchema: ListWorkQueueInputSchema,
  authorization: {
    variants: variants.map((variant) => ({
      ...variant,
      selector: selector(variant.key),
    })),
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: WORK_QUEUE_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: WORK_QUEUE_MAX_PAGE_ITEMS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "sensitive_read",
  rateLimitBucket: "evidence_search",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: { kind: "not_required" },
  idempotencyPolicy: { kind: "inherent" },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.list_work_queue",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_WORK_QUEUE_CANDIDATE = mintP2CandidateCapability(DEFINITION);

export function selectedWorkQueueVariantKeys(
  input: ListWorkQueueInput | unknown
): readonly WorkQueueAuthorizationVariantKey[] {
  return Object.freeze(
    normalizeWorkQueueSelections(input).map(({ source }) => source)
  );
}

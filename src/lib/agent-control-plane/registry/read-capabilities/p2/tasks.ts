import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  GetTaskContextInputSchema,
  ListTasksInputSchema,
  TASK_READ_MAX_PAGE_ITEMS,
  TASK_READ_SCHEMA_REVISION,
  type GetTaskContextInput,
  type ListTasksInput,
} from "@/lib/agent-control-plane/contracts/tasks";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const LIST_TASKS_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "base",
  "schedule",
] as const);
export type ListTasksAuthorizationVariantKey =
  (typeof LIST_TASKS_AUTHORIZATION_VARIANT_KEYS)[number];

export const GET_TASK_CONTEXT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "base",
  "financial_origin",
  "schedule",
] as const);
export type GetTaskContextAuthorizationVariantKey =
  (typeof GET_TASK_CONTEXT_AUTHORIZATION_VARIANT_KEYS)[number];

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
// records are deliberately dark until that owner freezes the v8 vocabulary.
function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

const BASE_PERMISSIONS = Object.freeze([
  permission("tasks.view", ["all", "assigned"]),
  permission("projects.view", ["all", "assigned"]),
]);
const SCHEDULE_PERMISSIONS = Object.freeze([
  ...BASE_PERMISSIONS,
  permission("calendar.view", ["all", "own"]),
]);
const FINANCIAL_ORIGIN_PERMISSIONS = Object.freeze([
  ...BASE_PERMISSIONS,
  permission("estimates.view", ["all", "assigned"]),
  permission("projects.view_financials", ["all"]),
]);

const LIST_DEFINITION = {
  name: "list_tasks",
  schemaRevision: TASK_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "List bounded current project tasks through one closed operational view with safe assignment and schedule summaries.",
  inputSchema: ListTasksInputSchema,
  authorization: {
    variants: [
      {
        key: "base",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.tasks.read"],
        permissionRequirementGroups: [BASE_PERMISSIONS],
      },
      {
        key: "schedule",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "view",
          discriminator: "kind",
          value: "schedule_window",
        }),
        requiredOAuthScopes: ["ops.schedule.read", "ops.tasks.read"],
        permissionRequirementGroups: [SCHEDULE_PERMISSIONS],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: TASK_READ_MAX_PAGE_ITEMS,
    maxWindowDays: 90,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: TASK_READ_MAX_PAGE_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.list_tasks",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

const DETAIL_DEFINITION = {
  name: "get_task_context",
  schemaRevision: TASK_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one exact current task with selected dependencies, readiness, evidence, schedule, notes, and authorized financial origin.",
  inputSchema: GetTaskContextInputSchema,
  authorization: {
    variants: [
      {
        key: "base",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.tasks.read"],
        permissionRequirementGroups: [BASE_PERMISSIONS],
      },
      {
        key: "financial_origin",
        selector: pendingSelector({
          kind: "input_array_contains",
          field: "sections",
          value: "financial_origin",
        }),
        requiredOAuthScopes: ["ops.financial_documents.read", "ops.tasks.read"],
        permissionRequirementGroups: [FINANCIAL_ORIGIN_PERMISSIONS],
      },
      {
        key: "schedule",
        selector: pendingSelector({
          kind: "input_array_contains",
          field: "sections",
          value: "schedule",
        }),
        requiredOAuthScopes: ["ops.schedule.read", "ops.tasks.read"],
        permissionRequirementGroups: [SCHEDULE_PERMISSIONS],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 60_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: 1,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "sensitive_read",
  rateLimitBucket: "lightweight_read",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: { kind: "not_required" },
  idempotencyPolicy: { kind: "inherent" },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.get_task_context",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_TASKS_CANDIDATE = mintP2CandidateCapability(LIST_DEFINITION);
export const GET_TASK_CONTEXT_CANDIDATE =
  mintP2CandidateCapability(DETAIL_DEFINITION);

export function selectedListTasksVariantKeys(
  input: ListTasksInput
): readonly ListTasksAuthorizationVariantKey[] {
  const parsed = ListTasksInputSchema.parse(input);
  return Object.freeze(
    parsed.view.kind === "schedule_window"
      ? (["base", "schedule"] as const)
      : (["base"] as const)
  );
}

export function selectedGetTaskContextVariantKeys(
  input: GetTaskContextInput
): readonly GetTaskContextAuthorizationVariantKey[] {
  const parsed = GetTaskContextInputSchema.parse(input);
  const keys: GetTaskContextAuthorizationVariantKey[] = ["base"];
  if (parsed.sections.includes("financial_origin")) {
    keys.push("financial_origin");
  }
  if (parsed.sections.includes("schedule")) keys.push("schedule");
  return Object.freeze(keys);
}

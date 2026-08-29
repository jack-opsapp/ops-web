import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  EXPENSE_READ_MAX_PAGE_ITEMS,
  EXPENSE_READ_SCHEMA_REVISION,
  GetExpenseContextInputSchema,
  ListExpensesInputSchema,
  type GetExpenseContextInput,
  type ListExpensesInput,
} from "@/lib/agent-control-plane/contracts/expenses";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const EXPENSE_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "mine",
  "company",
  "job",
  "pending_approval",
  "reimbursement_batches",
] as const);
export type ExpenseAuthorizationVariantKey =
  (typeof EXPENSE_AUTHORIZATION_VARIANT_KEYS)[number];
export type ExpenseContextAuthorizationVariantKey = "expense";

function permission(
  permissionName: CapabilityPermissionRequirement["permission"],
  allowedScopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze([...allowedScopes]),
  });
}

function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

const VIEW_MINE = Object.freeze([
  Object.freeze([permission("expenses.view", ["all", "own"])]),
]);
const VIEW_COMPANY = Object.freeze([
  Object.freeze([permission("expenses.view", ["all"])]),
]);
const VIEW_JOB = Object.freeze([
  Object.freeze([
    permission("expenses.view", ["all", "own"]),
    permission("projects.view", ["all", "assigned"]),
  ]),
]);
const VIEW_PENDING_APPROVAL = Object.freeze([
  Object.freeze([
    permission("expenses.approve", ["all", "assigned"]),
    permission("expenses.view", ["all"]),
  ]),
]);
const VIEW_OWN_ALL_OR_APPROVAL = Object.freeze([
  Object.freeze([
    permission("expenses.approve", ["all", "assigned"]),
    permission("expenses.view", ["all"]),
  ]),
  Object.freeze([permission("expenses.view", ["all"])]),
  Object.freeze([permission("expenses.view", ["own"])]),
]);

const LIST_DEFINITION = {
  name: "list_expenses",
  schemaRevision: EXPENSE_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "List bounded visible expenses or reimbursement batches with safe money, category, allocation, and payout state.",
  inputSchema: ListExpensesInputSchema,
  authorization: {
    variants: [
      {
        key: "mine",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "view",
          discriminator: "kind",
          value: "mine",
        }),
        requiredOAuthScopes: ["ops.expenses.read"],
        permissionRequirementGroups: VIEW_MINE,
      },
      {
        key: "company",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "view",
          discriminator: "kind",
          value: "company",
        }),
        requiredOAuthScopes: ["ops.expenses.read"],
        permissionRequirementGroups: VIEW_COMPANY,
      },
      {
        key: "job",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "view",
          discriminator: "kind",
          value: "job",
        }),
        requiredOAuthScopes: ["ops.expenses.read", "ops.jobs.read"],
        permissionRequirementGroups: VIEW_JOB,
      },
      {
        key: "pending_approval",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "view",
          discriminator: "kind",
          value: "pending_approval",
        }),
        requiredOAuthScopes: ["ops.expenses.read"],
        permissionRequirementGroups: VIEW_PENDING_APPROVAL,
      },
      {
        key: "reimbursement_batches",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "view",
          discriminator: "kind",
          value: "reimbursement_batches",
        }),
        requiredOAuthScopes: ["ops.expenses.read"],
        permissionRequirementGroups: VIEW_OWN_ALL_OR_APPROVAL,
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: EXPENSE_READ_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: EXPENSE_READ_MAX_PAGE_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.list_expenses",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

const CONTEXT_DEFINITION = {
  name: "get_expense_context",
  schemaRevision: EXPENSE_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one exact visible expense with safe allocation, reimbursement, and bounded review context.",
  inputSchema: GetExpenseContextInputSchema,
  authorization: {
    variants: [
      {
        key: "expense",
        selector: pendingSelector({
          kind: "input_object_discriminator",
          field: "expense_ref",
          discriminator: "kind",
          value: "expense",
        }),
        requiredOAuthScopes: ["ops.expenses.read"],
        permissionRequirementGroups: VIEW_OWN_ALL_OR_APPROVAL,
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
  rolloutFlag: "agent_control_plane.capability.get_expense_context",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_EXPENSES_CANDIDATE =
  mintP2CandidateCapability(LIST_DEFINITION);
export const GET_EXPENSE_CONTEXT_CANDIDATE =
  mintP2CandidateCapability(CONTEXT_DEFINITION);

export function selectedListExpensesVariantKeys(
  input: ListExpensesInput | unknown
): readonly [ExpenseAuthorizationVariantKey] {
  const parsed = ListExpensesInputSchema.parse(input);
  return Object.freeze([parsed.view.kind]);
}

export function selectedGetExpenseContextVariantKeys(
  input: GetExpenseContextInput | unknown
): readonly [ExpenseContextAuthorizationVariantKey] {
  GetExpenseContextInputSchema.parse(input);
  return Object.freeze(["expense"]);
}

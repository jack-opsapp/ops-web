import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CUSTOMER_CONTEXT_SCHEMA_REVISION,
  CustomerContextInputSchema,
  type CustomerContextInput,
} from "@/lib/agent-control-plane/contracts/customer-context";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const CUSTOMER_CONTEXT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "base",
  "contacts",
  "jobs_opportunity",
  "jobs_project",
] as const);
export type CustomerContextAuthorizationVariantKey =
  (typeof CUSTOMER_CONTEXT_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permissionName: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze(["all", "assigned"] as const),
  });
}

// Task 25 owns the shared selector vocabulary. These closed selector records
// are frozen here now so the eventual v8 aggregation can adopt their exact
// bytes without this dark implementation mutating the shared registry.
function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

const DEFINITION = {
  name: "get_customer_context",
  schemaRevision: CUSTOMER_CONTEXT_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return selected current profile, contact, preference, duplicate, notes, and visible-job summary context for one exact customer reference.",
  inputSchema: CustomerContextInputSchema,
  authorization: {
    variants: [
      {
        key: "base",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.customers.read"],
        permissionRequirementGroups: [[permission("clients.view")]],
      },
      {
        key: "contacts",
        selector: pendingSelector({
          kind: "input_array_contains",
          field: "sections",
          value: "contacts",
        }),
        requiredOAuthScopes: [
          "ops.customer_contacts.read",
          "ops.customers.read",
        ],
        permissionRequirementGroups: [[permission("clients.view")]],
      },
      {
        key: "jobs_opportunity",
        selector: pendingSelector({
          kind: "input_array_contains",
          field: "job_kinds",
          value: "opportunity",
        }),
        requiredOAuthScopes: ["ops.customers.read", "ops.jobs.read"],
        permissionRequirementGroups: [
          [permission("clients.view"), permission("pipeline.view")],
        ],
      },
      {
        key: "jobs_project",
        selector: pendingSelector({
          kind: "input_array_contains",
          field: "job_kinds",
          value: "project",
        }),
        requiredOAuthScopes: ["ops.customers.read", "ops.jobs.read"],
        permissionRequirementGroups: [
          [permission("clients.view"), permission("projects.view")],
        ],
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
    maxEvidenceRefs: 0,
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
  rolloutFlag: "agent_control_plane.capability.get_customer_context",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const CUSTOMER_CONTEXT_CANDIDATE = mintP2CandidateCapability(DEFINITION);

export function selectedCustomerContextVariantKeys(
  input: CustomerContextInput
): readonly CustomerContextAuthorizationVariantKey[] {
  const parsed = CustomerContextInputSchema.parse(input);
  const keys: CustomerContextAuthorizationVariantKey[] = ["base"];
  if (parsed.sections.includes("contacts")) keys.push("contacts");
  if (parsed.job_kinds?.includes("opportunity")) {
    keys.push("jobs_opportunity");
  }
  if (parsed.job_kinds?.includes("project")) keys.push("jobs_project");
  return Object.freeze(keys);
}

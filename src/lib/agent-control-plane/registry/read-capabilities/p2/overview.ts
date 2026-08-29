import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  GetOperationalOverviewInputSchema,
  OPERATIONAL_OVERVIEW_COMPONENTS,
  OPERATIONAL_OVERVIEW_MAX_COMPONENTS,
  OPERATIONAL_OVERVIEW_SCHEMA_REVISION,
  normalizeOperationalOverviewSelections,
  type GetOperationalOverviewInput,
  type OperationalOverviewComponent,
} from "@/lib/agent-control-plane/contracts/operational-overview";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const OPERATIONAL_OVERVIEW_AUTHORIZATION_VARIANT_KEYS =
  OPERATIONAL_OVERVIEW_COMPONENTS;
export type OperationalOverviewAuthorizationVariantKey =
  (typeof OPERATIONAL_OVERVIEW_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  name: CapabilityPermissionRequirement["permission"],
  scopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze([...scopes]),
  });
}

// Task 25 owns the shared selector vocabulary. Omitted input selects all six
// defaults; explicit input selects only matching components.
function componentSelector(
  component: OperationalOverviewComponent
): CapabilityAuthorizationSelector {
  return Object.freeze({
    kind: "operational_overview_component",
    field: "components",
    value: component,
    defaultWhenOmitted: true,
  }) as unknown as CapabilityAuthorizationSelector;
}

const VARIANTS = [
  {
    key: "financial_attention",
    selector: componentSelector("financial_attention"),
    requiredOAuthScopes: [
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.operations.read",
      "ops.payments.read",
    ],
    permissionRequirementGroups: [
      [
        permission("estimates.view", ["all", "assigned"]),
        permission("expenses.approve", ["all", "assigned"]),
        permission("expenses.view", ["all"]),
        permission("finances.view", ["all"]),
        permission("invoices.view", ["all", "assigned"]),
        permission("pipeline.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
        permission("reports.view", ["all"]),
      ],
    ],
  },
  {
    key: "integration_attention",
    selector: componentSelector("integration_attention"),
    requiredOAuthScopes: ["ops.integrations.read", "ops.operations.read"],
    permissionRequirementGroups: [
      [
        permission("accounting.view", ["all"]),
        permission("email.view", ["all", "own"]),
        permission("reports.view", ["all"]),
        permission("settings.integrations", ["all"]),
      ],
    ],
  },
  {
    key: "schedule_readiness",
    selector: componentSelector("schedule_readiness"),
    requiredOAuthScopes: [
      "ops.operations.read",
      "ops.schedule.read",
      "ops.tasks.read",
    ],
    permissionRequirementGroups: [
      [
        permission("calendar.view", ["all", "own"]),
        permission("projects.view", ["all", "assigned"]),
        permission("reports.view", ["all"]),
        permission("tasks.view", ["all", "assigned"]),
      ],
    ],
  },
  {
    key: "stock_attention",
    selector: componentSelector("stock_attention"),
    requiredOAuthScopes: [
      "ops.catalog.read",
      "ops.operations.read",
      "ops.purchasing.read",
    ],
    permissionRequirementGroups: [
      [
        permission("catalog.orders.view", ["all"]),
        permission("catalog.products.view", ["all"]),
        permission("catalog.view", ["all"]),
        permission("reports.view", ["all"]),
      ],
    ],
  },
  {
    key: "unresolved_correspondence",
    selector: componentSelector("unresolved_correspondence"),
    requiredOAuthScopes: ["ops.correspondence.read", "ops.operations.read"],
    permissionRequirementGroups: [
      [
        permission("email.view", ["all", "own"]),
        permission("inbox.view", ["all", "assigned", "own"]),
        permission("pipeline.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
        permission("reports.view", ["all"]),
      ],
    ],
  },
  {
    key: "work_due",
    selector: componentSelector("work_due"),
    requiredOAuthScopes: [
      "ops.jobs.read",
      "ops.operations.read",
      "ops.tasks.read",
    ],
    permissionRequirementGroups: [
      [
        permission("pipeline.view", ["all", "assigned"]),
        permission("projects.view", ["all", "assigned"]),
        permission("reports.view", ["all"]),
        permission("tasks.view", ["all", "assigned"]),
      ],
    ],
  },
] as const;

const DEFINITION = {
  name: "get_operational_overview",
  schemaRevision: OPERATIONAL_OVERVIEW_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one coarse bounded count and fixed health state for each independently authorized operational component.",
  inputSchema: GetOperationalOverviewInputSchema,
  authorization: { variants: VARIANTS },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 60_000,
    maxResultItems: OPERATIONAL_OVERVIEW_MAX_COMPONENTS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: OPERATIONAL_OVERVIEW_MAX_COMPONENTS,
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
  rolloutFlag: "agent_control_plane.capability.get_operational_overview",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const GET_OPERATIONAL_OVERVIEW_CANDIDATE =
  mintP2CandidateCapability(DEFINITION);

export function selectedOperationalOverviewVariantKeys(
  input: GetOperationalOverviewInput | unknown
): readonly OperationalOverviewAuthorizationVariantKey[] {
  const selections = normalizeOperationalOverviewSelections(input);
  return Object.freeze(
    selections.map(
      (selection) =>
        selection.component as OperationalOverviewAuthorizationVariantKey
    )
  );
}

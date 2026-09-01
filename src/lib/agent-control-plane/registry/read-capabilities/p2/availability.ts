import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  AVAILABILITY_MAX_MEMBERS,
  AVAILABILITY_MAX_WINDOW_DAYS,
  ListTeamAvailabilityInputSchema,
  TEAM_DIRECTORY_SCHEMA_REVISION,
  type ListTeamAvailabilityInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import type { ImplementationOnlyCapabilityDefinition } from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const TEAM_AVAILABILITY_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "company",
  "self",
] as const);
export type TeamAvailabilityAuthorizationVariantKey =
  (typeof TEAM_AVAILABILITY_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  name: CapabilityPermissionRequirement["permission"],
  scopes: readonly ("all" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze([...scopes]),
  });
}

const DEFINITION = {
  name: "list_team_availability",
  schemaRevision: TEAM_DIRECTORY_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return bounded company-local daily capacity states for the active team or the current member, without calendar-event details.",
  inputSchema: ListTeamAvailabilityInputSchema,
  authorization: {
    variants: [
      {
        key: "company",
        selector: { kind: "input_value", field: "view", value: "company" },
        requiredOAuthScopes: ["ops.team.read"],
        permissionRequirementGroups: [
          [
            permission("calendar.view", ["all"]),
            permission("team.view", ["all"]),
          ],
        ],
      },
      {
        key: "self",
        selector: { kind: "input_value", field: "view", value: "self" },
        requiredOAuthScopes: ["ops.team.read"],
        permissionRequirementGroups: [
          [permission("calendar.view", ["all", "own"])],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 12_000,
    maxOutputCharacters: 60_000,
    maxResultItems: AVAILABILITY_MAX_MEMBERS,
    maxWindowDays: AVAILABILITY_MAX_WINDOW_DAYS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: AVAILABILITY_MAX_MEMBERS,
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
  rolloutFlag: "agent_control_plane.capability.list_team_availability",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_TEAM_AVAILABILITY_CANDIDATE =
  mintP2CandidateCapability(DEFINITION);

export function selectedTeamAvailabilityVariantKeys(
  input: ListTeamAvailabilityInput | unknown
): readonly TeamAvailabilityAuthorizationVariantKey[] {
  const parsed = ListTeamAvailabilityInputSchema.parse(input);
  return Object.freeze(
    parsed.view === "company" ? (["company"] as const) : (["self"] as const)
  );
}

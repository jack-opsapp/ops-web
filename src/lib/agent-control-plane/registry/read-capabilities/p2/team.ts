import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  ListTeamMembersInputSchema,
  TEAM_DIRECTORY_MAX_PAGE_ITEMS,
  TEAM_DIRECTORY_SCHEMA_REVISION,
  type ListTeamMembersInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import type { ImplementationOnlyCapabilityDefinition } from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const TEAM_DIRECTORY_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "team",
] as const);
export type TeamDirectoryAuthorizationVariantKey =
  (typeof TEAM_DIRECTORY_AUTHORIZATION_VARIANT_KEYS)[number];

function teamPermission(): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: "team.view",
    allowedScopes: Object.freeze(["all"] as const),
  });
}

const DEFINITION = {
  name: "list_team_members",
  schemaRevision: TEAM_DIRECTORY_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return the active team directory with display-only member identities.",
  inputSchema: ListTeamMembersInputSchema,
  authorization: {
    variants: [
      {
        key: "team",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.team.read"],
        permissionRequirementGroups: [[teamPermission()]],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 12_000,
    maxOutputCharacters: 60_000,
    maxResultItems: TEAM_DIRECTORY_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: TEAM_DIRECTORY_MAX_PAGE_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.list_team_members",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_TEAM_MEMBERS_CANDIDATE =
  mintP2CandidateCapability(DEFINITION);

export function selectedTeamDirectoryVariantKeys(
  input: ListTeamMembersInput | unknown
): readonly TeamDirectoryAuthorizationVariantKey[] {
  ListTeamMembersInputSchema.parse(input);
  return TEAM_DIRECTORY_AUTHORIZATION_VARIANT_KEYS;
}

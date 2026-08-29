import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  DECK_DESIGN_GEOMETRY_SCHEMA_REVISION,
  DeckDesignGeometryInputSchema,
  type DeckDesignGeometryInput,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "job_artifact_opportunity",
  "job_artifact_project",
  "site_visit_artifact_linked",
  "site_visit_artifact_unlinked",
] as const);
export type DeckDesignGeometryAuthorizationVariantKey =
  (typeof DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS)[number];

export interface DeckDesignGeometryAuthorizationSelection {
  readonly required: readonly DeckDesignGeometryAuthorizationVariantKey[];
  readonly alternatives: readonly (readonly DeckDesignGeometryAuthorizationVariantKey[])[];
}

function permission(
  permissionName: CapabilityPermissionRequirement["permission"],
  allowedScopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({ permission: permissionName, allowedScopes });
}

// Task 25 owns the shared selector vocabulary. These selectors are isolated
// with the dark v8 candidate and have no active-registry side effect.
function pendingSelector(
  value: Readonly<Record<string, unknown>>
): CapabilityAuthorizationSelector {
  return value as unknown as CapabilityAuthorizationSelector;
}

const DEFINITION = {
  name: "get_deck_design_geometry",
  schemaRevision: DECK_DESIGN_GEOMETRY_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one authorized deck design with renderable geometry and authoritative area and guard measurements.",
  inputSchema: DeckDesignGeometryInputSchema,
  authorization: {
    variants: [
      {
        key: "job_artifact_opportunity",
        selector: pendingSelector({
          kind: "input_source_and_job_kind",
          source: "job_artifact",
          jobKind: "opportunity",
        }),
        requiredOAuthScopes: ["ops.files.read", "ops.jobs.read"],
        permissionRequirementGroups: [
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all", "assigned"]),
          ],
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all", "assigned"]),
            permission("projects.view", ["all", "assigned"]),
          ],
        ],
      },
      {
        key: "job_artifact_project",
        selector: pendingSelector({
          kind: "input_source_and_job_kind",
          source: "job_artifact",
          jobKind: "project",
        }),
        requiredOAuthScopes: ["ops.files.read", "ops.jobs.read"],
        permissionRequirementGroups: [
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("projects.view", ["all", "assigned"]),
          ],
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all", "assigned"]),
            permission("projects.view", ["all", "assigned"]),
          ],
        ],
      },
      {
        key: "site_visit_artifact_linked",
        selector: pendingSelector({
          kind: "input_value",
          field: "source",
          value: "site_visit_artifact",
        }),
        requiredOAuthScopes: [
          "ops.customers.read",
          "ops.files.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [
          [
            permission("calendar.view", ["all", "own"]),
            permission("clients.view", ["all", "assigned"]),
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all", "assigned"]),
          ],
          [
            permission("calendar.view", ["all", "own"]),
            permission("clients.view", ["all", "assigned"]),
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all", "assigned"]),
            permission("projects.view", ["all", "assigned"]),
          ],
          [
            permission("calendar.view", ["all", "own"]),
            permission("clients.view", ["all", "assigned"]),
            permission("deck_builder.view", ["all"]),
            permission("pipeline.view", ["all", "assigned"]),
          ],
        ],
      },
      {
        key: "site_visit_artifact_unlinked",
        selector: pendingSelector({
          kind: "input_value",
          field: "source",
          value: "site_visit_artifact",
        }),
        requiredOAuthScopes: [
          "ops.files.read",
          "ops.jobs.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all"]),
          ],
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("pipeline.view", ["all"]),
            permission("projects.view", ["all", "assigned"]),
          ],
          [
            permission("deck_builder.view", ["all"]),
            permission("pipeline.view", ["all"]),
          ],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 1,
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
  rolloutFlag: "agent_control_plane.capability.get_deck_design_geometry",
} as const satisfies ImplementationOnlyCapabilityDefinition;

export const GET_DECK_DESIGN_GEOMETRY_CANDIDATE =
  mintP2CandidateCapability(DEFINITION);

export function selectedDeckDesignGeometryVariantKeys(
  input: DeckDesignGeometryInput
): DeckDesignGeometryAuthorizationSelection {
  const parsed = DeckDesignGeometryInputSchema.parse(input);
  if (parsed.source === "site_visit_artifact") {
    return Object.freeze({
      required: Object.freeze([]),
      alternatives: Object.freeze([
        Object.freeze(["site_visit_artifact_linked"] as const),
        Object.freeze(["site_visit_artifact_unlinked"] as const),
      ]),
    });
  }
  return Object.freeze({
    required: Object.freeze([
      parsed.job_ref.kind === "opportunity"
        ? "job_artifact_opportunity"
        : "job_artifact_project",
    ] as const),
    alternatives: Object.freeze([]),
  });
}

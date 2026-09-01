import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  GetSiteVisitContextInputSchema,
  ListSiteVisitsInputSchema,
  SITE_VISIT_HISTORY_MAX_WINDOW_DAYS,
  SITE_VISIT_READ_MAX_PAGE_ITEMS,
  SITE_VISIT_READ_SCHEMA_REVISION,
  type GetSiteVisitContextInput,
  type ListSiteVisitsInput,
} from "@/lib/agent-control-plane/contracts/site-visits";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const LIST_SITE_VISITS_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "booked_appointments",
  "visit_history",
  "unlinked_history",
] as const);
export type ListSiteVisitsAuthorizationVariantKey =
  (typeof LIST_SITE_VISITS_AUTHORIZATION_VARIANT_KEYS)[number];

export const GET_SITE_VISIT_CONTEXT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "opportunity",
  "unlinked",
  "opportunity_artifacts",
  "unlinked_artifacts",
  "opportunity_decks",
  "unlinked_decks",
] as const);
export type GetSiteVisitContextAuthorizationVariantKey =
  (typeof GET_SITE_VISIT_CONTEXT_AUTHORIZATION_VARIANT_KEYS)[number];

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
// records stay dark until that owner freezes and byte-copies the v8 aggregate.
function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

const LINKED_VISIT_PERMISSIONS = Object.freeze([
  permission("calendar.view", ["all", "own"]),
  permission("clients.view", ["all", "assigned"]),
  permission("pipeline.view", ["all", "assigned"]),
]);
const UNLINKED_VISIT_PERMISSIONS = Object.freeze([
  permission("pipeline.view", ["all"]),
]);

const LIST_DEFINITION = {
  name: "list_site_visits",
  schemaRevision: SITE_VISIT_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "List bounded visible booked appointments by booked_at or visit history by created_at without treating legacy schedule fields as booking authority.",
  inputSchema: ListSiteVisitsInputSchema,
  authorization: {
    variants: [
      {
        key: "booked_appointments",
        selector: {
          kind: "input_value",
          field: "view",
          value: "booked_appointments",
        },
        requiredOAuthScopes: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [LINKED_VISIT_PERMISSIONS],
      },
      {
        key: "visit_history",
        selector: {
          kind: "input_value",
          field: "view",
          value: "visit_history",
        },
        requiredOAuthScopes: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [LINKED_VISIT_PERMISSIONS],
      },
      {
        key: "unlinked_history",
        selector: {
          kind: "input_value",
          field: "include_unlinked",
          value: true,
        },
        requiredOAuthScopes: ["ops.jobs.read", "ops.site_visits.read"],
        permissionRequirementGroups: [UNLINKED_VISIT_PERMISSIONS],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: SITE_VISIT_READ_MAX_PAGE_ITEMS,
    maxWindowDays: SITE_VISIT_HISTORY_MAX_WINDOW_DAYS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: SITE_VISIT_READ_MAX_PAGE_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.list_site_visits",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

const CONTEXT_DEFINITION = {
  name: "get_site_visit_context",
  schemaRevision: SITE_VISIT_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one exact visible visit with selected safe booking, lead, checklist, artifact, deck-reference, measurement, notes, and timeline context.",
  inputSchema: GetSiteVisitContextInputSchema,
  authorization: {
    variants: [
      {
        key: "opportunity",
        selector: {
          kind: "input_value",
          field: "anchor",
          value: "opportunity",
        },
        requiredOAuthScopes: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [LINKED_VISIT_PERMISSIONS],
      },
      {
        key: "unlinked",
        selector: {
          kind: "input_value",
          field: "anchor",
          value: "unlinked",
        },
        requiredOAuthScopes: ["ops.jobs.read", "ops.site_visits.read"],
        permissionRequirementGroups: [UNLINKED_VISIT_PERMISSIONS],
      },
      {
        key: "opportunity_artifacts",
        selector: pendingSelector({
          kind: "site_visit_context_artifact_sections",
          anchor: "opportunity",
          field: "sections",
          values: ["artifact_summary"],
        }),
        requiredOAuthScopes: ["ops.files.read", "ops.site_visits.read"],
        permissionRequirementGroups: [
          [permission("photos.view", ["all", "assigned"])],
        ],
      },
      {
        key: "unlinked_artifacts",
        selector: pendingSelector({
          kind: "site_visit_context_artifact_sections",
          anchor: "unlinked",
          field: "sections",
          values: ["artifact_summary"],
        }),
        requiredOAuthScopes: ["ops.files.read", "ops.site_visits.read"],
        permissionRequirementGroups: [[permission("photos.view", ["all"])]],
      },
      {
        key: "opportunity_decks",
        selector: pendingSelector({
          kind: "site_visit_context_artifact_sections",
          anchor: "opportunity",
          field: "sections",
          values: ["deck_design_refs"],
        }),
        requiredOAuthScopes: [
          "ops.files.read",
          "ops.jobs.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [
          [
            permission("deck_builder.view", ["all", "assigned"]),
            permission("photos.view", ["all", "assigned"]),
          ],
        ],
      },
      {
        key: "unlinked_decks",
        selector: pendingSelector({
          kind: "site_visit_context_artifact_sections",
          anchor: "unlinked",
          field: "sections",
          values: ["deck_design_refs"],
        }),
        requiredOAuthScopes: [
          "ops.files.read",
          "ops.jobs.read",
          "ops.site_visits.read",
        ],
        permissionRequirementGroups: [
          [
            permission("deck_builder.view", ["all"]),
            permission("photos.view", ["all"]),
          ],
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
    maxEvidenceRefs: 1,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "evidence_read",
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
  rolloutFlag: "agent_control_plane.capability.get_site_visit_context",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_SITE_VISITS_CANDIDATE =
  mintP2CandidateCapability(LIST_DEFINITION);
export const GET_SITE_VISIT_CONTEXT_CANDIDATE =
  mintP2CandidateCapability(CONTEXT_DEFINITION);

export function selectedListSiteVisitsVariantKeys(
  input: ListSiteVisitsInput
): readonly ListSiteVisitsAuthorizationVariantKey[] {
  const parsed = ListSiteVisitsInputSchema.parse(input);
  if (parsed.view === "booked_appointments") {
    return Object.freeze(["booked_appointments"] as const);
  }
  return Object.freeze(
    parsed.include_unlinked
      ? (["visit_history", "unlinked_history"] as const)
      : (["visit_history"] as const)
  );
}

export function selectedGetSiteVisitContextVariantKeys(
  input: GetSiteVisitContextInput
): readonly GetSiteVisitContextAuthorizationVariantKey[] {
  const parsed = GetSiteVisitContextInputSchema.parse(input);
  const keys: GetSiteVisitContextAuthorizationVariantKey[] = [parsed.anchor];
  if (parsed.sections.includes("artifact_summary")) {
    keys.push(
      parsed.anchor === "opportunity"
        ? "opportunity_artifacts"
        : "unlinked_artifacts"
    );
  }
  if (parsed.sections.includes("deck_design_refs")) {
    keys.push(
      parsed.anchor === "opportunity" ? "opportunity_decks" : "unlinked_decks"
    );
  }
  return Object.freeze(keys);
}

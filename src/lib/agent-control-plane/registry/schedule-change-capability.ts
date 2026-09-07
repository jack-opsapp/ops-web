import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CommitScheduleChangeInputSchema,
  SCHEDULE_CHANGE_SCHEMA_REVISION,
  PrepareScheduleChangeInputSchema,
} from "@/lib/agent-control-plane/contracts/schedule-change";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

const AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "owner_schedule_change",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.jobs.read", "ops.schedule.prepare", "ops.schedule.read",
        "ops.site_visits.read", "ops.tasks.read", "ops.team.read",
      ]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([
          permission("agent.review"),
          permission("calendar.edit"),
          permission("calendar.view"),
          permission("projects.view"),
          permission("tasks.assign"),
          permission("tasks.edit"),
          permission("tasks.view"),
          permission("team.view"),
        ]),
      ]),
    }),
  ]),
});

export const PREPARE_SCHEDULE_CHANGE_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_schedule_change",
  schemaRevision: SCHEDULE_CHANGE_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "schedule_change",
  description:
    "Prepare exact date and crew changes for 1–25 existing task occurrences. Resolves every included scope, checks recorded OPS availability and crew experience, and shows confirmation clearing, internal notifications and project crew rollups. Requires the named actor to approve the complete preview inside OPS. Sends no customer messages; external calendar synchronization remains unknown.",
  inputSchema: PrepareScheduleChangeInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 65_536,
    maxOutputCharacters: 262_144,
    maxResultItems: 25,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 25,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_prepare",
  rateLimitBucket: "prepare",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "change_set_preview",
    exactPreviewRequired: true,
    expires: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.prepare_schedule_change",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_SCHEDULE_CHANGE_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_schedule_change",
  schemaRevision: SCHEDULE_CHANGE_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "schedule_change",
  description:
    "Apply the exact task dates and crew approved inside OPS after current authority, policy, timezone and availability revalidation; return the independently checked receipt.",
  inputSchema: CommitScheduleChangeInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 65_536,
    maxOutputCharacters: 262_144,
    maxResultItems: 25,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: 25,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_commit",
  rateLimitBucket: "commit",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "confirmation_receipt",
    prepareCapability: "prepare_schedule_change",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_schedule_change",
} as const satisfies ImplementationOnlyCapabilityDefinition);

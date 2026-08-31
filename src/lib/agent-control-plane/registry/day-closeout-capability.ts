import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  DAY_CLOSEOUT_MAX_EVIDENCE_REFS,
  DAY_CLOSEOUT_MAX_FINDINGS,
  DAY_CLOSEOUT_SCHEMA_REVISION,
  CommitDayCloseoutInputSchema,
  PrepareDayCloseoutInputSchema,
} from "@/lib/agent-control-plane/contracts/day-closeout";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"],
  scopes: CapabilityPermissionRequirement["allowedScopes"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze([...scopes]),
  });
}

export const DAY_CLOSEOUT_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_day_closeout",
  schemaRevision: DAY_CLOSEOUT_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "day_closeout",
  description:
    "Prepare one server-defined end-of-day closeout with tomorrow readiness, due work, stalled leads, outstanding invoices, mail coverage, and an exact OPS filing preview. Sends nothing and moves no money.",
  inputSchema: PrepareDayCloseoutInputSchema,
  authorization: {
    variants: [
      {
        key: "owner_day_closeout",
        selector: { kind: "always" },
        requiredOAuthScopes: [
          "ops.correspondence.read",
          "ops.financial_documents.read",
          "ops.jobs.read",
          "ops.operations.prepare",
          "ops.operations.read",
          "ops.schedule.read",
          "ops.tasks.read",
        ],
        permissionRequirementGroups: [
          [
            permission("calendar.view", ["all"]),
            permission("email.view", ["all"]),
            permission("invoices.view", ["all"]),
            permission("pipeline.view", ["all"]),
            permission("projects.view", ["all"]),
            permission("reports.view", ["all"]),
            permission("tasks.view", ["all"]),
          ],
        ],
      },
    ],
  },
  riskTier: "medium",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 120_000,
    maxResultItems: DAY_CLOSEOUT_MAX_FINDINGS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: DAY_CLOSEOUT_MAX_EVIDENCE_REFS,
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
  rolloutFlag: "agent_control_plane.capability.prepare_day_closeout",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_DAY_CLOSEOUT_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_day_closeout",
  schemaRevision: DAY_CLOSEOUT_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "day_closeout",
  description:
    "File one previously prepared day closeout inside OPS after an exact, single-use confirmation. Sends nothing and moves no money.",
  inputSchema: CommitDayCloseoutInputSchema,
  authorization: DAY_CLOSEOUT_CAPABILITY_DEFINITION.authorization,
  riskTier: "medium",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 20_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: DAY_CLOSEOUT_MAX_EVIDENCE_REFS,
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
    prepareCapability: "prepare_day_closeout",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_day_closeout",
} as const satisfies ImplementationOnlyCapabilityDefinition);

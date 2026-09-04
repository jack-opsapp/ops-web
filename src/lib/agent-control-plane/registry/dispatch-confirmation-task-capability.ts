import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CommitDispatchConfirmationTaskInputSchema,
  DISPATCH_CONFIRMATION_TASK_SCHEMA_REVISION,
  PrepareDispatchConfirmationTaskInputSchema,
} from "@/lib/agent-control-plane/contracts/dispatch-confirmation-task";
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
      key: "owner_dispatch_confirmation_task",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.company.read",
        "ops.jobs.read",
        "ops.operations.prepare",
        "ops.operations.read",
        "ops.schedule.read",
        "ops.tasks.read",
      ]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([
          permission("agent.review"),
          permission("projects.view"),
          permission("tasks.assign"),
          permission("tasks.create"),
          permission("tasks.view"),
        ]),
      ]),
    }),
  ]),
});

export const PREPARE_DISPATCH_CONFIRMATION_TASK_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "prepare_dispatch_confirmation_task",
    schemaRevision: DISPATCH_CONFIRMATION_TASK_SCHEMA_REVISION,
    operation: "prepare",
    writeFamily: "dispatch_confirmation_task",
    description:
      "Validate one current unacknowledged dispatch against the company's exact active policy and prepare one immutable internal follow-up task for explicit approval. Creates or updates nothing, changes no assignment, sends no message, moves no money, and issues no financial document.",
    inputSchema: PrepareDispatchConfirmationTaskInputSchema,
    authorization: AUTHORIZATION,
    riskTier: "high",
    bounds: {
      maxInputBytes: 4_096,
      maxOutputCharacters: 24_000,
      maxResultItems: 1,
    },
    evidencePolicy: {
      input: "required",
      output: "required",
      maxEvidenceRefs: 3,
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
    rolloutFlag:
      "agent_control_plane.capability.prepare_dispatch_confirmation_task",
  } as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_DISPATCH_CONFIRMATION_TASK_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "commit_dispatch_confirmation_task",
    schemaRevision: DISPATCH_CONFIRMATION_TASK_SCHEMA_REVISION,
    operation: "commit",
    writeFamily: "dispatch_confirmation_task",
    description:
      "Commit one exact approved dispatch-confirmation task inside OPS after revalidating policy, evidence, source version, tenant, actor, grant, scopes, and permissions. Sends no message, moves no money, and issues no financial document.",
    inputSchema: CommitDispatchConfirmationTaskInputSchema,
    authorization: AUTHORIZATION,
    riskTier: "high",
    bounds: {
      maxInputBytes: 4_096,
      maxOutputCharacters: 8_000,
      maxResultItems: 1,
    },
    evidencePolicy: {
      input: "prepared_change_set",
      output: "required",
      maxEvidenceRefs: 3,
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
      prepareCapability: "prepare_dispatch_confirmation_task",
      exactPreviewRequired: true,
      singleUse: true,
    },
    idempotencyPolicy: {
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    },
    availability: { implementation: "available" },
    rolloutFlag:
      "agent_control_plane.capability.commit_dispatch_confirmation_task",
  } as const satisfies ImplementationOnlyCapabilityDefinition);

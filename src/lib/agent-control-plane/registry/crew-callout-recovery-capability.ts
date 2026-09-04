import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CREW_CALLOUT_RECOVERY_MAX_EVIDENCE_REFS,
  CREW_CALLOUT_RECOVERY_MAX_ITEMS,
  CREW_CALLOUT_RECOVERY_MAX_OUTPUT_CHARACTERS,
  CREW_CALLOUT_RECOVERY_SCHEMA_REVISION,
  PrepareCrewCalloutRecoveryInputSchema,
} from "@/lib/agent-control-plane/contracts/crew-callout-recovery";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const PREPARE_CREW_CALLOUT_RECOVERY_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "prepare_crew_callout_recovery",
    schemaRevision: CREW_CALLOUT_RECOVERY_SCHEMA_REVISION,
    operation: "prepare",
    writeFamily: "crew_callout_recovery",
    description:
      "Resolve one exact current crew member and company-local date, identify every affected authorized task, site visit, and project, evaluate current roles, same-task history, working hours, time off, and schedule conflicts, then prepare the smallest provable reassignment or reschedule plan with exact-recipient draft previews. Returns explicit uncovered work and qualification limits. Changes no assignment, schedule, calendar event, OPS/provider draft, message, or delivery state, and sends nothing. Ordinary transport audit and rate-limit metadata is still recorded.",
    inputSchema: PrepareCrewCalloutRecoveryInputSchema,
    authorization: {
      variants: [
        {
          key: "owner_crew_callout_recovery",
          selector: { kind: "always" },
          requiredOAuthScopes: [
            "ops.communications.prepare",
            "ops.company.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
            "ops.schedule.prepare",
            "ops.schedule.read",
            "ops.site_visits.read",
            "ops.tasks.read",
            "ops.team.read",
          ],
          permissionRequirementGroups: [
            [
              permission("calendar.edit"),
              permission("calendar.view"),
              permission("clients.view"),
              permission("inbox.send"),
              permission("inbox.view"),
              permission("projects.edit"),
              permission("projects.view"),
              permission("tasks.assign"),
              permission("tasks.edit"),
              permission("tasks.view"),
              permission("team.view"),
            ],
          ],
        },
      ],
    },
    riskTier: "high",
    bounds: {
      maxInputBytes: 384,
      maxOutputCharacters: CREW_CALLOUT_RECOVERY_MAX_OUTPUT_CHARACTERS,
      maxResultItems: CREW_CALLOUT_RECOVERY_MAX_ITEMS,
      maxBatchItems: CREW_CALLOUT_RECOVERY_MAX_ITEMS,
    },
    evidencePolicy: {
      input: "not_required",
      output: "required",
      maxEvidenceRefs: CREW_CALLOUT_RECOVERY_MAX_EVIDENCE_REFS,
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
    idempotencyPolicy: { kind: "inherent" },
    availability: { implementation: "available" },
    rolloutFlag: "agent_control_plane.capability.prepare_crew_callout_recovery",
  } as const satisfies ImplementationOnlyCapabilityDefinition);

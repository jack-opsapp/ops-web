import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  PrepareWeatherRescheduleInputSchema,
  WEATHER_RESCHEDULE_MAX_EVIDENCE_REFS,
  WEATHER_RESCHEDULE_MAX_OUTPUT_CHARACTERS,
  WEATHER_RESCHEDULE_MAX_TASKS,
  WEATHER_RESCHEDULE_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/weather-reschedule";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const PREPARE_WEATHER_RESCHEDULE_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_weather_reschedule",
  schemaRevision: WEATHER_RESCHEDULE_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "weather_reschedule",
  description:
    "Prepare an exact weather-bound schedule proposal for one company-local date. Uses current OPS schedule, explicit outdoor task types, fresh project forecasts, crew and project conflicts, and exact client recipients. Returns a proposal plus recipient-bound email drafts. Changes no project, task, calendar event, provider draft, message, or delivery state, and sends nothing. Ordinary transport audit and rate-limit metadata is still recorded.",
  inputSchema: PrepareWeatherRescheduleInputSchema,
  authorization: {
    variants: [
      {
        key: "owner_weather_reschedule",
        selector: { kind: "always" },
        requiredOAuthScopes: [
          "ops.company.read",
          "ops.communications.prepare",
          "ops.customer_contacts.read",
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.prepare",
          "ops.schedule.read",
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
            permission("tasks.edit"),
            permission("tasks.view"),
          ],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 128,
    maxOutputCharacters: WEATHER_RESCHEDULE_MAX_OUTPUT_CHARACTERS,
    maxResultItems: WEATHER_RESCHEDULE_MAX_TASKS,
    maxBatchItems: WEATHER_RESCHEDULE_MAX_TASKS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: WEATHER_RESCHEDULE_MAX_EVIDENCE_REFS,
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
  rolloutFlag: "agent_control_plane.capability.prepare_weather_reschedule",
} as const satisfies ImplementationOnlyCapabilityDefinition);

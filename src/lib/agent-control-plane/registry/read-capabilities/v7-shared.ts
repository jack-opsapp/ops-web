import { z } from "zod-v4";

import {
  CursorRequestSchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "@/lib/agent-control-plane/contracts/common";
import { JobRefSchema } from "@/lib/agent-control-plane/contracts/jobs";
import {
  JobReadinessIssuesInputSchema,
  ScheduledJobsInputSchema,
} from "@/lib/agent-control-plane/contracts/schedule";
import type {
  CapabilityAuthorizationVariantDefinition,
  CapabilityRiskTier,
} from "@/lib/agent-control-plane/registry/capability-types";
import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";

const DAY_MS = 86_400_000;
const MAX_PROMPT_CHARACTERS = 60_000;
const MAX_INPUT_BYTES = 32_768;
export const TASK_12_SCHEMA_REVISION = "2026-08-13.v1" as const;

const READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const DARK_AVAILABILITY = Object.freeze({
  implementation: "unavailable" as const,
  externalExposure: "disabled" as const,
});
/** Legacy v7 compatibility bytes; active rollout lives in the exposure catalogue. */
export const EXTERNAL_READ_AVAILABILITY = Object.freeze({
  implementation: "available" as const,
  externalExposure: "enabled" as const,
});
const READ_CONFIRMATION = Object.freeze({ kind: "not_required" as const });
const READ_IDEMPOTENCY = Object.freeze({ kind: "inherent" as const });

function validWindow(from: string, to: string, maximumDays: number): boolean {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return end > start && end - start <= maximumDays * DAY_MS;
}

const ConversationSectionSchema = z.enum([
  "memory",
  "recent_turns",
  "participants",
  "gaps",
  "cross_job_seed",
]);
const DatabaseUuidSchema = PostgresUuidSchema;
export const JobConversationContextInputSchema = z
  .object({
    job_ref: JobRefSchema,
    exact_turn_limit: z.number().int().min(1).max(50).default(20),
    required_through_turn_id: OpaqueIdSchema.optional(),
    sections: z
      .array(ConversationSectionSchema)
      .min(1)
      .max(5)
      .refine(
        (sections) => new Set(sections).size === sections.length,
        "Conversation sections must be unique"
      )
      .default([
        "memory",
        "recent_turns",
        "participants",
        "gaps",
        "cross_job_seed",
      ]),
  })
  .strict()
  .superRefine((input, context) => {
    if (!DatabaseUuidSchema.safeParse(input.job_ref.id).success) {
      context.addIssue({
        code: "custom",
        path: ["job_ref", "id"],
        message: "Job reference must identify a current OPS record",
      });
    }
    if (
      input.required_through_turn_id !== undefined &&
      !DatabaseUuidSchema.safeParse(input.required_through_turn_id).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["required_through_turn_id"],
        message: "Required turn must identify an immutable delivered turn",
      });
    }
  });

export type GetJobConversationContextInput = Readonly<
  z.input<typeof JobConversationContextInputSchema>
>;
export type ListScheduledJobsInput = Readonly<
  z.input<typeof ScheduledJobsInputSchema>
>;
export type JobReadinessIssuesInput = Readonly<
  z.input<typeof JobReadinessIssuesInputSchema>
>;

const SiteVisitStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);
const UniqueSiteVisitStatusesSchema = z
  .array(SiteVisitStatusSchema)
  .max(4)
  .refine(
    (statuses) => new Set(statuses).size === statuses.length,
    "Site-visit statuses must be unique"
  );
const OpportunityRefSchema = z
  .object({
    kind: z.literal("opportunity"),
    id: OpaqueIdSchema,
  })
  .strict();
const SiteVisitListFilters = {
  assignee_id: OpaqueIdSchema.optional(),
  opportunity_ref: OpportunityRefSchema.optional(),
} as const;
export const SiteVisitListInputSchema = z
  .discriminatedUnion("view", [
    CursorRequestSchema.extend({
      view: z.literal("booked_appointments"),
      from: Rfc3339UtcTimestampSchema,
      to: Rfc3339UtcTimestampSchema,
      statuses: UniqueSiteVisitStatusesSchema.default([
        "scheduled",
        "in_progress",
      ]),
      ...SiteVisitListFilters,
    }).strict(),
    CursorRequestSchema.extend({
      view: z.literal("visit_history"),
      created_from: Rfc3339UtcTimestampSchema,
      created_to: Rfc3339UtcTimestampSchema,
      statuses: UniqueSiteVisitStatusesSchema.optional(),
      include_unlinked: z.boolean().default(false),
      ...SiteVisitListFilters,
    }).strict(),
  ])
  .superRefine((input, context) => {
    const from =
      input.view === "booked_appointments" ? input.from : input.created_from;
    const to =
      input.view === "booked_appointments" ? input.to : input.created_to;
    const maximumDays = input.view === "booked_appointments" ? 90 : 365;
    if (!validWindow(from, to, maximumDays)) {
      context.addIssue({
        code: "custom",
        path: [input.view === "booked_appointments" ? "to" : "created_to"],
        message: `Site-visit window must be positive and no longer than ${maximumDays} days`,
      });
    }
  });

const SiteVisitContextFields = {
  site_visit_id: OpaqueIdSchema,
  artifact_evidence_limit: z.number().int().min(0).max(20).default(0),
  timeline_activity_limit: z.number().int().min(1).max(20).default(10),
} as const;
export const SiteVisitContextInputSchema = z.discriminatedUnion("anchor", [
  z
    .object({
      anchor: z.literal("opportunity"),
      opportunity_ref: OpportunityRefSchema,
      ...SiteVisitContextFields,
    })
    .strict(),
  z
    .object({
      anchor: z.literal("unlinked"),
      ...SiteVisitContextFields,
    })
    .strict(),
]);

type CapabilityPermissionRequirementName =
  CapabilityAuthorizationVariantDefinition["permissionRequirementGroups"][number][number]["permission"];

export function permission(
  permissionName: CapabilityPermissionRequirementName,
  allowedScopes: readonly ("all" | "assigned" | "own")[]
) {
  return { permission: permissionName, allowedScopes } as const;
}

export function jobVariant(
  key: "opportunity" | "project",
  requiredOAuthScopes: readonly string[],
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key,
    selector: { kind: "job_kind", jobKind: key },
    requiredOAuthScopes,
    permissionRequirementGroups: [requirements],
  };
}

export function sectionVariant(
  jobKind: "opportunity" | "project",
  section:
    | "schedule"
    | "readiness"
    | "participants"
    | "financials"
    | "activity"
    | "conversation",
  requiredOAuthScopes: readonly string[],
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}:${section}`,
    selector: { kind: "job_section", jobKind, section },
    requiredOAuthScopes,
    permissionRequirementGroups: [requirements],
  };
}

export function purposeVariant(
  jobKind: "opportunity" | "project",
  purpose: "schedule_notice" | "photo_request" | "general",
  requiredOAuthScopes: readonly string[],
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}:${purpose}`,
    selector: { kind: "job_purpose", jobKind, purpose },
    requiredOAuthScopes,
    permissionRequirementGroups: [requirements],
  };
}

export function participantPurposeVariant(
  jobKind: "opportunity" | "project",
  purpose: "schedule" | "assignment",
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}:${purpose}`,
    selector: { kind: "job_participant_purpose", jobKind, purpose },
    requiredOAuthScopes: ["ops.jobs.read"],
    permissionRequirementGroups: [requirements],
  };
}

export function customerJobKindVariant(
  jobKind: "opportunity" | "project",
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}_jobs`,
    selector: { kind: "customer_job_kind", jobKind },
    requiredOAuthScopes: ["ops.jobs.read"],
    permissionRequirementGroups: [requirements],
  };
}

export function customerDiscoveryVariant(
  lookup: "name" | "exact_contact",
  requiredOAuthScopes: readonly string[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: lookup,
    selector: { kind: "customer_discovery_lookup", lookup },
    requiredOAuthScopes,
    permissionRequirementGroups: [
      [permission("clients.view", ["all", "assigned"])],
    ],
  };
}

export function jobDiscoveryVariant(
  jobKind: "opportunity" | "project",
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}_jobs`,
    selector: { kind: "job_discovery_kind", jobKind },
    requiredOAuthScopes: ["ops.jobs.read"],
    permissionRequirementGroups: [requirements],
  };
}

export function summaryReadinessVariant(
  authority: "site_photos" | "customer" | "schedule",
  requiredOAuthScopes: readonly string[],
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `project:readiness:${authority}`,
    selector: { kind: "job_summary_readiness", authority },
    requiredOAuthScopes,
    permissionRequirementGroups: [requirements],
  };
}

export function summaryFinancialVariant(
  jobKind: "opportunity" | "project",
  component: "estimate_rollup" | "invoice_rollup",
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}:financials:${component}`,
    selector: {
      kind: "job_summary_financial_component",
      jobKind,
      component,
    },
    requiredOAuthScopes: ["ops.financials.read"],
    permissionRequirementGroups: [requirements],
  };
}

export function historyJobKindVariant(
  jobKind: "opportunity" | "project",
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}_jobs`,
    selector: { kind: "job_history_job_kind", jobKind },
    requiredOAuthScopes: ["ops.jobs.read"],
    permissionRequirementGroups: [requirements],
  };
}

export function historySourceVariant(
  key: "correspondence_sources" | "task_event",
  authority: "correspondence" | "task_event",
  requiredOAuthScopes: readonly string[],
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key,
    selector: { kind: "job_history_source_authority", authority },
    requiredOAuthScopes,
    permissionRequirementGroups: [requirements],
  };
}

export function historyFinancialSourceVariant(
  jobKind: "opportunity" | "project",
  requirements: readonly ReturnType<typeof permission>[]
): CapabilityAuthorizationVariantDefinition {
  return {
    key: `${jobKind}:estimate_document`,
    selector: { kind: "job_history_financial_source", jobKind },
    requiredOAuthScopes: ["ops.financials.read"],
    permissionRequirementGroups: [requirements],
  };
}

export function readMetadata(input: {
  riskTier: CapabilityRiskTier;
  maxResultItems: number;
  maxWindowDays?: number;
  evidenceInput?: "not_required" | "optional" | "required";
  auditClass?:
    | "operational_read"
    | "sensitive_read"
    | "evidence_read"
    | "search_read";
  rateLimitBucket?: "lightweight_read" | "evidence_search";
}) {
  return {
    riskTier: input.riskTier,
    bounds: {
      maxInputBytes: MAX_INPUT_BYTES,
      maxOutputCharacters: MAX_PROMPT_CHARACTERS,
      maxResultItems: input.maxResultItems,
      ...(input.maxWindowDays === undefined
        ? {}
        : { maxWindowDays: input.maxWindowDays }),
    },
    evidencePolicy: {
      input: input.evidenceInput ?? "not_required",
      output: "required" as const,
      maxEvidenceRefs: 100,
      promptSafeOutput: true as const,
      untrustedExternalContent: "structured_and_marked" as const,
    },
    auditClass: input.auditClass ?? "operational_read",
    rateLimitBucket: input.rateLimitBucket ?? "lightweight_read",
    annotations: READ_ANNOTATIONS,
    confirmationPolicy: READ_CONFIRMATION,
    idempotencyPolicy: READ_IDEMPOTENCY,
    availability: DARK_AVAILABILITY,
  } as const;
}

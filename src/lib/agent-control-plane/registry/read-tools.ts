import { z } from "zod-v4";

import {
  CursorRequestSchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "@/lib/agent-control-plane/contracts/common";
import {
  JobCommunicationContextInputSchema,
  JobParticipantsInputSchema,
} from "@/lib/agent-control-plane/contracts/communication";
import {
  CorrespondenceEvidenceReadInputSchema,
  CustomerJobsInputSchema,
  JobHistorySearchInputSchema,
  JobSummaryInputSchema,
  TASK_13_CAPABILITY_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  MAX_DISCOVERY_MATCHES,
  SearchCustomersInputSchema,
  SearchJobsInputSchema,
} from "@/lib/agent-control-plane/contracts/discovery";
import { JobRefSchema } from "@/lib/agent-control-plane/contracts/jobs";
import {
  JobReadinessIssuesInputSchema,
  ScheduledJobsInputSchema,
} from "@/lib/agent-control-plane/contracts/schedule";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import type {
  CapabilityAuthorizationVariantDefinition,
  CapabilityDefinition,
  CapabilityRiskTier,
} from "./capability-types";

const DAY_MS = 86_400_000;
const MAX_PROMPT_CHARACTERS = 60_000;
const MAX_INPUT_BYTES = 32_768;
const TASK_12_SCHEMA_REVISION = "2026-08-13.v1" as const;

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
// P1 MCP mount (2026-08-18): the nine v6 reads are externally exposed. The
// manifest constant IS the rollout control — the MCP transport registers
// exactly the entries carrying this availability.
const EXTERNAL_READ_AVAILABILITY = Object.freeze({
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
const DatabaseUuidSchema = z.string().uuid();
const JobConversationContextInputSchema = z
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
const SiteVisitListInputSchema = z
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
const SiteVisitContextInputSchema = z.discriminatedUnion("anchor", [
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

function permission(
  permissionName: CapabilityPermissionRequirementName,
  allowedScopes: readonly ("all" | "assigned" | "own")[]
) {
  return { permission: permissionName, allowedScopes } as const;
}

type CapabilityPermissionRequirementName =
  CapabilityAuthorizationVariantDefinition["permissionRequirementGroups"][number][number]["permission"];

function jobVariant(
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

function sectionVariant(
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

function purposeVariant(
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

function participantPurposeVariant(
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

function customerJobKindVariant(
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

function customerDiscoveryVariant(
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

function jobDiscoveryVariant(
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

function summaryReadinessVariant(
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

function summaryFinancialVariant(
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

function historyJobKindVariant(
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

function historySourceVariant(
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

function historyFinancialSourceVariant(
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

function readMetadata(input: {
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

export const READ_CAPABILITY_DEFINITIONS = [
  {
    name: "list_scheduled_jobs",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description: "Return scheduled job occurrences for a bounded window.",
    inputSchema: ScheduledJobsInputSchema,
    authorization: {
      variants: [
        {
          key: "schedule",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.read", "ops.schedule.read"],
          permissionRequirementGroups: [
            [
              permission("calendar.view", ["all", "own"]),
              permission("projects.view", ["all", "assigned"]),
              permission("tasks.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    ...readMetadata({ riskTier: "low", maxResultItems: 50, maxWindowDays: 90 }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.list_scheduled_jobs",
  },
  {
    name: "list_job_readiness_issues",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description: "Return current readiness issues for scheduled jobs.",
    inputSchema: JobReadinessIssuesInputSchema,
    authorization: {
      variants: [
        {
          key: "readiness_base",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.read", "ops.schedule.read"],
          permissionRequirementGroups: [
            [
              permission("calendar.view", ["all", "own"]),
              permission("projects.view", ["all", "assigned"]),
              permission("tasks.view", ["all", "assigned"]),
            ],
          ],
        },
        {
          key: "readiness_site_photos",
          selector: {
            kind: "input_array_contains",
            field: "rule_codes",
            value: "SITE_PHOTOS_MISSING",
          },
          requiredOAuthScopes: ["ops.photos.read"],
          permissionRequirementGroups: [
            [permission("photos.view", ["all", "assigned"])],
          ],
        },
        {
          key: "readiness_customer",
          selector: {
            kind: "input_array_contains",
            field: "rule_codes",
            value: "CUSTOMER_RECORD_UNRESOLVED",
          },
          requiredOAuthScopes: ["ops.customers.read"],
          permissionRequirementGroups: [
            [permission("clients.view", ["all", "assigned"])],
          ],
        },
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      maxWindowDays: 90,
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.list_job_readiness_issues",
  },
  {
    name: "get_job_communication_context",
    schemaRevision: TASK_12_SCHEMA_REVISION,
    operation: "read",
    description:
      "Return verified facts needed to contact a customer about one job.",
    inputSchema: JobCommunicationContextInputSchema,
    authorization: {
      variants: [
        jobVariant(
          "opportunity",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all", "assigned"]),
            permission("inbox.view", ["all", "assigned", "own"]),
            permission("pipeline.view", ["all", "assigned"]),
          ]
        ),
        jobVariant(
          "project",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all", "assigned"]),
            permission("inbox.view", ["all", "assigned", "own"]),
            permission("projects.view", ["all", "assigned"]),
          ]
        ),
        purposeVariant(
          "opportunity",
          "schedule_notice",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("projects.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        purposeVariant(
          "opportunity",
          "photo_request",
          ["ops.photos.read", "ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("photos.view", ["all", "assigned"]),
            permission("projects.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        purposeVariant(
          "project",
          "schedule_notice",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("projects.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        purposeVariant(
          "project",
          "photo_request",
          ["ops.photos.read", "ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("photos.view", ["all", "assigned"]),
            permission("projects.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 1,
      auditClass: "sensitive_read",
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.get_job_communication_context",
  },
  {
    name: "get_job_conversation_context",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description:
      "Return prompt-safe memory, recent turns, and evidence for one job.",
    inputSchema: JobConversationContextInputSchema,
    authorization: {
      variants: [
        jobVariant(
          "opportunity",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all"]),
            permission("inbox.view", ["all"]),
            permission("pipeline.view", ["all", "assigned"]),
          ]
        ),
        jobVariant(
          "project",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all"]),
            permission("inbox.view", ["all"]),
            permission("projects.view", ["all", "assigned"]),
          ]
        ),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      auditClass: "sensitive_read",
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.get_job_conversation_context",
  },
  {
    name: "list_customer_jobs",
    schemaRevision: TASK_13_CAPABILITY_SCHEMA_REVISION,
    operation: "read",
    description: "Return visible jobs linked to one resolved customer.",
    inputSchema: CustomerJobsInputSchema,
    authorization: {
      variants: [
        {
          key: "customer",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.customers.read"],
          permissionRequirementGroups: [
            [permission("clients.view", ["all", "assigned"])],
          ],
        },
        customerJobKindVariant("opportunity", [
          permission("pipeline.view", ["all", "assigned"]),
        ]),
        customerJobKindVariant("project", [
          permission("projects.view", ["all", "assigned"]),
        ]),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      maxWindowDays: 365,
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.list_customer_jobs",
  },
  {
    name: "get_job_summary",
    schemaRevision: TASK_13_CAPABILITY_SCHEMA_REVISION,
    operation: "read",
    description: "Return selected current facts for one job.",
    inputSchema: JobSummaryInputSchema,
    authorization: {
      variants: [
        jobVariant(
          "opportunity",
          ["ops.jobs.read"],
          [permission("pipeline.view", ["all", "assigned"])]
        ),
        jobVariant(
          "project",
          ["ops.jobs.read"],
          [permission("projects.view", ["all", "assigned"])]
        ),
        sectionVariant(
          "project",
          "schedule",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        summaryReadinessVariant(
          "site_photos",
          ["ops.photos.read"],
          [permission("photos.view", ["all", "assigned"])]
        ),
        summaryReadinessVariant(
          "customer",
          ["ops.customers.read"],
          [permission("clients.view", ["all", "assigned"])]
        ),
        summaryReadinessVariant(
          "schedule",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        sectionVariant(
          "opportunity",
          "participants",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all", "assigned"]),
            permission("inbox.view", ["all", "assigned", "own"]),
            permission("pipeline.view", ["all", "assigned"]),
          ]
        ),
        sectionVariant(
          "project",
          "participants",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all", "assigned"]),
            permission("inbox.view", ["all", "assigned", "own"]),
            permission("projects.view", ["all", "assigned"]),
          ]
        ),
        summaryFinancialVariant("opportunity", "estimate_rollup", [
          permission("estimates.view", ["all", "assigned"]),
        ]),
        summaryFinancialVariant("project", "estimate_rollup", [
          permission("estimates.view", ["all", "assigned"]),
          permission("projects.view_financials", ["all"]),
        ]),
        summaryFinancialVariant("project", "invoice_rollup", [
          permission("invoices.view", ["all", "assigned"]),
          permission("projects.view_financials", ["all"]),
        ]),
        sectionVariant(
          "opportunity",
          "activity",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("projects.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        sectionVariant(
          "project",
          "activity",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        sectionVariant(
          "opportunity",
          "conversation",
          ["ops.correspondence.read"],
          [permission("inbox.view", ["all", "assigned", "own"])]
        ),
        sectionVariant(
          "project",
          "conversation",
          ["ops.correspondence.read"],
          [permission("inbox.view", ["all", "assigned", "own"])]
        ),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 1,
      auditClass: "sensitive_read",
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.get_job_summary",
  },
  {
    name: "search_job_history",
    schemaRevision: TASK_13_CAPABILITY_SCHEMA_REVISION,
    operation: "read",
    description: "Search bounded job history and return exact evidence links.",
    inputSchema: JobHistorySearchInputSchema,
    authorization: {
      variants: [
        {
          key: "customer_scope",
          selector: { kind: "job_history_scope", scopeKind: "customer" },
          requiredOAuthScopes: ["ops.customers.read"],
          permissionRequirementGroups: [
            [permission("clients.view", ["all", "assigned"])],
          ],
        },
        historyJobKindVariant("opportunity", [
          permission("pipeline.view", ["all", "assigned"]),
        ]),
        historyJobKindVariant("project", [
          permission("projects.view", ["all", "assigned"]),
        ]),
        historySourceVariant(
          "correspondence_sources",
          "correspondence",
          ["ops.correspondence.read"],
          [permission("inbox.view", ["all", "assigned", "own"])]
        ),
        historySourceVariant(
          "task_event",
          "task_event",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("projects.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        historyFinancialSourceVariant("opportunity", [
          permission("estimates.view", ["all", "assigned"]),
        ]),
        historyFinancialSourceVariant("project", [
          permission("estimates.view", ["all", "assigned"]),
          permission("projects.view_financials", ["all"]),
        ]),
      ],
    },
    ...readMetadata({
      riskTier: "high",
      maxResultItems: 20,
      maxWindowDays: 365,
      auditClass: "search_read",
      rateLimitBucket: "evidence_search",
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.search_job_history",
  },
  {
    name: "get_correspondence_evidence",
    schemaRevision: TASK_13_CAPABILITY_SCHEMA_REVISION,
    operation: "read",
    description: "Return bounded exact correspondence for known evidence IDs.",
    inputSchema: CorrespondenceEvidenceReadInputSchema,
    authorization: {
      variants: [
        {
          key: "opportunity_jobs",
          selector: { kind: "job_kind", jobKind: "opportunity" },
          requiredOAuthScopes: ["ops.jobs.read"],
          permissionRequirementGroups: [
            [permission("pipeline.view", ["all", "assigned"])],
          ],
        },
        {
          key: "project_jobs",
          selector: { kind: "job_kind", jobKind: "project" },
          requiredOAuthScopes: ["ops.jobs.read"],
          permissionRequirementGroups: [
            [permission("projects.view", ["all", "assigned"])],
          ],
        },
        {
          key: "correspondence_evidence",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.correspondence.read"],
          permissionRequirementGroups: [
            [permission("inbox.view", ["all", "assigned", "own"])],
          ],
        },
      ],
    },
    ...readMetadata({
      riskTier: "high",
      maxResultItems: 20,
      evidenceInput: "required",
      auditClass: "evidence_read",
      rateLimitBucket: "evidence_search",
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.get_correspondence_evidence",
  },
  {
    name: "search_customers",
    schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    operation: "read",
    description:
      "Find customers you can access by name, exact email, or exact phone. Contact values are never returned.",
    inputSchema: SearchCustomersInputSchema,
    authorization: {
      variants: [
        customerDiscoveryVariant("name", ["ops.customers.read"]),
        customerDiscoveryVariant("exact_contact", [
          "ops.customer_contacts.read",
          "ops.customers.read",
        ]),
      ],
    },
    ...readMetadata({
      riskTier: "high",
      maxResultItems: MAX_DISCOVERY_MATCHES,
      auditClass: "search_read",
      rateLimitBucket: "evidence_search",
    }),
    rolloutFlag: "agent_control_plane.capability.search_customers",
  },
  {
    name: "search_jobs",
    schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    operation: "read",
    description: "Find jobs you can access by title, address, status, or date.",
    inputSchema: SearchJobsInputSchema,
    authorization: {
      variants: [
        jobDiscoveryVariant("opportunity", [
          permission("pipeline.view", ["all", "assigned"]),
        ]),
        jobDiscoveryVariant("project", [
          permission("projects.view", ["all", "assigned"]),
        ]),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: MAX_DISCOVERY_MATCHES,
      maxWindowDays: 365,
      auditClass: "search_read",
      rateLimitBucket: "evidence_search",
    }),
    rolloutFlag: "agent_control_plane.capability.search_jobs",
  },
  {
    name: "resolve_job_participants",
    schemaRevision: TASK_12_SCHEMA_REVISION,
    operation: "read",
    description:
      "Return evidence-backed participants and safe contact identities for one job.",
    inputSchema: JobParticipantsInputSchema,
    authorization: {
      variants: [
        jobVariant(
          "opportunity",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all", "assigned"]),
            permission("inbox.view", ["all", "assigned", "own"]),
            permission("pipeline.view", ["all", "assigned"]),
          ]
        ),
        jobVariant(
          "project",
          [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          [
            permission("clients.view", ["all", "assigned"]),
            permission("inbox.view", ["all", "assigned", "own"]),
            permission("projects.view", ["all", "assigned"]),
          ]
        ),
        participantPurposeVariant("opportunity", "schedule", [
          permission("pipeline.view", ["all", "assigned"]),
          permission("projects.view", ["all", "assigned"]),
          permission("tasks.view", ["all", "assigned"]),
        ]),
        participantPurposeVariant("opportunity", "assignment", [
          permission("pipeline.view", ["all", "assigned"]),
          permission("projects.view", ["all", "assigned"]),
          permission("tasks.view", ["all", "assigned"]),
        ]),
        participantPurposeVariant("project", "schedule", [
          permission("projects.view", ["all", "assigned"]),
          permission("tasks.view", ["all", "assigned"]),
        ]),
        participantPurposeVariant("project", "assignment", [
          permission("projects.view", ["all", "assigned"]),
          permission("tasks.view", ["all", "assigned"]),
        ]),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      auditClass: "sensitive_read",
    }),
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.resolve_job_participants",
  },
  {
    name: "list_site_visits",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description:
      "Return non-deleted booked appointments or visit history. Booked mode requires booked_at and defaults to active visits. History uses created_at, never legacy scheduled_at.",
    inputSchema: SiteVisitListInputSchema,
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
          ],
          permissionRequirementGroups: [
            [
              permission("calendar.view", ["all", "own"]),
              permission("clients.view", ["all", "assigned"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
          ],
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
          ],
          permissionRequirementGroups: [
            [
              permission("calendar.view", ["all", "own"]),
              permission("clients.view", ["all", "assigned"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
          ],
        },
        {
          key: "unlinked_history",
          selector: {
            kind: "input_value",
            field: "include_unlinked",
            value: true,
          },
          requiredOAuthScopes: ["ops.jobs.read"],
          permissionRequirementGroups: [[permission("pipeline.view", ["all"])]],
        },
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      maxWindowDays: 365,
      auditClass: "sensitive_read",
    }),
    rolloutFlag: "agent_control_plane.capability.list_site_visits",
  },
  {
    name: "get_site_visit_context",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description:
      "Return one non-deleted visit's lead, booking, checklist, review-ready artifact, evidence, and timeline context. Excludes deleted satellites.",
    inputSchema: SiteVisitContextInputSchema,
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
            "ops.photos.read",
            "ops.schedule.read",
          ],
          permissionRequirementGroups: [
            [
              permission("calendar.view", ["all", "own"]),
              permission("clients.view", ["all", "assigned"]),
              permission("photos.view", ["all", "assigned"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
          ],
        },
        {
          key: "unlinked",
          selector: {
            kind: "input_value",
            field: "anchor",
            value: "unlinked",
          },
          requiredOAuthScopes: ["ops.jobs.read", "ops.photos.read"],
          permissionRequirementGroups: [
            [
              permission("photos.view", ["all"]),
              permission("pipeline.view", ["all"]),
            ],
          ],
        },
      ],
    },
    ...readMetadata({
      riskTier: "high",
      maxResultItems: 20,
      evidenceInput: "optional",
      auditClass: "evidence_read",
      rateLimitBucket: "evidence_search",
    }),
    rolloutFlag: "agent_control_plane.capability.get_site_visit_context",
  },
] as const satisfies readonly CapabilityDefinition[];

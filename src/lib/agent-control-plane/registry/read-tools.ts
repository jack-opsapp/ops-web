import { z } from "zod-v4";

import {
  CursorRequestSchema,
  IanaTimeZoneSchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "@/lib/agent-control-plane/contracts/common";
import { JobRefSchema } from "@/lib/agent-control-plane/contracts/jobs";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import type {
  CapabilityAuthorizationVariantDefinition,
  CapabilityDefinition,
  CapabilityRiskTier,
} from "./capability-types";

const DAY_MS = 86_400_000;
const MAX_PROMPT_CHARACTERS = 60_000;
const MAX_INPUT_BYTES = 32_768;

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
const READ_CONFIRMATION = Object.freeze({ kind: "not_required" as const });
const READ_IDEMPOTENCY = Object.freeze({ kind: "inherent" as const });

const CustomerRefSchema = z
  .object({
    kind: z.enum(["client", "sub_client"]),
    id: OpaqueIdSchema,
  })
  .strict();

const UniqueJobRefsSchema = z
  .array(JobRefSchema)
  .max(50)
  .refine(
    (refs) =>
      new Set(refs.map((reference) => `${reference.kind}:${reference.id}`))
        .size === refs.length,
    "Job references must be unique"
  );

function validWindow(from: string, to: string, maximumDays: number): boolean {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return end > start && end - start <= maximumDays * DAY_MS;
}

const ScheduledJobsInputSchema = CursorRequestSchema.extend({
  from: Rfc3339UtcTimestampSchema,
  to: Rfc3339UtcTimestampSchema,
  statuses: z
    .array(
      z.enum(["scheduled", "confirmed", "in_progress", "complete", "cancelled"])
    )
    .max(5)
    .optional(),
  display_timezone: IanaTimeZoneSchema.optional(),
})
  .strict()
  .refine((input) => validWindow(input.from, input.to, 90), {
    path: ["to"],
    message: "Schedule window must be positive and no longer than 90 days",
  });

const ReadinessIssuesInputSchema = CursorRequestSchema.extend({
  from: Rfc3339UtcTimestampSchema,
  to: Rfc3339UtcTimestampSchema,
  rule_codes: z
    .array(
      z.enum([
        "SITE_PHOTOS_MISSING",
        "CUSTOMER_CONTACT_UNRESOLVED",
        "SCHEDULE_UNCONFIRMED",
        "CREW_UNASSIGNED",
        "ADDRESS_INCOMPLETE",
      ])
    )
    .max(5)
    .optional(),
  include_clear: z.boolean().default(false),
})
  .strict()
  .refine((input) => validWindow(input.from, input.to, 90), {
    path: ["to"],
    message: "Readiness window must be positive and no longer than 90 days",
  });

const JobCommunicationContextInputSchema = z
  .object({
    job_ref: JobRefSchema,
    purpose: z.enum(["schedule_notice", "photo_request", "general"]),
    as_of: Rfc3339UtcTimestampSchema.optional(),
  })
  .strict();

const ConversationSectionSchema = z.enum([
  "memory",
  "recent_turns",
  "participants",
  "gaps",
  "cross_job_seed",
]);
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
      .optional(),
  })
  .strict();

const CustomerJobsInputSchema = CursorRequestSchema.extend({
  customer_ref: CustomerRefSchema,
  lifecycle: z
    .array(z.enum(["lead", "active", "complete", "cancelled", "archived"]))
    .max(5)
    .optional(),
  statuses: z.array(z.string().min(1).max(64)).max(20).optional(),
  from: Rfc3339UtcTimestampSchema.optional(),
  to: Rfc3339UtcTimestampSchema.optional(),
})
  .strict()
  .superRefine((input, context) => {
    if ((input.from === undefined) !== (input.to === undefined)) {
      context.addIssue({
        code: "custom",
        path: [input.from === undefined ? "from" : "to"],
        message: "Both date-window bounds are required",
      });
      return;
    }
    if (input.from && input.to && !validWindow(input.from, input.to, 365)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Customer-job window must be no longer than 365 days",
      });
    }
  });

const JobSummarySectionSchema = z.enum([
  "identity",
  "schedule",
  "readiness",
  "participants",
  "financials",
  "activity",
  "conversation",
]);
const JobSummaryInputSchema = z
  .object({
    job_ref: JobRefSchema,
    sections: z
      .array(JobSummarySectionSchema)
      .min(1)
      .max(7)
      .refine(
        (sections) => new Set(sections).size === sections.length,
        "Summary sections must be unique"
      )
      .default(["identity"]),
  })
  .strict();

const JobHistorySearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    customer_ref: CustomerRefSchema.optional(),
    job_refs: UniqueJobRefsSchema.optional(),
    from: Rfc3339UtcTimestampSchema.optional(),
    to: Rfc3339UtcTimestampSchema.optional(),
    source_types: z
      .array(
        z.enum([
          "conversation_turn",
          "memory_summary",
          "activity",
          "schedule",
          "estimate",
        ])
      )
      .max(5)
      .optional(),
    cursor: OpaqueIdSchema.optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.from === undefined) !== (input.to === undefined)) {
      context.addIssue({
        code: "custom",
        path: [input.from === undefined ? "from" : "to"],
        message: "Both date-window bounds are required",
      });
      return;
    }
    if (input.from && input.to && !validWindow(input.from, input.to, 365)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Search window must be no longer than 365 days",
      });
    }
  });

const CorrespondenceEvidenceInputSchema = z
  .object({
    evidence_ids: z.array(OpaqueIdSchema).min(1).max(20),
    mode: z.enum(["excerpt", "full_text"]).default("excerpt"),
  })
  .strict();

const JobParticipantsInputSchema = z
  .object({
    job_ref: JobRefSchema,
    purpose: z
      .enum(["communication", "schedule", "assignment", "general"])
      .optional(),
    as_of: Rfc3339UtcTimestampSchema.optional(),
  })
  .strict();

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
    rolloutFlag: "agent_control_plane.capability.list_scheduled_jobs",
  },
  {
    name: "list_job_readiness_issues",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description: "Return current readiness issues for scheduled jobs.",
    inputSchema: ReadinessIssuesInputSchema,
    authorization: {
      variants: [
        {
          key: "readiness",
          selector: { kind: "always" },
          requiredOAuthScopes: [
            "ops.customer_contacts.read",
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
              permission("projects.view", ["all", "assigned"]),
              permission("tasks.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      maxWindowDays: 90,
    }),
    rolloutFlag: "agent_control_plane.capability.list_job_readiness_issues",
  },
  {
    name: "get_job_communication_context",
    schemaRevision: CONTRACT_VERSION,
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
          [permission("calendar.view", ["all", "own"])]
        ),
        purposeVariant(
          "opportunity",
          "photo_request",
          ["ops.photos.read"],
          [permission("photos.view", ["all", "assigned"])]
        ),
        purposeVariant(
          "project",
          "schedule_notice",
          ["ops.schedule.read"],
          [
            permission("calendar.view", ["all", "own"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        purposeVariant(
          "project",
          "photo_request",
          ["ops.photos.read"],
          [permission("photos.view", ["all", "assigned"])]
        ),
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 1,
      auditClass: "sensitive_read",
    }),
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
            permission("inbox.view", ["all", "assigned", "own"]),
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
    rolloutFlag: "agent_control_plane.capability.get_job_conversation_context",
  },
  {
    name: "list_customer_jobs",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description: "Return visible jobs linked to one resolved customer.",
    inputSchema: CustomerJobsInputSchema,
    authorization: {
      variants: [
        {
          key: "customer_jobs",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.customers.read", "ops.jobs.read"],
          permissionRequirementGroups: [
            [
              permission("clients.view", ["all", "assigned"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
            [
              permission("clients.view", ["all", "assigned"]),
              permission("projects.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      maxWindowDays: 365,
    }),
    rolloutFlag: "agent_control_plane.capability.list_customer_jobs",
  },
  {
    name: "get_job_summary",
    schemaRevision: CONTRACT_VERSION,
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
          "opportunity",
          "schedule",
          ["ops.schedule.read"],
          [permission("calendar.view", ["all", "own"])]
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
        sectionVariant(
          "opportunity",
          "readiness",
          ["ops.customers.read"],
          [permission("clients.view", ["all", "assigned"])]
        ),
        sectionVariant(
          "project",
          "readiness",
          [
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.photos.read",
            "ops.schedule.read",
          ],
          [
            permission("calendar.view", ["all", "own"]),
            permission("clients.view", ["all", "assigned"]),
            permission("photos.view", ["all", "assigned"]),
            permission("tasks.view", ["all", "assigned"]),
          ]
        ),
        sectionVariant(
          "opportunity",
          "participants",
          ["ops.customers.read"],
          [permission("clients.view", ["all", "assigned"])]
        ),
        sectionVariant(
          "project",
          "participants",
          ["ops.customers.read"],
          [permission("clients.view", ["all", "assigned"])]
        ),
        sectionVariant(
          "opportunity",
          "financials",
          ["ops.financials.read"],
          [permission("estimates.view", ["all", "assigned"])]
        ),
        sectionVariant(
          "project",
          "financials",
          ["ops.financials.read"],
          [permission("projects.view_financials", ["all"])]
        ),
        sectionVariant(
          "project",
          "activity",
          ["ops.jobs.read"],
          [permission("tasks.view", ["all", "assigned"])]
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
    rolloutFlag: "agent_control_plane.capability.get_job_summary",
  },
  {
    name: "search_job_history",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description: "Search bounded job history and return exact evidence links.",
    inputSchema: JobHistorySearchInputSchema,
    authorization: {
      variants: [
        {
          key: "job_history",
          selector: { kind: "always" },
          requiredOAuthScopes: [
            "ops.correspondence.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          permissionRequirementGroups: [
            [
              permission("clients.view", ["all", "assigned"]),
              permission("inbox.view", ["all", "assigned", "own"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
            [
              permission("clients.view", ["all", "assigned"]),
              permission("inbox.view", ["all", "assigned", "own"]),
              permission("projects.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    ...readMetadata({
      riskTier: "high",
      maxResultItems: 20,
      maxWindowDays: 365,
      auditClass: "search_read",
      rateLimitBucket: "evidence_search",
    }),
    rolloutFlag: "agent_control_plane.capability.search_job_history",
  },
  {
    name: "get_correspondence_evidence",
    schemaRevision: CONTRACT_VERSION,
    operation: "read",
    description: "Return bounded exact correspondence for known evidence IDs.",
    inputSchema: CorrespondenceEvidenceInputSchema,
    authorization: {
      variants: [
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
    rolloutFlag: "agent_control_plane.capability.get_correspondence_evidence",
  },
  {
    name: "resolve_job_participants",
    schemaRevision: CONTRACT_VERSION,
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
      ],
    },
    ...readMetadata({
      riskTier: "medium",
      maxResultItems: 50,
      auditClass: "sensitive_read",
    }),
    rolloutFlag: "agent_control_plane.capability.resolve_job_participants",
  },
] as const satisfies readonly CapabilityDefinition[];

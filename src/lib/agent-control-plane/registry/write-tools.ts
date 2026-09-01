import { z } from "zod-v4";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  MoneySchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
  ScheduleInstantSchema,
} from "@/lib/agent-control-plane/contracts/common";
import { JobRefSchema } from "@/lib/agent-control-plane/contracts/jobs";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import type {
  CapabilityRiskTier,
  LegacyCapabilityDefinition,
} from "./capability-types";

const MAX_PROMPT_CHARACTERS = 60_000;
const MAX_INPUT_BYTES = 262_144;
const MAX_WRITE_ITEMS = 25;
const MAX_MESSAGE_ITEMS = 10;

const PREPARE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const COMMIT_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});
const EXTERNAL_COMMIT_ANNOTATIONS = Object.freeze({
  ...COMMIT_ANNOTATIONS,
  openWorldHint: true,
});
const DARK_AVAILABILITY = Object.freeze({
  implementation: "unavailable" as const,
  externalExposure: "disabled" as const,
});
const REQUIRED_IDEMPOTENCY = Object.freeze({
  kind: "required" as const,
  keyField: "idempotency_key" as const,
  conflictOnArgumentsHashMismatch: true as const,
});

const IdempotencyKeySchema = z.string().trim().min(8).max(200);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SourceLocatorSchema = z.string().trim().min(1).max(2_048);

const ProjectRefSchema = z
  .object({
    kind: z.literal("project"),
    id: OpaqueIdSchema,
  })
  .strict();

const CustomerRefSchema = z
  .object({
    kind: z.enum(["client", "sub_client"]),
    id: OpaqueIdSchema,
  })
  .strict();

const DocumentSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ops_source"),
      file_id: OpaqueIdSchema,
      content_hash: Sha256Schema,
      revision: OpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("model_transcribed"),
      host: z.string().trim().min(1).max(200),
      filename: z.string().trim().min(1).max(500),
      declared_hash: Sha256Schema.optional(),
      transcribed_at: Rfc3339UtcTimestampSchema,
    })
    .strict(),
]);

const CommitChangeSetInputSchema = z
  .object({
    change_set_id: OpaqueIdSchema,
    confirmation_receipt: z.string().trim().min(8).max(2_048),
    idempotency_key: IdempotencyKeySchema,
  })
  .strict();

const ProjectCostAllocationInputSchema = z
  .object({
    allocations: z
      .array(
        z
          .object({
            project_ref: ProjectRefSchema,
            expense_id: OpaqueIdSchema,
            amount: MoneySchema,
            expected_expense_version: OpaqueIdSchema,
            source_evidence_id: OpaqueIdSchema,
          })
          .strict()
      )
      .min(1)
      .max(MAX_WRITE_ITEMS),
    idempotency_key: IdempotencyKeySchema,
  })
  .strict();

const EstimateImportInputSchema = z
  .object({
    job_ref: JobRefSchema,
    customer_ref: CustomerRefSchema,
    source: DocumentSourceSchema,
    estimate: z
      .object({
        title: z.string().trim().min(1).max(200),
        estimate_number: z.string().trim().min(1).max(100).optional(),
        expires_on: z.iso.date().optional(),
        expected_target_version: OpaqueIdSchema.optional(),
        line_items: z
          .array(
            z
              .object({
                description: z.string().trim().min(1).max(2_000),
                quantity: z.number().positive().max(1_000_000),
                unit_price: MoneySchema,
                tax_rate_basis_points: z.number().int().min(0).max(10_000),
                source_locator: SourceLocatorSchema,
              })
              .strict()
          )
          .min(1)
          .max(MAX_WRITE_ITEMS),
      })
      .strict(),
    idempotency_key: IdempotencyKeySchema,
  })
  .strict();

const CatalogChangeSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("upsert_service"),
      service_id: OpaqueIdSchema.optional(),
      name: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4_000).optional(),
      unit: z.enum(["each", "hour", "day", "square_foot", "linear_foot"]),
      unit_price: MoneySchema,
      expected_version: OpaqueIdSchema.optional(),
      source_locator: SourceLocatorSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("archive_service"),
      service_id: OpaqueIdSchema,
      expected_version: OpaqueIdSchema,
      source_locator: SourceLocatorSchema,
    })
    .strict(),
]);

const CatalogServiceChangeInputSchema = z
  .object({
    mode: z.enum(["import", "edit"]),
    source: DocumentSourceSchema,
    changes: z.array(CatalogChangeSchema).min(1).max(MAX_WRITE_ITEMS),
    idempotency_key: IdempotencyKeySchema,
  })
  .strict();

const ClientMessageBatchInputSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            job_ref: JobRefSchema,
            recipient: z
              .object({
                contact_id: OpaqueIdSchema,
                evidence_id: OpaqueIdSchema,
              })
              .strict(),
            channel: z.literal("email"),
            subject: z.string().trim().min(1).max(200),
            body_plain: z.string().trim().min(1).max(10_000),
            reply_to_evidence_id: OpaqueIdSchema.optional(),
            expected_thread_version: OpaqueIdSchema.optional(),
          })
          .strict()
      )
      .min(1)
      .max(MAX_MESSAGE_ITEMS),
    source_evidence_ids: z.array(OpaqueIdSchema).min(1).max(20),
    idempotency_key: IdempotencyKeySchema,
  })
  .strict();

const OpportunityRefSchema = z
  .object({
    kind: z.literal("opportunity"),
    id: OpaqueIdSchema,
  })
  .strict();
const UniqueAssigneeIdsSchema = z
  .array(OpaqueIdSchema)
  .min(1)
  .max(MAX_WRITE_ITEMS)
  .refine(
    (assigneeIds) => new Set(assigneeIds).size === assigneeIds.length,
    "Site-visit assignees must be unique"
  );
const UniqueSourceEvidenceIdsSchema = z
  .array(OpaqueIdSchema)
  .max(20)
  .refine(
    (evidenceIds) => new Set(evidenceIds).size === evidenceIds.length,
    "Source evidence IDs must be unique"
  );
const SiteVisitAppointmentFields = {
  scheduled_start: ScheduleInstantSchema,
  assignee_ids: UniqueAssigneeIdsSchema.optional(),
  reminder_lead_minutes: z
    .number()
    .int()
    .min(0)
    .max(1_440)
    .nullable()
    .optional(),
  source_evidence_ids: UniqueSourceEvidenceIdsSchema.optional(),
  idempotency_key: IdempotencyKeySchema,
} as const;
const SiteVisitBookingInputSchema = z
  .object({
    opportunity_ref: OpportunityRefSchema,
    ...SiteVisitAppointmentFields,
    duration_minutes: z.number().int().min(15).max(480).default(60),
  })
  .strict();
const SiteVisitRescheduleInputSchema = z
  .object({
    site_visit_id: OpaqueIdSchema,
    ...SiteVisitAppointmentFields,
    duration_minutes: z.number().int().min(15).max(480).optional(),
  })
  .strict();
const SiteVisitBookingCancellationInputSchema = z
  .object({
    site_visit_id: OpaqueIdSchema,
    source_evidence_ids: UniqueSourceEvidenceIdsSchema.optional(),
    idempotency_key: IdempotencyKeySchema,
  })
  .strict();

function permission(
  permissionName: CapabilityPermissionRequirement["permission"],
  allowedScopes: CapabilityPermissionRequirement["allowedScopes"]
): CapabilityPermissionRequirement {
  return { permission: permissionName, allowedScopes };
}

function writeMetadata(input: {
  operation: "prepare" | "commit";
  riskTier: CapabilityRiskTier;
  maxBatchItems: number;
  evidenceInput?: "not_required" | "optional" | "required";
  external?: boolean;
}) {
  return {
    riskTier: input.riskTier,
    bounds: {
      maxInputBytes: MAX_INPUT_BYTES,
      maxOutputCharacters: MAX_PROMPT_CHARACTERS,
      maxResultItems: input.maxBatchItems,
      maxBatchItems: input.maxBatchItems,
    },
    evidencePolicy: {
      input:
        input.operation === "prepare"
          ? (input.evidenceInput ?? ("required" as const))
          : ("prepared_change_set" as const),
      output: "required" as const,
      maxEvidenceRefs: 20,
      promptSafeOutput: true as const,
      untrustedExternalContent: "structured_and_marked" as const,
    },
    auditClass:
      input.operation === "prepare"
        ? ("mutation_prepare" as const)
        : input.external
          ? ("external_commit" as const)
          : ("mutation_commit" as const),
    rateLimitBucket:
      input.operation === "prepare"
        ? ("prepare" as const)
        : ("commit" as const),
    annotations:
      input.operation === "prepare"
        ? PREPARE_ANNOTATIONS
        : input.external
          ? EXTERNAL_COMMIT_ANNOTATIONS
          : COMMIT_ANNOTATIONS,
    idempotencyPolicy: REQUIRED_IDEMPOTENCY,
    availability: DARK_AVAILABILITY,
  } as const;
}

function prepareConfirmation() {
  return {
    kind: "change_set_preview" as const,
    exactPreviewRequired: true as const,
    expires: true as const,
  };
}

function commitConfirmation(prepareCapability: string) {
  return {
    kind: "confirmation_receipt" as const,
    prepareCapability,
    exactPreviewRequired: true as const,
    singleUse: true as const,
  };
}

export const WRITE_CAPABILITY_DEFINITIONS = [
  {
    name: "prepare_project_cost_allocation",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "project_cost_allocation",
    description:
      "Validate and preview project cost allocations. Makes no financial change.",
    inputSchema: ProjectCostAllocationInputSchema,
    authorization: {
      variants: [
        {
          key: "project_cost_allocation",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.financials.prepare"],
          permissionRequirementGroups: [
            [
              permission("expenses.edit", ["all", "own"]),
              permission("projects.view", ["all", "assigned"]),
              permission("projects.view_financials", ["all"]),
            ],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 25,
    }),
    rolloutFlag:
      "agent_control_plane.capability.prepare_project_cost_allocation",
  },
  {
    name: "commit_project_cost_allocation",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "project_cost_allocation",
    description: "Apply one confirmed project cost allocation change set.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "project_cost_allocation",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.financials.write"],
          permissionRequirementGroups: [
            [
              permission("expenses.edit", ["all", "own"]),
              permission("projects.view", ["all", "assigned"]),
              permission("projects.view_financials", ["all"]),
            ],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation("prepare_project_cost_allocation"),
    ...writeMetadata({
      operation: "commit",
      riskTier: "critical",
      maxBatchItems: 25,
    }),
    rolloutFlag:
      "agent_control_plane.capability.commit_project_cost_allocation",
  },
  {
    name: "prepare_estimate_import",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "estimate_import",
    description: "Validate and preview an evidence-backed estimate import.",
    inputSchema: EstimateImportInputSchema,
    authorization: {
      variants: [
        {
          key: "estimate_import",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.financials.prepare"],
          permissionRequirementGroups: [
            [
              permission("clients.view", ["all", "assigned"]),
              permission("estimates.create", ["all"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
            [
              permission("clients.view", ["all", "assigned"]),
              permission("estimates.create", ["all"]),
              permission("projects.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 25,
    }),
    rolloutFlag: "agent_control_plane.capability.prepare_estimate_import",
  },
  {
    name: "commit_estimate_import",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "estimate_import",
    description: "Apply one confirmed estimate import change set.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "estimate_import",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.financials.write"],
          permissionRequirementGroups: [
            [
              permission("clients.view", ["all", "assigned"]),
              permission("estimates.create", ["all"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
            [
              permission("clients.view", ["all", "assigned"]),
              permission("estimates.create", ["all"]),
              permission("projects.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation("prepare_estimate_import"),
    ...writeMetadata({
      operation: "commit",
      riskTier: "critical",
      maxBatchItems: 25,
    }),
    rolloutFlag: "agent_control_plane.capability.commit_estimate_import",
  },
  {
    name: "prepare_catalog_service_change",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "catalog_service_change",
    description: "Validate and preview bounded catalog service changes.",
    inputSchema: CatalogServiceChangeInputSchema,
    authorization: {
      variants: [
        {
          key: "import",
          selector: { kind: "input_value", field: "mode", value: "import" },
          requiredOAuthScopes: ["ops.catalog.prepare"],
          permissionRequirementGroups: [
            [permission("catalog.import", ["all"])],
          ],
        },
        {
          key: "edit",
          selector: { kind: "input_value", field: "mode", value: "edit" },
          requiredOAuthScopes: ["ops.catalog.prepare"],
          permissionRequirementGroups: [
            [permission("catalog.manage", ["all"])],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 25,
    }),
    rolloutFlag:
      "agent_control_plane.capability.prepare_catalog_service_change",
  },
  {
    name: "commit_catalog_service_change",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "catalog_service_change",
    description: "Apply one confirmed catalog service change set.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "prepared_catalog_change",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.catalog.write"],
          permissionRequirementGroups: [
            [permission("catalog.import", ["all"])],
            [permission("catalog.manage", ["all"])],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation("prepare_catalog_service_change"),
    ...writeMetadata({
      operation: "commit",
      riskTier: "high",
      maxBatchItems: 25,
    }),
    rolloutFlag: "agent_control_plane.capability.commit_catalog_service_change",
  },
  {
    name: "prepare_client_message_batch",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "client_message_batch",
    description:
      "Validate recipients and preview a bounded client message batch.",
    inputSchema: ClientMessageBatchInputSchema,
    authorization: {
      variants: [
        {
          key: "client_message_batch",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.communications.prepare"],
          permissionRequirementGroups: [
            [
              permission("clients.view", ["all", "assigned"]),
              permission("inbox.send", ["all", "assigned"]),
              permission("inbox.view", ["all", "assigned", "own"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
            [
              permission("clients.view", ["all", "assigned"]),
              permission("inbox.send", ["all", "assigned"]),
              permission("inbox.view", ["all", "assigned", "own"]),
              permission("projects.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 10,
    }),
    rolloutFlag: "agent_control_plane.capability.prepare_client_message_batch",
  },
  {
    name: "commit_client_message_batch",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "client_message_batch",
    description:
      "Send one confirmed client message batch and return delivery receipts.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "client_message_batch",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.communications.send"],
          permissionRequirementGroups: [
            [
              permission("clients.view", ["all", "assigned"]),
              permission("inbox.send", ["all", "assigned"]),
              permission("inbox.view", ["all", "assigned", "own"]),
              permission("pipeline.view", ["all", "assigned"]),
            ],
            [
              permission("clients.view", ["all", "assigned"]),
              permission("inbox.send", ["all", "assigned"]),
              permission("inbox.view", ["all", "assigned", "own"]),
              permission("projects.view", ["all", "assigned"]),
            ],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation("prepare_client_message_batch"),
    ...writeMetadata({
      operation: "commit",
      riskTier: "critical",
      maxBatchItems: 10,
      external: true,
    }),
    rolloutFlag: "agent_control_plane.capability.commit_client_message_batch",
  },
  {
    name: "prepare_site_visit_booking",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "site_visit_booking",
    description:
      "Preview one lead-attached site-visit booking in the company's timezone. Does not book or change a calendar.",
    inputSchema: SiteVisitBookingInputSchema,
    authorization: {
      variants: [
        {
          key: "site_visit_booking",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.prepare", "ops.schedule.prepare"],
          permissionRequirementGroups: [
            [permission("pipeline.convert", ["all", "assigned"])],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 1,
      evidenceInput: "optional",
    }),
    rolloutFlag: "agent_control_plane.capability.prepare_site_visit_booking",
  },
  {
    name: "commit_site_visit_booking",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "site_visit_booking",
    description:
      "Book one confirmed site visit and return its calendar reconciliation state.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "site_visit_booking",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.write", "ops.schedule.write"],
          permissionRequirementGroups: [
            [permission("pipeline.convert", ["all", "assigned"])],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation("prepare_site_visit_booking"),
    ...writeMetadata({
      operation: "commit",
      riskTier: "high",
      maxBatchItems: 1,
      external: true,
    }),
    rolloutFlag: "agent_control_plane.capability.commit_site_visit_booking",
  },
  {
    name: "prepare_site_visit_reschedule",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "site_visit_reschedule",
    description:
      "Preview one site-visit reschedule in the company's timezone. Does not change the visit or its calendar event.",
    inputSchema: SiteVisitRescheduleInputSchema,
    authorization: {
      variants: [
        {
          key: "site_visit_reschedule",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.prepare", "ops.schedule.prepare"],
          permissionRequirementGroups: [
            [permission("pipeline.convert", ["all", "assigned"])],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 1,
      evidenceInput: "optional",
    }),
    rolloutFlag: "agent_control_plane.capability.prepare_site_visit_reschedule",
  },
  {
    name: "commit_site_visit_reschedule",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "site_visit_reschedule",
    description:
      "Reschedule one confirmed site visit and return its calendar reconciliation state.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "site_visit_reschedule",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.write", "ops.schedule.write"],
          permissionRequirementGroups: [
            [permission("pipeline.convert", ["all", "assigned"])],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation("prepare_site_visit_reschedule"),
    ...writeMetadata({
      operation: "commit",
      riskTier: "high",
      maxBatchItems: 1,
      external: true,
    }),
    rolloutFlag: "agent_control_plane.capability.commit_site_visit_reschedule",
  },
  {
    name: "prepare_site_visit_booking_cancellation",
    schemaRevision: CONTRACT_VERSION,
    operation: "prepare",
    writeFamily: "site_visit_booking_cancellation",
    description:
      "Preview one site-visit cancellation. Does not change the visit or its calendar event.",
    inputSchema: SiteVisitBookingCancellationInputSchema,
    authorization: {
      variants: [
        {
          key: "site_visit_booking_cancellation",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.prepare", "ops.schedule.prepare"],
          permissionRequirementGroups: [
            [permission("pipeline.convert", ["all", "assigned"])],
          ],
        },
      ],
    },
    confirmationPolicy: prepareConfirmation(),
    ...writeMetadata({
      operation: "prepare",
      riskTier: "high",
      maxBatchItems: 1,
      evidenceInput: "optional",
    }),
    rolloutFlag:
      "agent_control_plane.capability.prepare_site_visit_booking_cancellation",
  },
  {
    name: "commit_site_visit_booking_cancellation",
    schemaRevision: CONTRACT_VERSION,
    operation: "commit",
    writeFamily: "site_visit_booking_cancellation",
    description:
      "Cancel one confirmed site-visit booking and return its calendar reconciliation state.",
    inputSchema: CommitChangeSetInputSchema,
    authorization: {
      variants: [
        {
          key: "site_visit_booking_cancellation",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.write", "ops.schedule.write"],
          permissionRequirementGroups: [
            [permission("pipeline.convert", ["all", "assigned"])],
          ],
        },
      ],
    },
    confirmationPolicy: commitConfirmation(
      "prepare_site_visit_booking_cancellation"
    ),
    ...writeMetadata({
      operation: "commit",
      riskTier: "high",
      maxBatchItems: 1,
      external: true,
    }),
    rolloutFlag:
      "agent_control_plane.capability.commit_site_visit_booking_cancellation",
  },
] as const satisfies readonly LegacyCapabilityDefinition[];

import {
  CorrespondenceEvidenceReadInputSchema,
  CustomerJobsInputSchema,
  JobHistorySearchInputSchema,
  JobSummaryInputSchema,
  TASK_13_CAPABILITY_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import type { LegacyCapabilityDefinition } from "../capability-types";
import {
  EXTERNAL_READ_AVAILABILITY,
  customerJobKindVariant,
  historyFinancialSourceVariant,
  historyJobKindVariant,
  historySourceVariant,
  jobVariant,
  permission,
  readMetadata,
  sectionVariant,
  summaryFinancialVariant,
  summaryReadinessVariant,
} from "./v7-shared";

export const JOB_CATALOG_READ_CAPABILITY_DEFINITIONS = [
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
] as const satisfies readonly LegacyCapabilityDefinition[];

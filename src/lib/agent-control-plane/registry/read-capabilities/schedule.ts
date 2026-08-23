import {
  JobReadinessIssuesInputSchema,
  ScheduledJobsInputSchema,
} from "@/lib/agent-control-plane/contracts/schedule";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import type { LegacyCapabilityDefinition } from "../capability-types";
import {
  EXTERNAL_READ_AVAILABILITY,
  permission,
  readMetadata,
} from "./v7-shared";

export const SCHEDULE_READ_CAPABILITY_DEFINITIONS = [
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
] as const satisfies readonly LegacyCapabilityDefinition[];

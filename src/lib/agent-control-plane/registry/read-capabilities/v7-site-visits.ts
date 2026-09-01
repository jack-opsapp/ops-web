import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import type { LegacyCapabilityDefinition } from "../capability-types";
import {
  SiteVisitContextInputSchema,
  SiteVisitListInputSchema,
  permission,
  readMetadata,
} from "./v7-shared";

export const V7_SITE_VISIT_READ_CAPABILITY_DEFINITIONS = [
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
] as const satisfies readonly LegacyCapabilityDefinition[];

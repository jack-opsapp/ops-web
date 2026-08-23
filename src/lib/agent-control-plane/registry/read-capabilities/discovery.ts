import {
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  MAX_DISCOVERY_MATCHES,
  SearchCustomersInputSchema,
  SearchJobsInputSchema,
} from "@/lib/agent-control-plane/contracts/discovery";
import type { LegacyCapabilityDefinition } from "../capability-types";
import {
  EXTERNAL_READ_AVAILABILITY,
  customerDiscoveryVariant,
  jobDiscoveryVariant,
  permission,
  readMetadata,
} from "./v7-shared";

export const DISCOVERY_READ_CAPABILITY_DEFINITIONS = [
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
    availability: EXTERNAL_READ_AVAILABILITY,
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
    availability: EXTERNAL_READ_AVAILABILITY,
    rolloutFlag: "agent_control_plane.capability.search_jobs",
  },
] as const satisfies readonly LegacyCapabilityDefinition[];

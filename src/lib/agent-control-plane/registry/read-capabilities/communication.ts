import {
  JobCommunicationContextInputSchema,
  JobParticipantsInputSchema,
} from "@/lib/agent-control-plane/contracts/communication";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import type { LegacyCapabilityDefinition } from "../capability-types";
import {
  EXTERNAL_READ_AVAILABILITY,
  JobConversationContextInputSchema,
  TASK_12_SCHEMA_REVISION,
  jobVariant,
  participantPurposeVariant,
  permission,
  purposeVariant,
  readMetadata,
} from "./v7-shared";

export const COMMUNICATION_CONTEXT_CAPABILITY_DEFINITIONS = [
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
] as const satisfies readonly LegacyCapabilityDefinition[];

export const PARTICIPANT_READ_CAPABILITY_DEFINITIONS = [
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
] as const satisfies readonly LegacyCapabilityDefinition[];

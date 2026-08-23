import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  v1CursorPageFixture,
  v1ErrorResultFixture,
  v1EvidenceResultFixture,
  v1SuccessResultFixture,
} from "@/lib/agent-control-plane/contracts/__fixtures__/v1";
import {
  SCOPE_CONSENT_LABELS,
  SUPPORTED_READ_SCOPES,
} from "@/lib/agent-control-plane/mcp/oauth/scopes";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const EXPECTED_DEFINITIONS = [
  ["list_scheduled_jobs", "read"],
  ["list_job_readiness_issues", "read"],
  ["get_job_communication_context", "read"],
  ["get_job_conversation_context", "read"],
  ["list_customer_jobs", "read"],
  ["get_job_summary", "read"],
  ["search_job_history", "read"],
  ["get_correspondence_evidence", "read"],
  ["search_customers", "read"],
  ["search_jobs", "read"],
  ["resolve_job_participants", "read"],
  ["list_site_visits", "read"],
  ["get_site_visit_context", "read"],
  ["prepare_project_cost_allocation", "prepare"],
  ["commit_project_cost_allocation", "commit"],
  ["prepare_estimate_import", "prepare"],
  ["commit_estimate_import", "commit"],
  ["prepare_catalog_service_change", "prepare"],
  ["commit_catalog_service_change", "commit"],
  ["prepare_client_message_batch", "prepare"],
  ["commit_client_message_batch", "commit"],
  ["prepare_site_visit_booking", "prepare"],
  ["commit_site_visit_booking", "commit"],
  ["prepare_site_visit_reschedule", "prepare"],
  ["commit_site_visit_reschedule", "commit"],
  ["prepare_site_visit_booking_cancellation", "prepare"],
  ["commit_site_visit_booking_cancellation", "commit"],
] as const;

const EXPECTED_EXTERNAL_TOOLS = [
  "list_scheduled_jobs",
  "list_job_readiness_issues",
  "get_job_communication_context",
  "get_job_conversation_context",
  "list_customer_jobs",
  "get_job_summary",
  "search_job_history",
  "get_correspondence_evidence",
  "search_customers",
  "search_jobs",
  "resolve_job_participants",
] as const;

const EXPECTED_DARK_SITE_VISIT_READS = [
  "list_site_visits",
  "get_site_visit_context",
] as const;

const EXPECTED_DARK_WRITES = [
  "prepare_project_cost_allocation",
  "commit_project_cost_allocation",
  "prepare_estimate_import",
  "commit_estimate_import",
  "prepare_catalog_service_change",
  "commit_catalog_service_change",
  "prepare_client_message_batch",
  "commit_client_message_batch",
  "prepare_site_visit_booking",
  "commit_site_visit_booking",
  "prepare_site_visit_reschedule",
  "commit_site_visit_reschedule",
  "prepare_site_visit_booking_cancellation",
  "commit_site_visit_booking_cancellation",
] as const;

const EXPECTED_SCOPES_AND_LABELS = [
  ["ops.jobs.read", "See your jobs and their status"],
  ["ops.schedule.read", "See your schedule and who's assigned"],
  ["ops.customers.read", "See your clients and their jobs"],
  [
    "ops.customer_contacts.read",
    "See who to contact on a job and how to reach them",
  ],
  ["ops.photos.read", "See which jobs are missing photos"],
  ["ops.correspondence.read", "See client email history on your jobs"],
  ["ops.financials.read", "See estimate and invoice summaries on your jobs"],
] as const;

/**
 * Runtime Zod objects are intentionally excluded. Their independently pinned
 * parse behavior lives in the contract suites; every serialized manifest
 * field that can cross a process boundary is included here byte-for-byte.
 */
function serializedV7ManifestProjection(): string {
  return JSON.stringify(
    CAPABILITY_MANIFEST.map(({ inputSchema: _inputSchema, ...entry }) => entry)
  );
}

describe("immutable v7 control-plane compatibility", () => {
  it("freezes one canonical serialization of the complete manifest projection", () => {
    const serialized = serializedV7ManifestProjection();
    const digest = createHash("sha256").update(serialized).digest("hex");

    expect(CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-20.capability-manifest.v7"
    );
    expect(new TextEncoder().encode(serialized)).toHaveLength(61_456);
    expect(digest).toBe(
      "ac134896bda42ba008783b107f1f7f7a9d1a0da60af0770ca5cd0b2c8a8b5779"
    );
  });

  it("pins definition order, the eleven live reads, dark site-visit reads, and every dark write", () => {
    expect(
      CAPABILITY_MANIFEST.map((entry) => [entry.name, entry.operation])
    ).toEqual(EXPECTED_DEFINITIONS);
    expect(
      CAPABILITY_MANIFEST.filter(
        (entry) => entry.availability.externalExposure === "enabled"
      ).map((entry) => entry.name)
    ).toEqual(EXPECTED_EXTERNAL_TOOLS);
    expect(
      CAPABILITY_MANIFEST.filter(
        (entry) =>
          entry.operation === "read" &&
          entry.availability.implementation === "unavailable"
      ).map((entry) => entry.name)
    ).toEqual(EXPECTED_DARK_SITE_VISIT_READS);
    expect(
      CAPABILITY_MANIFEST.filter((entry) => entry.operation !== "read").map(
        (entry) => entry.name
      )
    ).toEqual(EXPECTED_DARK_WRITES);
    for (const name of EXPECTED_DARK_WRITES) {
      expect(
        CAPABILITY_MANIFEST.find((entry) => entry.name === name)?.availability
      ).toEqual({
        implementation: "unavailable",
        externalExposure: "disabled",
      });
    }
  });

  it("pins the seven grantable scopes and their exact consent labels", () => {
    expect(
      SUPPORTED_READ_SCOPES.map((scope) => [scope, SCOPE_CONSENT_LABELS[scope]])
    ).toEqual(EXPECTED_SCOPES_AND_LABELS);
  });

  it("preserves the original cursor and result snapshots byte-for-byte", () => {
    expect(JSON.parse(JSON.stringify(v1CursorPageFixture))).toEqual({
      next_cursor: "cursor:scheduled_at=2026-08-11T15:30:00Z&id=job/001",
      has_more: true,
    });
    expect(JSON.parse(JSON.stringify(v1SuccessResultFixture))).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: "request:phase-c/2026-08-07/001",
      generated_at: "2026-08-07T20:00:00.000Z",
      company_id: "company:canpro/primary",
      actor: {
        user_id: "operator:jackson@example.test",
        permission_snapshot_revision: "permissions:2026-08-07/42",
      },
      freshness: {
        read_at: "2026-08-07T19:59:59.500Z",
        source_versions: [
          {
            source_domain: "pipeline",
            source_type: "opportunity",
            source_id: "opportunity:lead/2026-08-07:001",
            version: "updated_at:2026-08-07T19:58:30.000Z",
          },
        ],
        stale_after: null,
        memory_version: 7,
        turn_high_watermark_id: "turn:gmail/message<18f-example>",
      },
      data: {
        conversation_id: "conversation:job/2026-08-07/001",
        job_refs: [
          { kind: "opportunity", id: "opportunity:lead/2026-08-07:001" },
          { kind: "project", id: "project:converted/2026-08-07:001" },
        ],
        schedule: {
          utc: "2026-08-11T15:30:00.000Z",
          local: "2026-08-11T08:30:00",
          timezone: "America/Vancouver",
        },
        budget: { amount_minor: 125050, currency: "CAD" },
      },
      evidence: [
        {
          evidence_id: "evidence:gmail/message<18f-example>",
          source_domain: "correspondence",
          source_type: "email_message",
          source_id: "gmail/message<18f-example>",
          version: "sha256:d7f6317f9f34",
          occurred_at: "2026-08-07T19:58:12.456Z",
          relationship: "supports",
          excerpt: "Please schedule the work for Tuesday morning.",
          locator: "ops://evidence/evidence:gmail%2Fmessage%3C18f-example%3E",
          trust: "delivered_correspondence",
        },
      ],
      warnings: [
        {
          code: "PARTICIPANT_UNRESOLVED",
          message:
            "One copied recipient has not been linked to an OPS contact.",
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(v1EvidenceResultFixture))).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: "request:evidence/2026-08-07/001",
      generated_at: "2026-08-07T20:00:01.000Z",
      company_id: "company:canpro/primary",
      actor: {
        user_id: "operator:jackson@example.test",
        permission_snapshot_revision: "permissions:2026-08-07/42",
      },
      freshness: {
        read_at: "2026-08-07T20:00:00.750Z",
        source_versions: [
          {
            source_domain: "correspondence",
            source_type: "email_message",
            source_id: "gmail/message<18f-example>",
            version: "sha256:d7f6317f9f34",
          },
        ],
        stale_after: "2026-08-07T20:05:00.750Z",
      },
      data: {
        evidence_id: "evidence:gmail/message<18f-example>",
        source_domain: "correspondence",
        source_type: "email_message",
        source_id: "gmail/message<18f-example>",
        version: "sha256:d7f6317f9f34",
        occurred_at: "2026-08-07T19:58:12.456Z",
        relationship: "supports",
        excerpt: "Please schedule the work for Tuesday morning.",
        locator: "ops://evidence/evidence:gmail%2Fmessage%3C18f-example%3E",
        trust: "delivered_correspondence",
      },
      evidence: [
        {
          evidence_id: "evidence:gmail/message<18f-example>",
          source_domain: "correspondence",
          source_type: "email_message",
          source_id: "gmail/message<18f-example>",
          version: "sha256:d7f6317f9f34",
          occurred_at: "2026-08-07T19:58:12.456Z",
          relationship: "supports",
          excerpt: "Please schedule the work for Tuesday morning.",
          locator: "ops://evidence/evidence:gmail%2Fmessage%3C18f-example%3E",
          trust: "delivered_correspondence",
        },
      ],
      warnings: [],
    });
    expect(JSON.parse(JSON.stringify(v1ErrorResultFixture))).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: "request:phase-c/2026-08-07/002",
      code: "STALE_CONTEXT",
      message:
        "Conversation memory is not current through the triggering turn.",
      retryable: true,
      details: {
        current_source_versions: [
          {
            source_domain: "pipeline",
            source_type: "opportunity",
            source_id: "opportunity:lead/2026-08-07:001",
            version: "updated_at:2026-08-07T19:58:30.000Z",
          },
        ],
        current_memory_version: 7,
        current_turn_high_watermark_id: "turn:gmail/message<18e-previous>",
      },
    });
  });
});

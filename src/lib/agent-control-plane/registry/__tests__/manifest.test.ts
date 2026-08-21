import { describe, expect, it } from "vitest";

import {
  defineCapabilityPolicyForManifest,
  isManifestCapabilityPolicy,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CONTRACT_VERSION,
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  assertCapabilityManifestInvariants,
  type CapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-types";

const EXPECTED_CAPABILITIES = [
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

const EXPECTED_ANNOTATIONS = {
  list_scheduled_jobs: [true, false, true, false],
  list_job_readiness_issues: [true, false, true, false],
  get_job_communication_context: [true, false, true, false],
  get_job_conversation_context: [true, false, true, false],
  list_customer_jobs: [true, false, true, false],
  get_job_summary: [true, false, true, false],
  search_job_history: [true, false, true, false],
  get_correspondence_evidence: [true, false, true, false],
  search_customers: [true, false, true, false],
  search_jobs: [true, false, true, false],
  resolve_job_participants: [true, false, true, false],
  list_site_visits: [true, false, true, false],
  get_site_visit_context: [true, false, true, false],
  prepare_project_cost_allocation: [false, false, true, false],
  commit_project_cost_allocation: [false, true, true, false],
  prepare_estimate_import: [false, false, true, false],
  commit_estimate_import: [false, true, true, false],
  prepare_catalog_service_change: [false, false, true, false],
  commit_catalog_service_change: [false, true, true, false],
  prepare_client_message_batch: [false, false, true, false],
  commit_client_message_batch: [false, true, true, true],
  prepare_site_visit_booking: [false, false, true, false],
  commit_site_visit_booking: [false, true, true, true],
  prepare_site_visit_reschedule: [false, false, true, false],
  commit_site_visit_reschedule: [false, true, true, true],
  prepare_site_visit_booking_cancellation: [false, false, true, false],
  commit_site_visit_booking_cancellation: [false, true, true, true],
} as const;

const EXPECTED_POLICY_MATRIX = {
  list_scheduled_jobs: [
    {
      key: "schedule",
      oauth: ["ops.jobs.read", "ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
  ],
  list_job_readiness_issues: [
    {
      key: "readiness_base",
      oauth: ["ops.jobs.read", "ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "readiness_site_photos",
      oauth: ["ops.photos.read"],
      groups: [["photos.view:all,assigned"]],
    },
    {
      key: "readiness_customer",
      oauth: ["ops.customers.read"],
      groups: [["clients.view:all,assigned"]],
    },
  ],
  get_job_communication_context: [
    {
      key: "opportunity",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.view:all,assigned,own",
          "pipeline.view:all,assigned",
        ],
      ],
    },
    {
      key: "project",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.view:all,assigned,own",
          "projects.view:all,assigned",
        ],
      ],
    },
    {
      key: "opportunity:schedule_notice",
      oauth: ["ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "opportunity:photo_request",
      oauth: ["ops.photos.read", "ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "photos.view:all,assigned",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "project:schedule_notice",
      oauth: ["ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "project:photo_request",
      oauth: ["ops.photos.read", "ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "photos.view:all,assigned",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
  ],
  get_job_conversation_context: [
    {
      key: "opportunity",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        ["clients.view:all", "inbox.view:all", "pipeline.view:all,assigned"],
      ],
    },
    {
      key: "project",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        ["clients.view:all", "inbox.view:all", "projects.view:all,assigned"],
      ],
    },
  ],
  list_customer_jobs: [
    {
      key: "customer",
      oauth: ["ops.customers.read"],
      groups: [["clients.view:all,assigned"]],
    },
    {
      key: "opportunity_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["pipeline.view:all,assigned"]],
    },
    {
      key: "project_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned"]],
    },
  ],
  get_job_summary: [
    {
      key: "opportunity",
      oauth: ["ops.jobs.read"],
      groups: [["pipeline.view:all,assigned"]],
    },
    {
      key: "project",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned"]],
    },
    {
      key: "project:schedule",
      oauth: ["ops.schedule.read"],
      groups: [["calendar.view:all,own", "tasks.view:all,assigned"]],
    },
    {
      key: "project:readiness:site_photos",
      oauth: ["ops.photos.read"],
      groups: [["photos.view:all,assigned"]],
    },
    {
      key: "project:readiness:customer",
      oauth: ["ops.customers.read"],
      groups: [["clients.view:all,assigned"]],
    },
    {
      key: "project:readiness:schedule",
      oauth: ["ops.schedule.read"],
      groups: [["calendar.view:all,own", "tasks.view:all,assigned"]],
    },
    {
      key: "opportunity:participants",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.view:all,assigned,own",
          "pipeline.view:all,assigned",
        ],
      ],
    },
    {
      key: "project:participants",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.view:all,assigned,own",
          "projects.view:all,assigned",
        ],
      ],
    },
    {
      key: "opportunity:financials:estimate_rollup",
      oauth: ["ops.financials.read"],
      groups: [["estimates.view:all,assigned"]],
    },
    {
      key: "project:financials:estimate_rollup",
      oauth: ["ops.financials.read"],
      groups: [["estimates.view:all,assigned", "projects.view_financials:all"]],
    },
    {
      key: "project:financials:invoice_rollup",
      oauth: ["ops.financials.read"],
      groups: [["invoices.view:all,assigned", "projects.view_financials:all"]],
    },
    {
      key: "opportunity:activity",
      oauth: ["ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "project:activity",
      oauth: ["ops.schedule.read"],
      groups: [["calendar.view:all,own", "tasks.view:all,assigned"]],
    },
    {
      key: "opportunity:conversation",
      oauth: ["ops.correspondence.read"],
      groups: [["inbox.view:all,assigned,own"]],
    },
    {
      key: "project:conversation",
      oauth: ["ops.correspondence.read"],
      groups: [["inbox.view:all,assigned,own"]],
    },
  ],
  search_job_history: [
    {
      key: "customer_scope",
      oauth: ["ops.customers.read"],
      groups: [["clients.view:all,assigned"]],
    },
    {
      key: "opportunity_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["pipeline.view:all,assigned"]],
    },
    {
      key: "project_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned"]],
    },
    {
      key: "correspondence_sources",
      oauth: ["ops.correspondence.read"],
      groups: [["inbox.view:all,assigned,own"]],
    },
    {
      key: "task_event",
      oauth: ["ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "opportunity:estimate_document",
      oauth: ["ops.financials.read"],
      groups: [["estimates.view:all,assigned"]],
    },
    {
      key: "project:estimate_document",
      oauth: ["ops.financials.read"],
      groups: [["estimates.view:all,assigned", "projects.view_financials:all"]],
    },
  ],
  get_correspondence_evidence: [
    {
      key: "opportunity_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["pipeline.view:all,assigned"]],
    },
    {
      key: "project_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned"]],
    },
    {
      key: "correspondence_evidence",
      oauth: ["ops.correspondence.read"],
      groups: [["inbox.view:all,assigned,own"]],
    },
  ],
  search_customers: [
    {
      key: "name",
      oauth: ["ops.customers.read"],
      groups: [["clients.view:all,assigned"]],
    },
    {
      key: "exact_contact",
      oauth: ["ops.customer_contacts.read", "ops.customers.read"],
      groups: [["clients.view:all,assigned"]],
    },
  ],
  search_jobs: [
    {
      key: "opportunity_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["pipeline.view:all,assigned"]],
    },
    {
      key: "project_jobs",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned"]],
    },
  ],
  resolve_job_participants: [
    {
      key: "opportunity",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.view:all,assigned,own",
          "pipeline.view:all,assigned",
        ],
      ],
    },
    {
      key: "project",
      oauth: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.view:all,assigned,own",
          "projects.view:all,assigned",
        ],
      ],
    },
    {
      key: "opportunity:schedule",
      oauth: ["ops.jobs.read"],
      groups: [
        [
          "pipeline.view:all,assigned",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "opportunity:assignment",
      oauth: ["ops.jobs.read"],
      groups: [
        [
          "pipeline.view:all,assigned",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    },
    {
      key: "project:schedule",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned", "tasks.view:all,assigned"]],
    },
    {
      key: "project:assignment",
      oauth: ["ops.jobs.read"],
      groups: [["projects.view:all,assigned", "tasks.view:all,assigned"]],
    },
  ],
  list_site_visits: [
    {
      key: "booked_appointments",
      oauth: ["ops.customers.read", "ops.jobs.read", "ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "clients.view:all,assigned",
          "pipeline.view:all,assigned",
        ],
      ],
    },
    {
      key: "visit_history",
      oauth: ["ops.customers.read", "ops.jobs.read", "ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "clients.view:all,assigned",
          "pipeline.view:all,assigned",
        ],
      ],
    },
    {
      key: "unlinked_history",
      oauth: ["ops.jobs.read"],
      groups: [["pipeline.view:all"]],
    },
  ],
  get_site_visit_context: [
    {
      key: "opportunity",
      oauth: [
        "ops.customers.read",
        "ops.jobs.read",
        "ops.photos.read",
        "ops.schedule.read",
      ],
      groups: [
        [
          "calendar.view:all,own",
          "clients.view:all,assigned",
          "photos.view:all,assigned",
          "pipeline.view:all,assigned",
        ],
      ],
    },
    {
      key: "unlinked",
      oauth: ["ops.jobs.read", "ops.photos.read"],
      groups: [["photos.view:all", "pipeline.view:all"]],
    },
  ],
  prepare_project_cost_allocation: [
    {
      key: "project_cost_allocation",
      oauth: ["ops.financials.prepare"],
      groups: [
        [
          "expenses.edit:all,own",
          "projects.view:all,assigned",
          "projects.view_financials:all",
        ],
      ],
    },
  ],
  commit_project_cost_allocation: [
    {
      key: "project_cost_allocation",
      oauth: ["ops.financials.write"],
      groups: [
        [
          "expenses.edit:all,own",
          "projects.view:all,assigned",
          "projects.view_financials:all",
        ],
      ],
    },
  ],
  prepare_estimate_import: [
    {
      key: "estimate_import",
      oauth: ["ops.financials.prepare"],
      groups: [
        [
          "clients.view:all,assigned",
          "estimates.create:all",
          "pipeline.view:all,assigned",
        ],
        [
          "clients.view:all,assigned",
          "estimates.create:all",
          "projects.view:all,assigned",
        ],
      ],
    },
  ],
  commit_estimate_import: [
    {
      key: "estimate_import",
      oauth: ["ops.financials.write"],
      groups: [
        [
          "clients.view:all,assigned",
          "estimates.create:all",
          "pipeline.view:all,assigned",
        ],
        [
          "clients.view:all,assigned",
          "estimates.create:all",
          "projects.view:all,assigned",
        ],
      ],
    },
  ],
  prepare_catalog_service_change: [
    {
      key: "import",
      oauth: ["ops.catalog.prepare"],
      groups: [["catalog.import:all"]],
    },
    {
      key: "edit",
      oauth: ["ops.catalog.prepare"],
      groups: [["catalog.manage:all"]],
    },
  ],
  commit_catalog_service_change: [
    {
      key: "prepared_catalog_change",
      oauth: ["ops.catalog.write"],
      groups: [["catalog.import:all"], ["catalog.manage:all"]],
    },
  ],
  prepare_client_message_batch: [
    {
      key: "client_message_batch",
      oauth: ["ops.communications.prepare"],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.send:all,assigned",
          "inbox.view:all,assigned,own",
          "pipeline.view:all,assigned",
        ],
        [
          "clients.view:all,assigned",
          "inbox.send:all,assigned",
          "inbox.view:all,assigned,own",
          "projects.view:all,assigned",
        ],
      ],
    },
  ],
  commit_client_message_batch: [
    {
      key: "client_message_batch",
      oauth: ["ops.communications.send"],
      groups: [
        [
          "clients.view:all,assigned",
          "inbox.send:all,assigned",
          "inbox.view:all,assigned,own",
          "pipeline.view:all,assigned",
        ],
        [
          "clients.view:all,assigned",
          "inbox.send:all,assigned",
          "inbox.view:all,assigned,own",
          "projects.view:all,assigned",
        ],
      ],
    },
  ],
  prepare_site_visit_booking: [
    {
      key: "site_visit_booking",
      oauth: ["ops.jobs.prepare", "ops.schedule.prepare"],
      groups: [["pipeline.convert:all,assigned"]],
    },
  ],
  commit_site_visit_booking: [
    {
      key: "site_visit_booking",
      oauth: ["ops.jobs.write", "ops.schedule.write"],
      groups: [["pipeline.convert:all,assigned"]],
    },
  ],
  prepare_site_visit_reschedule: [
    {
      key: "site_visit_reschedule",
      oauth: ["ops.jobs.prepare", "ops.schedule.prepare"],
      groups: [["pipeline.convert:all,assigned"]],
    },
  ],
  commit_site_visit_reschedule: [
    {
      key: "site_visit_reschedule",
      oauth: ["ops.jobs.write", "ops.schedule.write"],
      groups: [["pipeline.convert:all,assigned"]],
    },
  ],
  prepare_site_visit_booking_cancellation: [
    {
      key: "site_visit_booking_cancellation",
      oauth: ["ops.jobs.prepare", "ops.schedule.prepare"],
      groups: [["pipeline.convert:all,assigned"]],
    },
  ],
  commit_site_visit_booking_cancellation: [
    {
      key: "site_visit_booking_cancellation",
      oauth: ["ops.jobs.write", "ops.schedule.write"],
      groups: [["pipeline.convert:all,assigned"]],
    },
  ],
} as const;

function mutableManifest(): CapabilityManifestEntry[] {
  return CAPABILITY_MANIFEST.map((entry) => ({ ...entry }));
}

function inputSchema(name: string) {
  return getCapabilityManifestEntry(name).inputSchema;
}

const JOB_REF = {
  kind: "project",
  id: "20000000-0000-4000-8000-000000000001",
} as const;
const IDEMPOTENCY_KEY = "request-00000001";
const CONFIRMED_CHANGE_SET = {
  change_set_id: "change-set-1",
  confirmation_receipt: "confirmation-receipt-1",
  idempotency_key: IDEMPOTENCY_KEY,
};
const SITE_VISIT_START = {
  utc: "2026-08-12T17:00:00Z",
  local: "2026-08-12T10:00:00",
  timezone: "America/Vancouver",
};

const VALID_INPUTS: Readonly<Record<string, unknown>> = {
  list_scheduled_jobs: {
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-31T00:00:00Z",
  },
  list_job_readiness_issues: {
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-31T00:00:00Z",
  },
  get_job_communication_context: {
    job_ref: JOB_REF,
    purpose: "schedule_notice",
  },
  get_job_conversation_context: {
    job_ref: {
      kind: "project",
      id: "20000000-0000-4000-8000-000000000001",
    },
  },
  list_customer_jobs: {
    customer_ref: {
      kind: "client",
      id: "30000000-0000-4000-8000-000000000001",
    },
  },
  get_job_summary: { job_ref: JOB_REF },
  search_job_history: {
    query: "cedar deck",
    scope: { kind: "jobs", job_refs: [JOB_REF] },
  },
  get_correspondence_evidence: {
    job_ref: JOB_REF,
    evidence_ids: [
      "job_conversation_turn:40000000-0000-4000-8000-000000000001",
    ],
  },
  search_customers: {
    lookup: "name",
    query: "Acme Construction",
  },
  search_jobs: {
    query: "Cedar deck",
  },
  resolve_job_participants: { job_ref: JOB_REF },
  list_site_visits: {
    view: "booked_appointments",
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-31T00:00:00Z",
  },
  get_site_visit_context: {
    anchor: "opportunity",
    opportunity_ref: { kind: "opportunity", id: "opportunity-1" },
    site_visit_id: "site-visit-1",
  },
  prepare_project_cost_allocation: {
    allocations: [
      {
        project_ref: JOB_REF,
        expense_id: "expense-1",
        amount: { amount_minor: 12_500, currency: "CAD" },
        expected_expense_version: "expense-version-1",
        source_evidence_id: "evidence-1",
      },
    ],
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_project_cost_allocation: CONFIRMED_CHANGE_SET,
  prepare_estimate_import: {
    job_ref: { kind: "opportunity", id: "opportunity-1" },
    customer_ref: { kind: "client", id: "client-1" },
    source: {
      kind: "ops_source",
      file_id: "file-1",
      content_hash: `sha256:${"a".repeat(64)}`,
      revision: "file-version-1",
    },
    estimate: {
      title: "Front stairs",
      line_items: [
        {
          description: "Cedar stair package",
          quantity: 1,
          unit_price: { amount_minor: 250_000, currency: "CAD" },
          tax_rate_basis_points: 500,
          source_locator: "page 2, row 4",
        },
      ],
    },
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_estimate_import: CONFIRMED_CHANGE_SET,
  prepare_catalog_service_change: {
    mode: "import",
    source: {
      kind: "model_transcribed",
      host: "claude",
      filename: "services.xlsx",
      declared_hash: `sha256:${"b".repeat(64)}`,
      transcribed_at: "2026-08-07T20:00:00Z",
    },
    changes: [
      {
        operation: "upsert_service",
        name: "Post replacement",
        unit: "each",
        unit_price: { amount_minor: 45_000, currency: "CAD" },
        source_locator: "Services!A12:E12",
      },
    ],
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_catalog_service_change: CONFIRMED_CHANGE_SET,
  prepare_client_message_batch: {
    messages: [
      {
        job_ref: JOB_REF,
        recipient: {
          contact_id: "contact-1",
          evidence_id: "evidence-1",
        },
        channel: "email",
        subject: "Schedule for August 12",
        body_plain: "Your crew is scheduled for August 12 at 8:00 AM.",
        expected_thread_version: "thread-version-1",
      },
    ],
    source_evidence_ids: ["evidence-1"],
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_client_message_batch: CONFIRMED_CHANGE_SET,
  prepare_site_visit_booking: {
    opportunity_ref: { kind: "opportunity", id: "opportunity-1" },
    scheduled_start: SITE_VISIT_START,
    source_evidence_ids: ["evidence-1"],
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_site_visit_booking: CONFIRMED_CHANGE_SET,
  prepare_site_visit_reschedule: {
    site_visit_id: "site-visit-1",
    scheduled_start: SITE_VISIT_START,
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_site_visit_reschedule: CONFIRMED_CHANGE_SET,
  prepare_site_visit_booking_cancellation: {
    site_visit_id: "site-visit-1",
    idempotency_key: IDEMPOTENCY_KEY,
  },
  commit_site_visit_booking_cancellation: CONFIRMED_CHANGE_SET,
};

describe("agent capability manifest", () => {
  it("registers exactly thirteen reads and seven write pairs", () => {
    expect(
      CAPABILITY_MANIFEST.map((entry) => [entry.name, entry.operation])
    ).toEqual(EXPECTED_CAPABILITIES);
    expect(
      CAPABILITY_MANIFEST.filter((entry) => entry.operation === "read")
    ).toHaveLength(13);
    expect(
      CAPABILITY_MANIFEST.filter((entry) => entry.operation !== "read")
    ).toHaveLength(14);

    const names = CAPABILITY_MANIFEST.map((entry) => entry.name);
    expect(names).not.toContain("prepare_catalog_import");
    expect(names).not.toContain("commit_catalog_import");
    expect(names).not.toContain("start_site_visit");
    expect(names).not.toContain("complete_site_visit");
    expect(names).not.toContain("complete_site_visit_guarded");
  });

  it("keeps implementation availability separate from external exposure", () => {
    // P1 MCP mount (2026-08-18): the nine implemented reads are externally
    // exposed; everything else stays dark. Implemented-and-exposed move
    // together for reads by deliberate choice, never by construction — the
    // manifest invariant still rejects exposing an unimplemented capability.
    for (const capability of CAPABILITY_MANIFEST) {
      const implemented = [
        "get_job_conversation_context",
        "list_scheduled_jobs",
        "list_job_readiness_issues",
        "get_job_communication_context",
        "list_customer_jobs",
        "get_job_summary",
        "search_job_history",
        "get_correspondence_evidence",
        "resolve_job_participants",
      ].includes(capability.name);
      expect(capability.availability).toEqual({
        implementation: implemented ? "available" : "unavailable",
        externalExposure: implemented ? "enabled" : "disabled",
      });
      expect(capability.rolloutFlag).toMatch(
        /^agent_control_plane\.capability\.[a-z][a-z0-9_]*$/
      );
    }
  });

  it("carries immutable, nominal authorization policy variants", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-20.capability-manifest.v7"
    );
    expect(Object.isFrozen(CAPABILITY_MANIFEST)).toBe(true);

    for (const capability of CAPABILITY_MANIFEST) {
      const task12Revision = [
        "get_job_communication_context",
        "resolve_job_participants",
      ].includes(capability.name);
      const task13Revision = [
        "list_customer_jobs",
        "get_job_summary",
        "search_job_history",
        "get_correspondence_evidence",
      ].includes(capability.name);
      const discoveryRevision = ["search_customers", "search_jobs"].includes(
        capability.name
      );
      expect(capability.schemaRevision).toBe(
        task12Revision
          ? "2026-08-13.v1"
          : task13Revision
            ? "2026-08-14.v1"
            : discoveryRevision
              ? DISCOVERY_CAPABILITY_SCHEMA_REVISION
              : CONTRACT_VERSION
      );
      expect(capability.authorization.variants.length).toBeGreaterThan(0);
      expect(Object.isFrozen(capability)).toBe(true);
      expect(Object.isFrozen(capability.authorization.variants)).toBe(true);

      for (const variant of capability.authorization.variants) {
        expect(isManifestCapabilityPolicy(variant.policy)).toBe(true);
        expect(variant.policy).toMatchObject({
          capabilityId: capability.name,
          capabilityRevision: `${capability.name}:${capability.schemaRevision}`,
          capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
        });
      }
    }
  });

  it("selects and freezes exact conditional readiness policies", () => {
    const photoOnly = resolveCapabilityAuthorization(
      "list_job_readiness_issues",
      {
        from: "2026-08-01T00:00:00Z",
        to: "2026-08-31T00:00:00Z",
        rule_codes: ["SITE_PHOTOS_MISSING"],
      }
    );
    const defaultRules = resolveCapabilityAuthorization(
      "list_job_readiness_issues",
      VALID_INPUTS.list_job_readiness_issues
    );

    expect(photoOnly.variants.map((variant) => variant.key)).toEqual([
      "readiness_base",
      "readiness_site_photos",
    ]);
    expect(defaultRules.variants.map((variant) => variant.key)).toEqual([
      "readiness_base",
      "readiness_site_photos",
      "readiness_customer",
    ]);
    expect(Object.isFrozen(defaultRules.parsedInput.rule_codes)).toBe(true);
    for (const variant of defaultRules.variants) {
      expect(Object.isFrozen(variant.selector)).toBe(true);
    }
  });

  it("selects only the job-kind policy named by a strictly parsed JobRef", () => {
    const opportunity = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: {
        kind: "opportunity",
        id: "10000000-0000-4000-8000-000000000001",
      },
    });
    const project = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: JOB_REF,
    });

    expect(opportunity.variants.map((variant) => variant.key)).toEqual([
      "opportunity",
    ]);
    expect(
      opportunity.variants.flatMap((variant) =>
        variant.policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      )
    ).toEqual(["pipeline.view"]);
    expect(project.variants.map((variant) => variant.key)).toEqual(["project"]);
    expect(
      project.variants.flatMap((variant) =>
        variant.policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      )
    ).toEqual(["projects.view"]);
  });

  it("adds financial authority only when the financial summary section is requested", () => {
    const baseline = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: JOB_REF,
      sections: ["schedule"],
    });
    const financial = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: JOB_REF,
      sections: ["financials"],
      financial_components: ["estimate_rollup"],
    });

    expect(baseline.variants.map((variant) => variant.key)).toEqual([
      "project",
      "project:schedule",
    ]);
    expect(
      baseline.variants.flatMap((variant) =>
        variant.policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      )
    ).not.toContain("projects.view_financials");

    expect(financial.variants.map((variant) => variant.key)).toEqual([
      "project",
      "project:financials:estimate_rollup",
    ]);
    expect(financial.variants[1].policy.requiredOAuthScopes).toEqual([
      "ops.financials.read",
    ]);
    expect(financial.variants[1].policy.permissionRequirementGroups).toEqual([
      [
        {
          permission: "estimates.view",
          allowedScopes: ["all", "assigned"],
        },
        {
          permission: "projects.view_financials",
          allowedScopes: ["all"],
        },
      ],
    ]);
  });

  it("adds exact schedule and photo authority to current communication context", () => {
    const jobRef = {
      kind: "opportunity" as const,
      id: "10000000-0000-4000-8000-000000000001",
    };
    const schedule = resolveCapabilityAuthorization(
      "get_job_communication_context",
      {
        job_ref: jobRef,
        purpose: "schedule_notice",
      }
    );
    const photo = resolveCapabilityAuthorization(
      "get_job_communication_context",
      {
        job_ref: jobRef,
        purpose: "photo_request",
      }
    );

    expect(schedule.variants.map((variant) => variant.key)).toEqual([
      "opportunity",
      "opportunity:schedule_notice",
    ]);
    expect(photo.variants.map((variant) => variant.key)).toEqual([
      "opportunity",
      "opportunity:photo_request",
    ]);
    expect(schedule.variants[1]?.policy).toMatchObject({
      requiredOAuthScopes: ["ops.schedule.read"],
      permissionRequirementGroups: [
        [
          { permission: "calendar.view" },
          { permission: "projects.view" },
          { permission: "tasks.view" },
        ],
      ],
    });
    expect(photo.variants[1]?.policy).toMatchObject({
      requiredOAuthScopes: ["ops.photos.read", "ops.schedule.read"],
      permissionRequirementGroups: [
        [
          { permission: "calendar.view" },
          { permission: "photos.view" },
          { permission: "projects.view" },
          { permission: "tasks.view" },
        ],
      ],
    });
    expect(Object.isFrozen(schedule.parsedInput.job_ref)).toBe(true);
  });

  it("adds project and task authority without calendar timing for participant schedule and assignment", () => {
    const jobRef = {
      kind: "opportunity" as const,
      id: "10000000-0000-4000-8000-000000000001",
    };
    for (const purpose of ["schedule", "assignment"] as const) {
      const resolved = resolveCapabilityAuthorization(
        "resolve_job_participants",
        { job_ref: jobRef, purpose }
      );
      expect(resolved.variants.map((variant) => variant.key)).toEqual([
        "opportunity",
        `opportunity:${purpose}`,
      ]);
      expect(resolved.variants[1]?.selector).toEqual({
        kind: "job_participant_purpose",
        jobKind: "opportunity",
        purpose,
      });
      expect(resolved.variants[1]?.policy.requiredOAuthScopes).toEqual([
        "ops.jobs.read",
      ]);
      expect(
        resolved.variants[1]?.policy.permissionRequirementGroups[0]?.map(
          (requirement) => requirement.permission
        )
      ).toEqual(["pipeline.view", "projects.view", "tasks.view"]);
      expect(
        resolved.variants[1]?.policy.permissionRequirementGroups[0]?.map(
          (requirement) => requirement.permission
        )
      ).not.toContain("calendar.view");
    }
  });

  it("accepts only current UUID job inputs for communication and participants", () => {
    for (const [capability, purpose] of [
      ["get_job_communication_context", "general"],
      ["resolve_job_participants", "general"],
    ] as const) {
      expect(() =>
        resolveCapabilityAuthorization(capability, {
          job_ref: { kind: "project", id: "legacy-project-id" },
          purpose,
        })
      ).toThrow();
      expect(() =>
        resolveCapabilityAuthorization(capability, {
          job_ref: JOB_REF,
          purpose,
          as_of: "2026-08-12T00:00:00.000Z",
        })
      ).toThrow();
    }
  });

  it("declares the project visibility proof required by every project financial write", () => {
    for (const name of [
      "prepare_project_cost_allocation",
      "commit_project_cost_allocation",
      "prepare_estimate_import",
      "commit_estimate_import",
    ]) {
      const permissions = getCapabilityManifestEntry(
        name
      ).authorization.variants.flatMap((variant) =>
        variant.policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      );
      expect(permissions, name).toContain("projects.view");
    }
  });

  it("rejects caller fields that could smuggle a policy or tenant boundary", () => {
    expect(() =>
      resolveCapabilityAuthorization("get_job_summary", {
        job_ref: { kind: "project", id: "project-1" },
        company_id: "other-company",
      })
    ).toThrow();
    expect(() =>
      resolveCapabilityAuthorization("get_job_summary", {
        job_ref: { kind: "project", id: "project-1" },
        permission: "projects.view_financials",
      })
    ).toThrow();
  });

  it("publishes exact MCP annotation hints and never labels a write read-only", () => {
    expect(
      Object.fromEntries(
        CAPABILITY_MANIFEST.map((entry) => [
          entry.name,
          [
            entry.annotations.readOnlyHint,
            entry.annotations.destructiveHint,
            entry.annotations.idempotentHint,
            entry.annotations.openWorldHint,
          ],
        ])
      )
    ).toEqual(EXPECTED_ANNOTATIONS);

    for (const capability of CAPABILITY_MANIFEST) {
      expect(capability.operation === "read").toBe(
        capability.annotations.readOnlyHint
      );
    }
  });

  it("locks every OAuth scope and OPS permission group to the reviewed matrix", () => {
    expect(
      Object.fromEntries(
        CAPABILITY_MANIFEST.map((entry) => [
          entry.name,
          entry.authorization.variants.map((variant) => ({
            key: variant.key,
            oauth: variant.policy.requiredOAuthScopes,
            groups: variant.policy.permissionRequirementGroups.map((group) =>
              group.map(
                (requirement) =>
                  `${requirement.permission}:${requirement.allowedScopes.join(",")}`
              )
            ),
          })),
        ])
      )
    ).toEqual(EXPECTED_POLICY_MATRIX);
  });

  it("declares bounded prompt-safe evidence, audit, rate, and confirmation policy", () => {
    for (const capability of CAPABILITY_MANIFEST) {
      expect(capability.description.length).toBeGreaterThan(0);
      expect(capability.riskTier).toMatch(/^(low|medium|high|critical)$/);
      expect(capability.bounds.maxInputBytes).toBeGreaterThan(0);
      expect(capability.bounds.maxOutputCharacters).toBeGreaterThan(0);
      expect(capability.bounds.maxResultItems).toBeGreaterThan(0);
      expect(capability.evidencePolicy.promptSafeOutput).toBe(true);
      expect(capability.evidencePolicy.maxEvidenceRefs).toBeGreaterThan(0);
      expect(capability.auditClass.length).toBeGreaterThan(0);
      expect(capability.rateLimitBucket.length).toBeGreaterThan(0);

      if (capability.operation === "read") {
        expect(capability.confirmationPolicy).toEqual({ kind: "not_required" });
        expect(capability.idempotencyPolicy).toEqual({ kind: "inherent" });
      } else {
        expect(capability.idempotencyPolicy).toMatchObject({
          kind: "required",
          keyField: "idempotency_key",
          conflictOnArgumentsHashMismatch: true,
        });
      }
    }
  });

  it("binds every commit to its exact prepare sibling and confirmation receipt", () => {
    for (const capability of CAPABILITY_MANIFEST.filter(
      (entry) => entry.operation === "commit"
    )) {
      expect(capability.confirmationPolicy).toMatchObject({
        kind: "confirmation_receipt",
        exactPreviewRequired: true,
        singleUse: true,
      });
      if (capability.confirmationPolicy.kind !== "confirmation_receipt") {
        throw new Error("Expected a commit confirmation policy");
      }
      const prepare = getCapabilityManifestEntry(
        capability.confirmationPolicy.prepareCapability
      );
      expect(prepare.operation).toBe("prepare");
      expect(prepare.writeFamily).toBe(capability.writeFamily);
    }
  });

  it("uses strict zod-v4 input contracts for every registered capability", () => {
    for (const capability of CAPABILITY_MANIFEST) {
      const validInput = VALID_INPUTS[capability.name];
      expect(validInput, capability.name).toBeDefined();
      expect(
        capability.inputSchema.safeParse(validInput).success,
        capability.name
      ).toBe(true);
      expect(
        capability.inputSchema.safeParse({
          ...(validInput as Record<string, unknown>),
          company_id: "caller-controlled-company",
        }).success,
        `${capability.name} must reject unknown fields`
      ).toBe(false);
    }
  });

  it.each([
    [
      "list_scheduled_jobs",
      {
        from: "2026-01-01T00:00:00Z",
        to: "2026-04-02T00:00:01Z",
      },
    ],
    [
      "list_job_readiness_issues",
      {
        from: "2026-01-01T00:00:00Z",
        to: "2026-04-02T00:00:01Z",
      },
    ],
    [
      "list_customer_jobs",
      {
        customer_ref: {
          kind: "client",
          id: "30000000-0000-4000-8000-000000000001",
        },
        date_window: {
          field: "updated_at",
          from: "2025-01-01T00:00:00Z",
          to_exclusive: "2026-01-02T00:00:01Z",
        },
      },
    ],
    [
      "search_job_history",
      {
        query: "a".repeat(501),
        scope: { kind: "jobs", job_refs: [JOB_REF] },
      },
    ],
    [
      "get_job_conversation_context",
      {
        job_ref: JOB_REF,
        exact_turn_limit: 51,
      },
    ],
    [
      "get_correspondence_evidence",
      {
        job_ref: JOB_REF,
        evidence_ids: Array.from(
          { length: 21 },
          (_, index) =>
            `job_conversation_turn:40000000-0000-4000-8000-${String(
              index + 1
            ).padStart(12, "0")}`
        ),
      },
    ],
  ])("enforces the hard input bound for %s", (name, value) => {
    expect(inputSchema(name).safeParse(value).success).toBe(false);
  });

  it("bounds material writes to 25 changes and outbound messages to 10", () => {
    const allocation = (
      VALID_INPUTS.prepare_project_cost_allocation as {
        allocations: readonly unknown[];
      }
    ).allocations[0];
    expect(
      inputSchema("prepare_project_cost_allocation").safeParse({
        allocations: Array.from({ length: 26 }, () => allocation),
        idempotency_key: IDEMPOTENCY_KEY,
      }).success
    ).toBe(false);

    const message = (
      VALID_INPUTS.prepare_client_message_batch as {
        messages: readonly unknown[];
      }
    ).messages[0];
    expect(
      inputSchema("prepare_client_message_batch").safeParse({
        messages: Array.from({ length: 11 }, () => message),
        source_evidence_ids: ["evidence-1"],
        idempotency_key: IDEMPOTENCY_KEY,
      }).success
    ).toBe(false);
  });

  it.each([
    {
      name: "duplicate stable names even under a different schema revision",
      mutate(entries: CapabilityManifestEntry[]) {
        entries.push({
          ...entries[0],
          schemaRevision: "2026-08-07.v2",
        });
      },
    },
    {
      name: "a blank schema revision",
      mutate(entries: CapabilityManifestEntry[]) {
        entries[0] = { ...entries[0], schemaRevision: " " };
      },
    },
    {
      name: "a generic raw-data capability name",
      mutate(entries: CapabilityManifestEntry[]) {
        entries[0] = { ...entries[0], name: "get_raw_data" };
      },
    },
    {
      name: "a device-owned site-visit lifecycle capability",
      mutate(entries: CapabilityManifestEntry[]) {
        entries[0] = { ...entries[0], name: "prepare_site_visit_start" };
      },
    },
    {
      name: "an externally exposed unavailable implementation",
      mutate(entries: CapabilityManifestEntry[]) {
        entries[0] = {
          ...entries[0],
          availability: {
            implementation: "unavailable",
            externalExposure: "enabled",
          },
        };
      },
    },
    {
      name: "a write mislabeled read-only",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.operation === "prepare"
        );
        entries[index] = {
          ...entries[index],
          annotations: {
            ...entries[index].annotations,
            readOnlyHint: true,
          },
        };
      },
    },
    {
      name: "a commit without its prepare sibling",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.name === "prepare_estimate_import"
        );
        entries.splice(index, 1);
      },
    },
    {
      name: "an empty authorization variant set",
      mutate(entries: CapabilityManifestEntry[]) {
        entries[0] = {
          ...entries[0],
          authorization: {
            ...entries[0].authorization,
            variants: [],
          },
        };
      },
    },
    {
      name: "an unregistered OAuth consent scope",
      mutate(entries: CapabilityManifestEntry[]) {
        const entry = entries[0];
        const variant = entry.authorization.variants[0];
        entries[0] = {
          ...entry,
          authorization: {
            variants: [
              {
                ...variant,
                policy: defineCapabilityPolicyForManifest({
                  capabilityId: entry.name,
                  capabilityRevision: `${entry.name}:${entry.schemaRevision}`,
                  capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
                  requiredOAuthScopes: ["ops.unreviewed.read"],
                  permissionRequirementGroups:
                    variant.policy.permissionRequirementGroups,
                }),
              },
            ],
          },
        };
      },
    },
    {
      name: "a forged conditional selector field",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.name === "list_job_readiness_issues"
        );
        const entry = entries[index];
        const variants = [...entry.authorization.variants];
        variants[1] = {
          ...variants[1],
          selector: {
            kind: "input_array_contains",
            field: "permissions",
            value: "SITE_PHOTOS_MISSING",
          } as never,
        };
        entries[index] = {
          ...entry,
          authorization: { variants },
        };
      },
    },
    {
      name: "a forged conditional selector value",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.name === "list_job_readiness_issues"
        );
        const entry = entries[index];
        const variants = [...entry.authorization.variants];
        variants[1] = {
          ...variants[1],
          selector: {
            kind: "input_array_contains",
            field: "rule_codes",
            value: "ADMIN_BYPASS",
          } as never,
        };
        entries[index] = {
          ...entry,
          authorization: { variants },
        };
      },
    },
    {
      name: "a forged participant-purpose selector field",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.name === "resolve_job_participants"
        );
        const entry = entries[index];
        const variants = [...entry.authorization.variants];
        variants[2] = {
          ...variants[2],
          selector: {
            kind: "job_participant_purpose",
            jobKind: "opportunity",
            field: "permission",
            purpose: "schedule",
          } as never,
        };
        entries[index] = { ...entry, authorization: { variants } };
      },
    },
    {
      name: "a forged participant-purpose selector value",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.name === "resolve_job_participants"
        );
        const entry = entries[index];
        const variants = [...entry.authorization.variants];
        variants[2] = {
          ...variants[2],
          selector: {
            kind: "job_participant_purpose",
            jobKind: "opportunity",
            purpose: "timing",
          } as never,
        };
        entries[index] = { ...entry, authorization: { variants } };
      },
    },
    {
      name: "a participant-purpose selector attached to another capability",
      mutate(entries: CapabilityManifestEntry[]) {
        const index = entries.findIndex(
          (entry) => entry.name === "get_job_communication_context"
        );
        const entry = entries[index];
        const variants = [...entry.authorization.variants];
        variants[2] = {
          ...variants[2],
          selector: {
            kind: "job_participant_purpose",
            jobKind: "opportunity",
            purpose: "schedule",
          },
        };
        entries[index] = { ...entry, authorization: { variants } };
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const entries = mutableManifest();
    mutate(entries);
    expect(() =>
      assertCapabilityManifestInvariants(entries, CAPABILITY_MANIFEST_REVISION)
    ).toThrow(TypeError);
  });
});

// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import {
  createSiteVisitWorkflowService,
  isTrustedSiteVisitWorkflowService,
} from "../../services/site-visit-workflow/site-visit-workflow-service";
import type { ScheduleChangeRpcClient } from "../../services/schedule-change/schedule-change-repository";
import type { ActorAuthoritySnapshot } from "../../actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "../../actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "../../actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "../../actor/resolve-actor-context";
import {
  SITE_VISIT_WORKFLOW_MANIFEST,
  SITE_VISIT_WORKFLOW_REVISION,
  SiteVisitWorkflowResultSchema,
  siteVisitToolInputSchema,
} from "../../contracts/site-visit-workflow";
import {
  SITE_VISIT_WORKFLOW_CAPABILITY_MANIFEST,
  CATALOG_AUTHORING_CAPABILITY_MANIFEST,
} from "../../registry/capability-manifest";

const runtimeReadRpc = vi.hoisted(() =>
  vi.fn(async () => ({ data: [], error: null }))
);
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: runtimeReadRpc }),
}));

const company = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const recordId = "55555555-5555-4555-8555-555555555555";
const actionId = "66666666-6666-4666-8666-666666666666";
const hash = `sha256:${"a".repeat(64)}`;
const scopes = [
  "ops.site_visit_templates.read",
  "ops.site_visit_templates.prepare",
  "ops.site_visits.read",
  "ops.site_visits.prepare",
  "ops.schedule.read",
  "ops.team.read",
];
const permissions = [
  "agent.review",
  "settings.company",
  "pipeline.view",
  "pipeline.edit",
  "pipeline.convert",
  "calendar.view",
  "team.view",
] as const;
const request = {
  idempotency_key: "template-test-001",
  definition: {
    name: "Deck assessment",
    slug: "deck-assessment",
    is_default: true,
    fields: [
      {
        id: "power",
        label: "Power available",
        kind: "checkbox",
        required: true,
        sortOrder: 1,
      },
    ],
  },
};
async function fixture() {
  const snapshot: ActorAuthoritySnapshot = {
    actorUserId: actorId,
    companyId: company,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [...permissions],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all",
    })),
    permissionSnapshotRevision: `sha256:${"9".repeat(64)}`,
  };
  const authority = new StubAuthoritySupabaseRpcClient(snapshot);
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: actorId,
      companyId: company,
      oauthGrantId: "33333333-3333-4333-8333-333333333333",
      oauthClientId: "44444444-4444-4444-8444-444444444444",
      validatedScopes: scopes,
      tokenId: "site-visit-test",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "8".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authority.repository,
    requestId: "site-visit-test",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: SITE_VISIT_WORKFLOW_MANIFEST,
  });
  authority.actorLookups.length = 0;
  return { actor, authority };
}
function result() {
  return {
    request_id: "site-visit-test",
    schema_revision: SITE_VISIT_WORKFLOW_REVISION,
    status: "approval_required",
    action_id: actionId,
    change_set_id: recordId,
    preview_sha256: hash,
    expires_at: "2026-10-10T12:30:00Z",
    replayed: false,
    receipt: null,
    content_kind: "untrusted_business_data",
    proposal: {
      operation: "create_template",
      title: "Create checklist: Deck assessment",
      ready: true,
      entity: "template",
      site_visit_id: null,
      template_id: recordId,
      rows: [
        {
          id: recordId,
          base_revision: 0,
          before: null,
          values: { id: recordId, company_id: company, ...request.definition },
        },
      ],
      sources: [],
      missing_required: [],
      source_sha256: hash,
      timezone_proof: null,
      effects: {
        records: 1,
        physical_visit_status_changed: false,
        calendar_intent: "not_requested",
        customer_messages_sent: 0,
      },
      content_kind: "untrusted_business_data",
    },
  };
}
function bookingResult() {
  return {
    ...result(),
    proposal: {
      operation: "book",
      title: "Book site visit",
      ready: true,
      entity: "appointment",
      site_visit_id: null,
      template_id: null,
      opportunity_id: recordId,
      lead_title: "Exact lead",
      rows: [],
      sources: [],
      missing_required: [],
      source_sha256: hash,
      timezone_proof: {
        timezone: "America/Vancouver",
        probes: [
          {
            local: "2026-11-02T00:00:00",
            instant: "2026-11-02T07:00:00Z",
            utc_offset_minutes: -420,
          },
        ],
      },
      appointment: {
        local_start: "2026-11-02T00:00:00",
        timezone: "America/Vancouver",
        starts_at: "2026-11-02T07:00:00Z",
        ends_at: "2026-11-02T08:00:00Z",
        duration_minutes: 60,
        assignee_ids: [actorId],
        crew: [{ id: actorId, name: "Operator" }],
        reminder_lead_minutes: null,
      },
      effects: {
        records: 1,
        physical_visit_status_changed: false,
        calendar_intent: "queued",
        customer_messages_sent: 0,
        appointment_status: "scheduled",
        lead_stage: "qualifying",
        timeline: "Site visit booked",
      },
      content_kind: "untrusted_business_data",
    },
  };
}

import {
  createSiteVisitWorkflowCandidateMcpServer,
  createOpsMcpServer,
} from "../server-factory";
import { createMcpHandler } from "../sdk";
import { createDurableMcpRateLimiter } from "../durable-rate-limit";
import {
  MCP_EXPOSURE_V22,
  resolveActiveMcpExposure,
} from "../../registry/mcp-exposure-catalog";
import { SITE_VISIT_TOOL_OPERATIONS } from "../../contracts/site-visit-workflow";
import { MCP_CONSENT_CATALOG_V17 } from "../oauth/scope-catalog";
import type { OpsAgentCapabilityService } from "../../services/capability-service";
// Isolate the existing secondary in-memory windows without stubbing the limiter.
let testMinute = 0;
beforeEach(() =>
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 10) + ++testMinute * 61000))
);
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function protocolFixture(
  era: "legacy" | "modern",
  domainOverride?: OpsAgentCapabilityService
) {
  const { actor, authority } = await fixture();
  const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
    Promise.resolve({ data: result(), error: null })
  );
  const rateRpc = vi.fn(async () => ({
    data: [
      { allowed: true, remaining_units: 5, reset_at: "2099-01-01T00:00:00Z" },
    ],
    error: null,
  }));
  const service = createSiteVisitWorkflowService({
    rpc,
    authorityRepository: authority.repository,
  });
  const domain = new Proxy(service, {
    get(t, k) {
      return k in t ? Reflect.get(t, k) : async () => ({ ok: true });
    },
  }) as OpsAgentCapabilityService;
  const input = {
    requestId: actor.requestId,
    actorContext: actor,
    grantFacts: {
      clientName: "Site visit protocol fixture",
      grantId: "33333333-3333-4333-8333-333333333333",
      clientId: "44444444-4444-4444-8444-444444444444",
      actorUserId: actor.actorUserId,
      companyId: actor.companyId,
      scopes,
      grantRevision: "8".repeat(32),
      exposureRevision: MCP_EXPOSURE_V22.revision,
      tokenId: "b".repeat(64),
      expiresAtEpochSeconds: 4000000000,
    },
    protocolEra: era,
    domainService: domainOverride ?? domain,
    auditRpcClient: { rpc: async () => ({ data: null, error: null }) },
    durableRateLimiter: createDurableMcpRateLimiter({ rpc: rateRpc }),
  };
  const handler = createMcpHandler(
    (context) =>
      createSiteVisitWorkflowCandidateMcpServer({
        ...input,
        protocolEra: context.era,
      }),
    { legacy: "stateless" }
  );
  return {
    rpc,
    rateRpc,
    authority,
    input,
    call: async (method: string, params: unknown) => {
      const response = await handler.fetch(
        new Request("https://app.opsapp.co/api/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(era === "modern"
              ? {
                  "MCP-Protocol-Version": "2026-07-28",
                  "Mcp-Method": method,
                  ...(method === "tools/call"
                    ? { "Mcp-Name": (params as { name: string }).name }
                    : {}),
                }
              : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params:
              era === "modern"
                ? {
                    ...(params as object),
                    _meta: {
                      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                      "io.modelcontextprotocol/clientInfo": {
                        name: "fixture",
                        version: "1",
                      },
                      "io.modelcontextprotocol/clientCapabilities": {},
                    },
                  }
                : params,
          }),
        })
      );
      const raw = await response.text();
      return JSON.parse(
        raw
          .split(/\r?\n/)
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
          .trim() ?? raw
      );
    },
  };
}
const inputs: Record<string, unknown> = {
  list_site_visit_templates: {},
  get_site_visit_template: { template_id: recordId },
  get_site_visit_form: { site_visit_id: recordId },
  get_site_visit_source: { site_visit_id: recordId, artifact_id: actionId },
  prepare_site_visit_template: request,
  prepare_site_visit_template_edit: {
    ...request,
    template_id: recordId,
    expected_revision: 1,
  },
  prepare_site_visit_booking: {
    idempotency_key: "booking-001",
    opportunity_id: recordId,
    local_start: "2026-10-10T12:00:00",
    duration_minutes: 60,
    assignee_ids: [actorId],
    reminder_lead_minutes: null,
  },
  prepare_site_visit_reschedule: {
    idempotency_key: "reschedule-001",
    site_visit_id: recordId,
    expected_sha256: hash,
  },
  prepare_site_visit_booking_cancellation: {
    idempotency_key: "cancel-001",
    site_visit_id: recordId,
    expected_sha256: hash,
  },
  prepare_site_visit_checklist_selection: {
    idempotency_key: "selection-001",
    site_visit_id: recordId,
    template_id: actionId,
    expected_template_revision: 1,
    expected_form_sha256: hash,
  },
  prepare_site_visit_answers: {
    idempotency_key: "answers-001",
    site_visit_id: recordId,
    changes: [
      {
        answer_id: actionId,
        expected_revision: 1,
        intent: "unknown",
        value: null,
        evidence: [],
        reason: "Not measured",
      },
    ],
    sources: [],
  },
};
const expectedDiscovery = [
  "search_customers",
  "get_customer_context",
  "search_jobs",
  "get_job_summary",
  "list_site_visits",
  "get_site_visit_context",
  "get_deck_design_geometry",
  "get_company_context",
  "list_team_members",
  "list_team_availability",
];
const discoveryInputs: Record<string, unknown> = {
  search_customers: { lookup: "name", query: "Taylor" },
  get_customer_context: {
    customer_ref: { kind: "client", id: recordId },
    sections: ["job_rollup"],
    job_kinds: ["opportunity"],
  },
  search_jobs: { query: "Deck", job_kinds: ["opportunity"] },
  get_job_summary: {
    job_ref: { kind: "opportunity", id: recordId },
    sections: ["identity"],
  },
  list_site_visits: {
    view: "booked_appointments",
    from: "2026-09-10T00:00:00Z",
    to: "2026-09-11T00:00:00Z",
  },
  get_site_visit_context: {
    anchor: "opportunity",
    opportunity_ref: { kind: "opportunity", id: actionId },
    site_visit_ref: { kind: "site_visit", id: recordId },
    sections: ["booking"],
  },
  get_deck_design_geometry: {
    source: "site_visit_artifact",
    site_visit_ref: { kind: "site_visit", id: recordId },
    deck_design_ref: `ops_deck_design:v1:${"a".repeat(32)}`,
  },
  get_company_context: {},
  list_team_members: {},
  list_team_availability: {
    view: "company",
    starts_on: "2026-09-10",
    ends_on: "2026-09-11",
  },
};
it("restricts candidate discovery and consent to the supported site-visit workflow", () => {
  expect(MCP_EXPOSURE_V22.toolIds).toEqual([
    ...expectedDiscovery,
    ...Object.keys(SITE_VISIT_TOOL_OPERATIONS),
  ]);
  expect(
    MCP_EXPOSURE_V22.grantableScopes.filter((scope) => !scope.endsWith(".read"))
  ).toEqual(["ops.site_visit_templates.prepare", "ops.site_visits.prepare"]);
  expect(MCP_CONSENT_CATALOG_V17.registeredScopes).toEqual(
    MCP_EXPOSURE_V22.grantableScopes
  );
  expect(MCP_CONSENT_CATALOG_V17.allowedOperations).toEqual([
    "read",
    "prepare",
  ]);
});
for (const era of ["legacy", "modern"] as const)
  describe(`site visit candidate ${era}`, () => {
    it.each(expectedDiscovery)(
      "routes retained %s through the existing limiter and real current-authority facade",
      async (name) => {
        vi.stubEnv("OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY", "ab".repeat(32));
        const { getMcpServerRuntime } = await import("../runtime");
        const runtime = getMcpServerRuntime();
        const f = await protocolFixture(era, runtime.domainService);
        runtimeReadRpc.mockClear();
        const result = await f.call("tools/call", {
          name,
          arguments: discoveryInputs[name],
        });
        expect(result.result?.isError, JSON.stringify(result)).toBe(true);
        expect(f.rateRpc).toHaveBeenCalledWith(
          "consume_agent_mcp_rate_limit_as_system",
          expect.objectContaining({
            p_capability_id: name,
            p_protocol_era: era,
            p_grant_id: f.input.grantFacts.grantId,
          })
        );
        // Missing current membership must stop each actual read before source access.
        expect(runtimeReadRpc).toHaveBeenCalledTimes(1);
        expect(runtimeReadRpc).toHaveBeenCalledWith(
          "resolve_agent_actor_authority_as_system",
          expect.objectContaining({
            p_actor_user_id: actorId,
            p_company_id: company,
          })
        );
        expect(f.rpc).not.toHaveBeenCalled();
      }
    );
    it.each([
      "inspect_catalog_changes",
      "prepare_catalog_changes",
      "prepare_inventory_adjustment",
      "prepare_customer_update",
      "prepare_financial_document",
    ])("does not advertise or dispatch unrelated %s", async (name) => {
      const f = await protocolFixture(era);
      const result = await f.call("tools/call", { name, arguments: {} });
      expect(
        result.error ?? (result.result?.isError ? result.result : null)
      ).toBeTruthy();
      expect(f.rateRpc).not.toHaveBeenCalled();
      expect(f.rpc).not.toHaveBeenCalled();
    });
    it("lists exact candidate tools without public activation or physical/commit operations", async () => {
      const f = await protocolFixture(era);
      const r = await f.call("tools/list", {});
      expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(
        MCP_EXPOSURE_V22.toolIds
      );
      expect(
        MCP_EXPOSURE_V22.toolIds.filter((n) =>
          Object.hasOwn(SITE_VISIT_TOOL_OPERATIONS, n)
        )
      ).toHaveLength(11);
      expect(
        MCP_EXPOSURE_V22.toolIds.some((n) =>
          /^(commit_|start_site_visit|complete_site_visit)/.test(n)
        )
      ).toBe(false);
      expect(resolveActiveMcpExposure().revision).not.toBe(
        MCP_EXPOSURE_V22.revision
      );
      expect(() => createOpsMcpServer(f.input)).toThrow();
      expect(f.rpc).not.toHaveBeenCalled();
    });
    it.each(Object.keys(SITE_VISIT_TOOL_OPERATIONS))(
      "durably limits %s before domain effects",
      async (name) => {
        const f = await protocolFixture(era);
        f.rateRpc.mockResolvedValueOnce({
          data: [
            {
              allowed: false,
              remaining_units: 0,
              reset_at: "2099-01-01T00:00:00Z",
            },
          ],
          error: null,
        });
        const r = await f.call("tools/call", { name, arguments: inputs[name] });
        expect(JSON.stringify(r)).toContain("RATE_LIMITED");
        expect(f.rpc).not.toHaveBeenCalled();
        expect(f.rateRpc).toHaveBeenCalledWith(
          "consume_site_visit_workflow_rate_limit_as_system",
          expect.objectContaining({
            p_capability_id: name,
            p_protocol_era: era,
            p_policy_id: "mcp-site-visit-workflow:2026-09-10.v1",
            p_requested_units: 1,
          })
        );
      }
    );
    it.each(Object.keys(SITE_VISIT_TOOL_OPERATIONS))(
      "dispatches %s to exact current-authority SQL operation",
      async (name) => {
        const f = await protocolFixture(era);
        f.rpc.mockResolvedValueOnce({
          data: null,
          error: { code: "42501", message: "SITE_VISIT_GRANT_STALE_OR_DENIED" },
        });
        const r = await f.call("tools/call", { name, arguments: inputs[name] });
        expect(r.result?.isError).toBe(true);
        expect(f.rpc, JSON.stringify(r)).toHaveBeenCalledWith(
          [
            "prepare_site_visit_booking",
            "prepare_site_visit_reschedule",
          ].includes(name)
            ? "inspect_site_visit_workflow_as_system"
            : name.startsWith("prepare_")
              ? "prepare_site_visit_workflow_as_system"
              : "read_site_visit_workflow_as_system",
          expect.objectContaining({
            p_request: expect.objectContaining({
              operation:
                SITE_VISIT_TOOL_OPERATIONS[
                  name as keyof typeof SITE_VISIT_TOOL_OPERATIONS
                ],
            }),
            p_context: expect.objectContaining({
              actor: actorId,
              company,
              grant: "33333333-3333-4333-8333-333333333333",
              client: "44444444-4444-4444-8444-444444444444",
            }),
          })
        );
        expect(f.authority.actorLookups).toHaveLength(1);
      }
    );
    it("dispatches read and returns marked data", async () => {
      const f = await protocolFixture(era);
      f.rpc.mockResolvedValueOnce({
        data: {
          request_id: "site-visit-test",
          schema_revision: SITE_VISIT_WORKFLOW_REVISION,
          source_revision: 0,
          content_kind: "untrusted_business_data",
          items: [],
          has_more: false,
          next_after_id: null,
        },
        error: null,
      });
      const r = await f.call("tools/call", {
        name: "list_site_visit_templates",
        arguments: {},
      });
      expect(r.result?.isError).not.toBe(true);
      expect(JSON.stringify(r)).toContain("untrusted_business_data");
      expect(f.rpc.mock.calls[0][0]).toBe("read_site_visit_workflow_as_system");
      expect(f.authority.actorLookups).toHaveLength(1);
    });
    it("preserves preparation identity and database replay", async () => {
      const f = await protocolFixture(era);
      await f.call("tools/call", {
        name: "prepare_site_visit_template",
        arguments: request,
      });
      f.rpc.mockResolvedValueOnce({
        data: { ...result(), replayed: true },
        error: null,
      });
      const r = await f.call("tools/call", {
        name: "prepare_site_visit_template",
        arguments: request,
      });
      expect(r.result?.isError, JSON.stringify(r)).not.toBe(true);
      expect(JSON.parse(r.result.content[0].text).replayed).toBe(true);
      expect(f.rpc.mock.calls[0][1]).toEqual(f.rpc.mock.calls[1][1]);
    });
    it("reauthorizes revocation after token resolution", async () => {
      const f = await protocolFixture(era);
      f.authority.mcpResult = {
        ...f.authority.mcpResult!,
        configuredPermissions: [],
        effectivePermissions: [],
      };
      const r = await f.call("tools/call", {
        name: "prepare_site_visit_template",
        arguments: request,
      });
      expect(r.result?.isError).toBe(true);
      expect(f.rpc).not.toHaveBeenCalled();
    });
    it.each(["binding", "oversized", "conflict"])(
      "handles %s without exposing raw database content",
      async (mode) => {
        const f = await protocolFixture(era);
        f.rpc.mockResolvedValueOnce(
          mode === "conflict"
            ? {
                data: null,
                error: {
                  code: "P0001",
                  message: "SITE_VISIT_IDEMPOTENCY_CONFLICT",
                },
              }
            : {
                data:
                  mode === "binding"
                    ? { ...result(), request_id: "other" }
                    : { ...result(), private_secret: "x".repeat(270000) },
                error: null,
              }
        );
        const r = await f.call("tools/call", {
          name: "prepare_site_visit_template",
          arguments: request,
        });
        expect(r.result?.isError).toBe(true);
        expect(JSON.stringify(r)).not.toContain("private_secret");
      }
    );
    it.each(["forged_approval", "commit"])(
      "rejects %s at the host boundary",
      async (mode) => {
        const f = await protocolFixture(era);
        const r = await f.call("tools/call", {
          name:
            mode === "commit"
              ? "commit_site_visit_template"
              : "prepare_site_visit_template",
          arguments: mode === "commit" ? {} : { ...request, approved: true },
        });
        expect(r.error || r.result?.isError).toBeTruthy();
        expect(f.rpc).not.toHaveBeenCalled();
      }
    );
    it("checks authenticated SQL timezone proof before persisting an approval under Node22", async () => {
      const f = await protocolFixture(era);
      f.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "SITE_VISIT_GRANT_STALE_OR_DENIED" },
      });
      const r = await f.call("tools/call", {
        name: "prepare_site_visit_booking",
        arguments: inputs.prepare_site_visit_booking,
      });
      expect(r.result?.isError).toBe(true);
      expect(f.rpc).toHaveBeenCalledOnce();
      expect(f.rpc).toHaveBeenCalledWith(
        "inspect_site_visit_workflow_as_system",
        expect.objectContaining({
          p_request: expect.objectContaining({ operation: "book" }),
        })
      );
    });
    it("accepts authenticated Vancouver civil time independent of Node ICU rules", async () => {
      const f = await protocolFixture(era);
      const prepared = bookingResult();
      f.rpc.mockResolvedValueOnce({
        data: {
          request_id: prepared.request_id,
          schema_revision: prepared.schema_revision,
          proposal: prepared.proposal,
          content_kind: prepared.content_kind,
        },
        error: null,
      });
      f.rpc.mockResolvedValueOnce({ data: prepared, error: null });
      const r = await f.call("tools/call", {
        name: "prepare_site_visit_booking",
        arguments: {
          ...(inputs.prepare_site_visit_booking as object),
          local_start: prepared.proposal.appointment.local_start,
        },
      });
      expect(r.result?.isError, JSON.stringify(r)).not.toBe(true);
      expect(
        JSON.parse(r.result.content[0].text).proposal.timezone_proof
      ).toEqual(prepared.proposal.timezone_proof);
      expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
        "inspect_site_visit_workflow_as_system",
        "prepare_site_visit_workflow_as_system",
      ]);
    });
    it.each([
      "offset",
      "local",
      "timezone",
      "duration",
      "crew",
      "reminder",
      "request",
    ])("rejects a substituted %s before durable approval", async (mode) => {
      const f = await protocolFixture(era);
      const prepared = bookingResult();
      const inspected = {
        request_id: prepared.request_id,
        schema_revision: prepared.schema_revision,
        proposal: prepared.proposal,
        content_kind: prepared.content_kind,
      };
      if (mode === "offset")
        inspected.proposal.timezone_proof.probes[0].utc_offset_minutes = -480;
      if (mode === "local")
        inspected.proposal.timezone_proof.probes[0].local =
          "2026-11-02T01:00:00";
      if (mode === "timezone")
        inspected.proposal.timezone_proof.timezone = "America/Edmonton";
      if (mode === "duration")
        inspected.proposal.appointment.duration_minutes = 90;
      if (mode === "crew")
        inspected.proposal.appointment.assignee_ids = [actionId];
      if (mode === "reminder")
        Object.assign(inspected.proposal.appointment, {
          reminder_lead_minutes: 30,
        });
      if (mode === "request") inspected.request_id = "another-request";
      f.rpc.mockResolvedValueOnce({ data: inspected, error: null });
      const r = await f.call("tools/call", {
        name: "prepare_site_visit_booking",
        arguments: {
          ...(inputs.prepare_site_visit_booking as object),
          local_start: "2026-11-02T00:00:00",
        },
      });
      expect(r.result?.isError, JSON.stringify(r)).toBe(true);
      expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
        "inspect_site_visit_workflow_as_system",
      ]);
    });
  });

import { describe, expect, it, vi } from "vitest";
import {
  createSiteVisitWorkflowService,
  isTrustedSiteVisitWorkflowService,
} from "../site-visit-workflow-service";
import type { ScheduleChangeRpcClient } from "../../schedule-change/schedule-change-repository";
import type { ActorAuthoritySnapshot } from "../../../actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "../../../actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "../../../actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "../../../actor/resolve-actor-context";
import {
  SITE_VISIT_WORKFLOW_MANIFEST,
  SITE_VISIT_WORKFLOW_REVISION,
  SiteVisitWorkflowResultSchema,
  siteVisitToolInputSchema,
} from "../../../contracts/site-visit-workflow";
import {
  SITE_VISIT_WORKFLOW_CAPABILITY_MANIFEST,
  CATALOG_AUTHORING_CAPABILITY_MANIFEST,
} from "../../../registry/capability-manifest";

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
describe("site visit host-neutral service", () => {
  it("reauthorizes and binds an exact dormant template proposal", async () => {
    const { actor, authority } = await fixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
      Promise.resolve({ data: result(), error: null })
    );
    const service = createSiteVisitWorkflowService({
      rpc,
      authorityRepository: authority.repository,
    });
    expect(isTrustedSiteVisitWorkflowService(service)).toBe(true);
    expect(isTrustedSiteVisitWorkflowService({ ...service })).toBe(false);
    expect(await service.prepareSiteVisitTemplate(actor, request)).toEqual(
      result()
    );
    expect(authority.actorLookups).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      "prepare_site_visit_workflow_as_system",
      expect.objectContaining({
        p_request: { ...request, operation: "create_template" },
        p_context: expect.objectContaining({
          actor: actorId,
          company,
          manifest: SITE_VISIT_WORKFLOW_MANIFEST,
        }),
      })
    );
  });
  it("rejects a copied actor without touching the database", async () => {
    const { actor, authority } = await fixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    await expect(
      createSiteVisitWorkflowService({
        rpc,
        authorityRepository: authority.repository,
      }).prepareSiteVisitTemplate({ ...actor }, request)
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses permissions revoked after token issuance", async () => {
    const { actor, authority } = await fixture();
    authority.mcpResult = {
      ...authority.mcpResult!,
      configuredPermissions: [],
      effectivePermissions: [],
    };
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    await expect(
      createSiteVisitWorkflowService({
        rpc,
        authorityRepository: authority.repository,
      }).prepareSiteVisitTemplate(actor, request)
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["55P03", "57014", "25P04", "40001"])(
    "returns bounded retry guidance for %s",
    async (code) => {
      const { actor, authority } = await fixture();
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
        Promise.resolve({ data: null, error: { code } })
      );
      await expect(
        createSiteVisitWorkflowService({
          rpc,
          authorityRepository: authority.repository,
        }).prepareSiteVisitTemplate(actor, request)
      ).rejects.toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      });
    }
  );
  it.each(["company", "request", "seal", "operation", "effect"])(
    "rejects response %s corruption",
    async (corruption) => {
      const { actor, authority } = await fixture();
      const data = result();
      if (corruption === "company")
        data.proposal.rows[0].values.company_id = actorId;
      if (corruption === "request") data.request_id = "other";
      if (corruption === "seal") data.preview_sha256 = "";
      if (corruption === "operation") data.proposal.operation = "cancel";
      if (corruption === "effect")
        data.proposal.effects.customer_messages_sent = 1;
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
        Promise.resolve({ data, error: null })
      );
      await expect(
        createSiteVisitWorkflowService({
          rpc,
          authorityRepository: authority.repository,
        }).prepareSiteVisitTemplate(actor, request)
      ).rejects.toThrow();
    }
  );
  it("rejects caller-controlled operation and unsupported form kinds before reads", async () => {
    const { actor, authority } = await fixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    const service = createSiteVisitWorkflowService({
      rpc,
      authorityRepository: authority.repository,
    });
    await expect(
      service.prepareSiteVisitTemplate(actor, {
        ...request,
        operation: "cancel",
      })
    ).rejects.toThrow();
    await expect(
      service.prepareSiteVisitTemplate(actor, {
        ...request,
        definition: {
          ...request.definition,
          fields: [{ ...request.definition.fields[0], kind: "signature" }],
        },
      })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps cancellation narrow and treats an unchanged proposal as unapproved", () => {
    expect(
      siteVisitToolInputSchema(
        "prepare_site_visit_booking_cancellation"
      ).safeParse({
        site_visit_id: recordId,
        expected_sha256: hash,
        idempotency_key: "cancel-001",
        assignee_ids: [actorId],
      }).success
    ).toBe(false);
    const data = {
      ...result(),
      status: "unchanged",
      action_id: null,
      change_set_id: null,
      preview_sha256: null,
      expires_at: null,
    };
    expect(SiteVisitWorkflowResultSchema.safeParse(data).success).toBe(false);
    data.proposal.rows = [];
    data.proposal.effects.records = 0;
    expect(SiteVisitWorkflowResultSchema.safeParse(data).success).toBe(true);
  });
  it("replaces existing booking names once and leaves predecessor definitions unchanged", () => {
    expect(
      new Set(SITE_VISIT_WORKFLOW_CAPABILITY_MANIFEST.map((e) => e.name)).size
    ).toBe(SITE_VISIT_WORKFLOW_CAPABILITY_MANIFEST.length);
    expect(
      SITE_VISIT_WORKFLOW_CAPABILITY_MANIFEST.find(
        (e) => e.name === "prepare_site_visit_booking"
      )?.availability.implementation
    ).toBe("available");
    expect(
      CATALOG_AUTHORING_CAPABILITY_MANIFEST.find(
        (e) => e.name === "prepare_site_visit_booking"
      )?.availability.implementation
    ).toBe("unavailable");
    expect(
      SITE_VISIT_WORKFLOW_CAPABILITY_MANIFEST.some((e) =>
        /start_site_visit|complete_site_visit/.test(e.name)
      )
    ).toBe(false);
  });
});

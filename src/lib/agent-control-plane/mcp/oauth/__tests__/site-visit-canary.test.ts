import { describe, expect, it, vi } from "vitest";
import { resolveOAuthExposureForSubject } from "../canary";
import type { ClientRow, McpOAuthRpcClient } from "../grants";
import {
  MCP_EXPOSURE_V22,
  resolveActiveMcpExposure,
  resolveMcpExposure,
} from "../../../registry/mcp-exposure-catalog";
import {
  consentSnapshotForExposure,
  resolveMcpConsentCatalogRevision,
} from "../scope-catalog";

const client: ClientRow = {
  client_id: "00000000-0000-4000-8000-000000000001",
  client_name: "Site visit trial",
  redirect_uris: ["http://127.0.0.1:43177/callback/sitevisittrial"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: MCP_EXPOSURE_V22.grantableScopes.join(" "),
  scope_ceiling: [...MCP_EXPOSURE_V22.grantableScopes],
  consent_catalog_revision: "2026-09-10.mcp-consent-catalog.v17",
  exposure_revision: "2026-09-10.mcp-exposure.v22",
  disabled: false,
};
const subject = {
  userId: "10000000-0000-4000-8000-000000000001",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const binding = {
  exposure_revision: client.exposure_revision,
  consent_catalog_revision: client.consent_catalog_revision,
  expires_at: "2099-09-14T20:00:00Z",
};
function repository(data: unknown = [binding]): McpOAuthRpcClient {
  return {
    rpc: vi.fn(async (name, args) => {
      if (
        name !== "resolve_mcp_oauth_canary_as_system" ||
        args?.p_oauth_client_id !== client.client_id ||
        args?.p_user_id !== subject.userId ||
        args?.p_company_id !== subject.companyId
      )
        return { data: [], error: null };
      return { data, error: null };
    }),
  } as McpOAuthRpcClient;
}

describe("site visit restricted OAuth trial", () => {
  it("allows the exact bound actor to discover only the approved site visit workflow", async () => {
    const exposure = await resolveOAuthExposureForSubject({
      ...subject,
      client,
      rpcClient: repository(),
    });
    expect(exposure?.toolIds).toEqual([
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
      "list_site_visit_templates",
      "get_site_visit_template",
      "get_site_visit_form",
      "get_site_visit_source",
      "prepare_site_visit_booking",
      "prepare_site_visit_reschedule",
      "prepare_site_visit_booking_cancellation",
      "prepare_site_visit_template",
      "prepare_site_visit_template_edit",
      "prepare_site_visit_checklist_selection",
      "prepare_site_visit_answers",
    ]);
    expect(exposure?.grantableScopes).toEqual([
      "ops.company.read",
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.files.read",
      "ops.financials.read",
      "ops.jobs.read",
      "ops.photos.read",
      "ops.schedule.read",
      "ops.site_visit_templates.prepare",
      "ops.site_visit_templates.read",
      "ops.site_visits.prepare",
      "ops.site_visits.read",
      "ops.team.read",
    ]);
    expect(
      consentSnapshotForExposure(
        exposure!,
        resolveMcpConsentCatalogRevision(client.consent_catalog_revision)
      ).acceptedLabels
    ).toHaveLength(14);
    expect(resolveActiveMcpExposure().revision).toBe(
      "2026-09-10.mcp-exposure.v23"
    );
    expect(resolveMcpExposure(client.exposure_revision)).toBe(exposure);
  });
  it.each(
    [
      [],
      [{ ...binding, expires_at: "2000-01-01T00:00:00Z" }],
      [{ ...binding, expires_at: "invalid" }],
      [
        {
          ...binding,
          consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9",
        },
      ],
      [{ ...binding, exposure_revision: "2026-09-10.mcp-exposure.v23" }],
    ].map((data) => ({ data }))
  )(
    "denies missing or invalid authority without falling back",
    async ({ data }) => {
      expect(
        await resolveOAuthExposureForSubject({
          ...subject,
          client,
          rpcClient: repository(data),
        })
      ).toBeNull();
    }
  );
  it.each([
    { userId: "10000000-0000-4000-8000-000000000002" },
    { companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  ])("denies another actor or company", async (changes) => {
    expect(
      await resolveOAuthExposureForSubject({
        ...subject,
        ...changes,
        client,
        rpcClient: repository(),
      })
    ).toBeNull();
  });
  it.each([
    { disabled: true },
    { scope: "ops.company.read" },
    { scope_ceiling: [...client.scope_ceiling, "ops.customers.prepare"] },
    { scope_ceiling: client.scope_ceiling.slice(1) },
    { consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9" },
  ])("denies altered client pins", async (changes) => {
    expect(
      await resolveOAuthExposureForSubject({
        ...subject,
        client: { ...client, ...changes },
        rpcClient: repository(),
      })
    ).toBeNull();
  });
});

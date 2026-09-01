import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import type { CompanyContextResult } from "@/lib/agent-control-plane/contracts/company-operations";
import { COMPANY_CONTEXT_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/company";
import {
  authorizeCompanyContextRead,
  type AuthorizedCompanyContextRead,
} from "../company-authorization";
import {
  companyContextProofMaterial,
  companyContextProofRef,
  type CompanyContextProofPayload,
  type CompanyContextSourceInspected,
} from "../company-proof";

export const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const OAUTH_GRANT_ID = "77777777-7777-4777-8777-777777777777";
export const OAUTH_CLIENT_ID = "88888888-8888-4888-8888-888888888888";
export const GRANT_REVISION = "d".repeat(32);
export const READ_AT = "2026-08-29T00:00:00.000Z";
export const SOURCE_REVISIONS = Object.freeze([
  Object.freeze({ domain: "company" as const, source_revision: 7 }),
]);
export const SOURCE_INSPECTED: CompanyContextSourceInspected = Object.freeze({
  companies: 1,
  inventory_settings: 1,
  company_settings: 1,
});

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["44444444-4444-4444-8444-444444444444"],
    configuredPermissions: ["settings.company"],
    effectivePermissions: [{ permission: "settings.company", scope: "all" }],
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

export async function createAuthorizedCompanyContextRead(): Promise<AuthorizedCompanyContextRead> {
  const actorContext = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: OAUTH_GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      validatedScopes: ["ops.company.read"],
      tokenId: "token-company-context",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-company-context",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
  const policy = COMPANY_CONTEXT_CANDIDATE.authorization.variants[0]!.policy;
  return authorizeCompanyContextRead({
    query: {},
    authorizations: {
      company: authorizeCapability({ actorContext, policy }),
    },
  });
}

export function companyContextPayload(): CompanyContextProofPayload {
  return {
    company_ref: { kind: "company", id: COMPANY_ID },
    profile: {
      display_name: "Canpro Deck and Rail",
      description: "Outdoor living systems.",
      industries: ["decks", "railings"],
      content_kind: "untrusted_business_data",
    },
    regional: {
      locale: "en-CA",
      timezone: "America/Vancouver",
      currency_code: "CAD",
    },
    working_window: {
      start_local: "08:00:00",
      end_local: "17:00:00",
      weekend_policy: "skip",
      precise_scheduling_enabled: true,
    },
    catalog: { inventory_mode: "tracked", setup_state: "complete" },
    public_assets: {
      logo: {
        state: "available",
        url: "https://assets.opsapp.co/company/logo.png",
      },
      website: { state: "available", url: "https://canpro.example/" },
      content_kind: "untrusted_business_data",
    },
  };
}

export function companyContextRawSnapshot(
  authorization: AuthorizedCompanyContextRead,
  payload: CompanyContextProofPayload = companyContextPayload()
) {
  const material = companyContextProofMaterial({
    authorization,
    readAt: READ_AT,
    sourceRevisions: SOURCE_REVISIONS,
    sourceInspected: SOURCE_INSPECTED,
    result: payload,
  });
  return {
    ...material,
    proof_ref: companyContextProofRef(material),
  };
}

export function companyContextResult(
  authorization: AuthorizedCompanyContextRead
): CompanyContextResult {
  const snapshot = companyContextRawSnapshot(authorization);
  return {
    ...snapshot.result,
    proof: {
      proof_ref: snapshot.proof_ref,
      read_at: snapshot.read_at,
      source_revisions: [...snapshot.source_revisions],
    },
  };
}

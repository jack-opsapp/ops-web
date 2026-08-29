import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { COMPANY_CONTEXT_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/company";
import {
  authorizeCompanyContextRead,
  CompanyContextAuthorizationError,
  isAuthorizedCompanyContextRead,
} from "../company-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const OAUTH_GRANT_ID = "77777777-7777-4777-8777-777777777777";
const OAUTH_CLIENT_ID = "88888888-8888-4888-8888-888888888888";
const GRANT_REVISION = "d".repeat(32);
const MANIFEST_REVISION = "2026-08-22.capability-manifest.v8";

function authority(scope: "all" | "assigned" = "all"): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["44444444-4444-4444-8444-444444444444"],
    configuredPermissions: ["settings.company"],
    effectivePermissions: [{ permission: "settings.company", scope }],
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

async function actorContext(input?: {
  readonly scope?: "all" | "assigned";
  readonly internal?: boolean;
}) {
  return resolveActorContext({
    principal: input?.internal
      ? verifiedInternalPrincipalFixture({
          channel: "internal",
          firebaseSubject: "company-context-internal",
        })
      : validatedMcpPrincipalFixture({
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
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(input?.scope)
    ),
    requestId: "request-company-context",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
  });
}

function policy() {
  return COMPANY_CONTEXT_CANDIDATE.authorization.variants[0]!.policy;
}

describe("P2 company-context nominal authorization", () => {
  it("mints one exact MCP repository proof for full company-settings authority", async () => {
    const context = await actorContext();
    const nominal = authorizeCapability({
      actorContext: context,
      policy: policy(),
    });
    const proof = authorizeCompanyContextRead({
      query: {},
      authorizations: { company: nominal },
    });

    expect(isAuthorizedCompanyContextRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "get_company_context",
      capabilityRevision: "get_company_context:2026-08-22.v1",
      capabilityManifestRevision: MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.company.read"],
      oauthGrantId: OAUTH_GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      grantRevision: GRANT_REVISION,
      grantedScopeCeiling: ["ops.company.read"],
      settingsCompanyScope: "all",
      query: {},
      variantKeys: ["company"],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.variantKeys)).toBe(true);
  });

  it("fails closed on missing, extra, cloned, assigned, and non-MCP authority", async () => {
    const context = await actorContext();
    const nominal = authorizeCapability({
      actorContext: context,
      policy: policy(),
    });
    for (const authorizations of [
      {},
      { company: nominal, extra: nominal },
      { company: { ...nominal } },
    ]) {
      expect(() =>
        authorizeCompanyContextRead({ query: {}, authorizations })
      ).toThrow(CompanyContextAuthorizationError);
    }

    const assignedContext = await actorContext({ scope: "assigned" });
    expect(() =>
      authorizeCapability({ actorContext: assignedContext, policy: policy() })
    ).toThrow();

    const internalContext = await actorContext({ internal: true });
    const internalNominal = authorizeCapability({
      actorContext: internalContext,
      policy: policy(),
    });
    expect(() =>
      authorizeCompanyContextRead({
        query: {},
        authorizations: { company: internalNominal },
      })
    ).toThrow(CompanyContextAuthorizationError);
  });
});

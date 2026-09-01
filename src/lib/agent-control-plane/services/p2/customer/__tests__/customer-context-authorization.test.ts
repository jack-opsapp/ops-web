import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { CustomerContextInputSchema } from "@/lib/agent-control-plane/contracts/customer-context";
import {
  CUSTOMER_CONTEXT_CANDIDATE,
  selectedCustomerContextVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/customer-context";
import {
  authorizeCustomerContextRead,
  CustomerContextAuthorizationError,
  isAuthorizedCustomerContextRead,
} from "../customer-context-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_GRANT_ID = "77777777-7777-4777-8777-777777777777";
const OAUTH_CLIENT_ID = "88888888-8888-4888-8888-888888888888";
const GRANT_REVISION = "d".repeat(32);
const MANIFEST_REVISION = "2026-08-22.capability-manifest.v8";

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["44444444-4444-4444-8444-444444444444"],
    configuredPermissions: ["clients.view", "pipeline.view", "projects.view"],
    effectivePermissions: [
      { permission: "clients.view", scope: "assigned" },
      { permission: "pipeline.view", scope: "all" },
      { permission: "projects.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

async function actorContext() {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: OAUTH_GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      validatedScopes: [
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      tokenId: "token-customer-context",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-customer-context",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
  });
}

async function authorizationsFor(
  query: unknown,
  suppliedContext?: Awaited<ReturnType<typeof actorContext>>
) {
  const parsed = CustomerContextInputSchema.parse(query);
  const context = suppliedContext ?? (await actorContext());
  const policies = new Map(
    CUSTOMER_CONTEXT_CANDIDATE.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  return Object.fromEntries(
    selectedCustomerContextVariantKeys(parsed).map((key) => [
      key,
      authorizeCapability({
        actorContext: context,
        policy: policies.get(key)!,
      }),
    ])
  );
}

describe("P2 customer-context candidate policy", () => {
  it("is a dark immutable exact read with closed compositional policies", () => {
    expect(CUSTOMER_CONTEXT_CANDIDATE).toMatchObject({
      name: "get_customer_context",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      availability: { implementation: "available" },
      bounds: {
        maxOutputCharacters: 60_000,
        maxResultItems: 1,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(CUSTOMER_CONTEXT_CANDIDATE.authorization.variants).toHaveLength(4);
    expect(
      CUSTOMER_CONTEXT_CANDIDATE.authorization.variants.map((variant) => ({
        key: variant.key,
        scopes: variant.policy.requiredOAuthScopes,
        permissions: variant.policy.permissionRequirementGroups[0]?.map(
          (requirement) => requirement.permission
        ),
      }))
    ).toEqual([
      {
        key: "base",
        scopes: ["ops.customers.read"],
        permissions: ["clients.view"],
      },
      {
        key: "contacts",
        scopes: ["ops.customer_contacts.read", "ops.customers.read"],
        permissions: ["clients.view"],
      },
      {
        key: "jobs_opportunity",
        scopes: ["ops.customers.read", "ops.jobs.read"],
        permissions: ["clients.view", "pipeline.view"],
      },
      {
        key: "jobs_project",
        scopes: ["ops.customers.read", "ops.jobs.read"],
        permissions: ["clients.view", "projects.view"],
      },
    ]);
    expect(Object.isFrozen(CUSTOMER_CONTEXT_CANDIDATE)).toBe(true);
  });

  it("selects only explicitly requested contact and job policies in canonical order", () => {
    expect(
      selectedCustomerContextVariantKeys(
        CustomerContextInputSchema.parse({
          customer_ref: { kind: "client", id: CLIENT_ID },
          sections: ["job_rollup", "contacts", "profile"],
          contact_purpose: "communication",
          job_kinds: ["project", "opportunity"],
        })
      )
    ).toEqual(["base", "contacts", "jobs_opportunity", "jobs_project"]);
  });
});

describe("P2 customer-context nominal authorization", () => {
  it("AND-authorizes every explicit component before minting one exact repository proof", async () => {
    const query = CustomerContextInputSchema.parse({
      customer_ref: { kind: "client", id: CLIENT_ID },
      sections: ["job_rollup", "contacts", "profile"],
      contact_purpose: "communication",
      job_kinds: ["project", "opportunity"],
    });
    const proof = authorizeCustomerContextRead({
      query,
      authorizations: await authorizationsFor(query),
    });

    expect(isAuthorizedCustomerContextRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "get_customer_context",
      capabilityRevision: "get_customer_context:2026-08-22.v1",
      capabilityManifestRevision: MANIFEST_REVISION,
      requiredOAuthScopes: [
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      oauthGrantId: OAUTH_GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      grantRevision: GRANT_REVISION,
      grantedScopeCeiling: [
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      clientsScope: "assigned",
      pipelineScope: "all",
      projectsScope: "assigned",
      query: {
        customer_ref: { kind: "client", id: CLIENT_ID },
        sections: ["contacts", "job_rollup", "profile"],
        contact_purpose: "communication",
        job_kinds: ["opportunity", "project"],
      },
      variantKeys: ["base", "contacts", "jobs_opportunity", "jobs_project"],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.query.sections)).toBe(true);
  });

  it("fails closed on a missing, extra, cloned, or cross-actor component proof", async () => {
    const query = CustomerContextInputSchema.parse({
      customer_ref: { kind: "client", id: CLIENT_ID },
      sections: ["contacts", "job_rollup"],
      contact_purpose: "scheduling",
      job_kinds: ["project"],
    });
    const authorizations = await authorizationsFor(query);

    const cases = [
      Object.fromEntries(
        Object.entries(authorizations).filter(([key]) => key !== "contacts")
      ),
      { ...authorizations, jobs_opportunity: authorizations.base },
      { ...authorizations, contacts: { ...authorizations.contacts } },
    ];
    for (const invalid of cases) {
      expect(() =>
        authorizeCustomerContextRead({ query, authorizations: invalid })
      ).toThrow(CustomerContextAuthorizationError);
    }
  });

  it("refuses to mint an MCP repository proof from a non-MCP actor", async () => {
    const query = CustomerContextInputSchema.parse({
      customer_ref: { kind: "client", id: CLIENT_ID },
      sections: ["profile"],
    });
    const internalContext = await resolveActorContext({
      principal: verifiedInternalPrincipalFixture({
        channel: "internal",
        firebaseSubject: "customer-context-internal",
      }),
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      requestId: "request-customer-context-internal",
      policyRevision: "actor-policy:v1",
      capabilityManifestRevision: MANIFEST_REVISION,
    });

    const authorizations = await authorizationsFor(query, internalContext);
    expect(() =>
      authorizeCustomerContextRead({
        query,
        authorizations,
      })
    ).toThrow(CustomerContextAuthorizationError);
  });
});

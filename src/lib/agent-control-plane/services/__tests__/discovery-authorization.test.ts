import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { DISCOVERY_CAPABILITY_SCHEMA_REVISION } from "@/lib/agent-control-plane/contracts/discovery";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  authorizeCustomerDiscoveryRead,
  isAuthorizedCustomerDiscoveryRead,
} from "../customer-discovery-authorization";
import {
  authorizeJobDiscoveryRead,
  isAuthorizedJobDiscoveryRead,
} from "../job-discovery-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const MCP_SCOPES = [
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.jobs.read",
] as const;

function authority(actorUserId: string): ActorAuthoritySnapshot {
  return {
    actorUserId,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["44444444-4444-4444-8444-444444444444"],
    configuredPermissions: ["clients.view", "pipeline.view", "projects.view"],
    effectivePermissions: [
      { permission: "clients.view", scope: "assigned" },
      { permission: "pipeline.view", scope: "assigned" },
      { permission: "projects.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext(
  input: {
    readonly actorUserId?: string;
    readonly channel?: "internal" | "mcp";
    readonly scopes?: readonly string[];
  } = {}
) {
  const actorUserId = input.actorUserId ?? ACTOR_ID;
  const channel = input.channel ?? "internal";
  const principal =
    channel === "mcp"
      ? validatedMcpPrincipalFixture({
          actorUserId,
          companyId: COMPANY_ID,
          oauthGrantId: `grant-${actorUserId}`,
          oauthClientId: "client-discovery-auth",
          validatedScopes: input.scopes ?? MCP_SCOPES,
          tokenId: `token-${actorUserId}`,
          issuer: "https://app.opsapp.co",
          audience: "https://app.opsapp.co/api/mcp",
          grantRevision: "grant-revision:v1",
          applicationId: "external-assistant",
          protocolEra: "2026-08-20",
        })
      : verifiedInternalPrincipalFixture({
          channel: "internal",
          firebaseSubject: `firebase-discovery-${actorUserId}`,
          applicationId: "phase-c",
          protocolEra: "internal-v1",
        });
  return await resolveActorContext({
    principal,
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(actorUserId)
    ),
    requestId: `request-discovery-${actorUserId}`,
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

function authorizationSet(
  actor: Awaited<ReturnType<typeof actorContext>>,
  capabilityId: "search_customers" | "search_jobs",
  rawInput: unknown
): AuthorizedCapability[] {
  const resolved = resolveCapabilityAuthorization(capabilityId, rawInput);
  return resolved.variants.map((variant) =>
    authorizeCapability({ actorContext: actor, policy: variant.policy })
  );
}

describe("customer discovery nominal authorization", () => {
  it("mints one assigned-scope name proof without contact OAuth", async () => {
    const rawInput = { lookup: "name", query: "Acme Construction" } as const;
    const actor = await actorContext();
    const [authorization] = authorizationSet(
      actor,
      "search_customers",
      rawInput
    );
    const proof = authorizeCustomerDiscoveryRead({
      authorization: authorization!,
      rawInput,
    });

    expect(proof).toMatchObject({
      actorContext: actor,
      capabilityId: "search_customers",
      capabilityRevision: `search_customers:${DISCOVERY_CAPABILITY_SCHEMA_REVISION}`,
      capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.customers.read"],
      clientsScope: "assigned",
      query: {
        lookup: "name",
        query: "acme construction",
        customer_kinds: ["client", "sub_client"],
        limit: 10,
      },
    });
    expect(isAuthorizedCustomerDiscoveryRead(proof)).toBe(true);
    expect(isAuthorizedCustomerDiscoveryRead({ ...proof })).toBe(false);
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it.each([
    ["exact_email", "OFFICE@EXAMPLE.COM", "office@example.com"],
    ["exact_phone", "(604) 555-0199", "+16045550199"],
  ] as const)(
    "mints one stronger %s proof while keeping the contact value lookup-only",
    async (lookup, query, normalizedQuery) => {
      const rawInput = { lookup, query };
      const actor = await actorContext({ channel: "mcp" });
      const [authorization] = authorizationSet(
        actor,
        "search_customers",
        rawInput
      );
      const proof = authorizeCustomerDiscoveryRead({
        authorization: authorization!,
        rawInput,
      });

      expect(proof.requiredOAuthScopes).toEqual([
        "ops.customer_contacts.read",
        "ops.customers.read",
      ]);
      expect(proof.clientsScope).toBe("assigned");
      expect(proof.query.query).toBe(normalizedQuery);
    }
  );

  it("rejects an MCP name-policy proof for exact contact input", async () => {
    const actor = await actorContext({ channel: "mcp" });
    const [nameAuthorization] = authorizationSet(actor, "search_customers", {
      lookup: "name",
      query: "Acme",
    });

    expect(() =>
      authorizeCustomerDiscoveryRead({
        authorization: nameAuthorization!,
        rawInput: { lookup: "exact_email", query: "office@example.com" },
      })
    ).toThrow(ActorAccessError);
    expect(
      isAuthorizedCustomerDiscoveryRead({
        actorContext: actor,
        capabilityId: "search_customers",
      })
    ).toBe(false);
  });

  it("rejects an internal name-policy proof for exact contact input", async () => {
    const actor = await actorContext();
    const [nameAuthorization] = authorizationSet(actor, "search_customers", {
      lookup: "name",
      query: "Acme",
    });

    expect(() =>
      authorizeCustomerDiscoveryRead({
        authorization: nameAuthorization!,
        rawInput: { lookup: "exact_email", query: "office@example.com" },
      })
    ).toThrow(ActorAccessError);
  });
});

describe("job discovery nominal authorization", () => {
  it("requires and merges every selected job-kind proof", async () => {
    const rawInput = { query: "Cedar deck" } as const;
    const actor = await actorContext();
    const authorizations = authorizationSet(actor, "search_jobs", rawInput);
    const proof = authorizeJobDiscoveryRead({
      authorizations: [...authorizations].reverse(),
      rawInput,
    });

    expect(proof).toMatchObject({
      actorContext: actor,
      capabilityId: "search_jobs",
      capabilityRevision: `search_jobs:${DISCOVERY_CAPABILITY_SCHEMA_REVISION}`,
      capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.jobs.read"],
      pipelineScope: "assigned",
      projectsScope: "assigned",
      query: {
        query: "cedar deck",
        query_fields: ["title", "address"],
        job_kinds: ["opportunity", "project"],
        limit: 10,
      },
    });
    expect(isAuthorizedJobDiscoveryRead(proof)).toBe(true);
    expect(isAuthorizedJobDiscoveryRead({ ...proof })).toBe(false);
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it("rejects a missing, duplicated, or wrong-kind proof", async () => {
    const actor = await actorContext();
    const bothInput = { query: "Cedar" } as const;
    const [opportunityAuthorization, projectAuthorization] = authorizationSet(
      actor,
      "search_jobs",
      bothInput
    );

    expect(() =>
      authorizeJobDiscoveryRead({
        authorizations: [opportunityAuthorization!],
        rawInput: bothInput,
      })
    ).toThrow(ActorAccessError);
    expect(() =>
      authorizeJobDiscoveryRead({
        authorizations: [opportunityAuthorization!, opportunityAuthorization!],
        rawInput: bothInput,
      })
    ).toThrow(ActorAccessError);
    expect(() =>
      authorizeJobDiscoveryRead({
        authorizations: [projectAuthorization!],
        rawInput: {
          lifecycle_states: ["active"],
          job_kinds: ["opportunity"],
        },
      })
    ).toThrow(ActorAccessError);
  });

  it("rejects proof arrays minted for different actor contexts", async () => {
    const rawInput = { query: "Cedar" } as const;
    const firstActor = await actorContext();
    const secondActor = await actorContext({ actorUserId: OTHER_ACTOR_ID });
    const [opportunityAuthorization] = authorizationSet(
      firstActor,
      "search_jobs",
      rawInput
    );
    const [, projectAuthorization] = authorizationSet(
      secondActor,
      "search_jobs",
      rawInput
    );

    expect(() =>
      authorizeJobDiscoveryRead({
        authorizations: [opportunityAuthorization!, projectAuthorization!],
        rawInput,
      })
    ).toThrow(ActorAccessError);
  });

  it("rejects structural capability forgeries before minting a proof", () => {
    expect(() =>
      authorizeJobDiscoveryRead({
        authorizations: [
          {
            capabilityId: "search_jobs",
            capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
          } as AuthorizedCapability,
        ],
        rawInput: { query: "Cedar" },
      })
    ).toThrow(ActorAccessError);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  DECK_GEOMETRY_DECK_REF,
  DECK_GEOMETRY_JOB_ID,
  DECK_GEOMETRY_SITE_VISIT_ID,
  deckGeometryCandidateAuthorizations,
} from "../deck-design/__tests__/deck-geometry-service-fixtures";
import {
  createOpsAgentP2DomainService,
  isTrustedOpsAgentP2DomainService,
} from "../domain-service";
import {
  createSupabaseOpsAgentP2Repositories,
  isTrustedOpsAgentP2Repositories,
} from "../repositories";

const EXPECTED_P2_METHODS = [
  "getCustomerContext",
  "listTasks",
  "getTaskContext",
  "listJobArtifacts",
  "getJobArtifactEvidence",
  "listSiteVisits",
  "getSiteVisitContext",
  "getDeckDesignGeometry",
  "listSalesDocuments",
  "getSalesDocument",
  "listPayments",
  "listExpenses",
  "getExpenseContext",
  "listWorkQueue",
  "searchCatalogItems",
  "getCatalogItem",
  "listPurchaseOrders",
  "getPurchaseOrder",
  "getCompanyContext",
  "listTeamMembers",
  "listTeamAvailability",
  "getIntegrationHealth",
  "getOperationalOverview",
] as const;

const SITE_VISIT_DECK_QUERY = Object.freeze({
  source: "site_visit_artifact" as const,
  site_visit_ref: Object.freeze({
    kind: "site_visit" as const,
    id: DECK_GEOMETRY_SITE_VISIT_ID,
  }),
  deck_design_ref: DECK_GEOMETRY_DECK_REF,
});

const MINIMAL_UNLINKED_OAUTH_SCOPES = Object.freeze([
  "ops.files.read",
  "ops.jobs.read",
  "ops.site_visits.read",
]);

function deckGeometryComposition(input: {
  readonly rpc: ReturnType<typeof vi.fn>;
}) {
  return createOpsAgentP2DomainService({
    repositories: createSupabaseOpsAgentP2Repositories({ rpc: input.rpc }),
    cursorKey: {
      keyId: "p2-deck-alternative-auth",
      key: Uint8Array.from({ length: 32 }, () => 0xab),
    },
  });
}

function notFoundRpc() {
  return vi.fn(async () => ({
    data: null,
    error: {
      code: "P0002",
      message: "agent_deck_geometry_not_found_or_not_visible",
    },
  }));
}

async function expectDeckRepositoryCall(input: {
  readonly actorContext: ActorContext;
  readonly expectedVariantKeys: readonly string[];
}) {
  const rpc = notFoundRpc();
  const service = deckGeometryComposition({ rpc });

  await expect(
    service.getDeckDesignGeometry(input.actorContext, SITE_VISIT_DECK_QUERY)
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
  });

  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith(
    "read_agent_deck_design_geometry_as_system",
    expect.objectContaining({
      p_authorization_candidates: input.expectedVariantKeys.map((variantKey) =>
        expect.objectContaining({ variant_key: variantKey })
      ),
    })
  );
}

describe("P2 domain composition", () => {
  it("constructs one nominal repository graph and all twenty-three methods without reading", () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repositories = createSupabaseOpsAgentP2Repositories({ rpc });
    const service = createOpsAgentP2DomainService({
      repositories,
      cursorKey: {
        keyId: "p2-composition-test",
        key: Uint8Array.from({ length: 32 }, () => 0xab),
      },
    });

    expect(isTrustedOpsAgentP2Repositories(repositories)).toBe(true);
    expect(isTrustedOpsAgentP2Repositories({ ...repositories })).toBe(false);
    expect(Object.isFrozen(repositories)).toBe(true);
    expect(Object.keys(service)).toEqual(EXPECTED_P2_METHODS);
    expect(isTrustedOpsAgentP2DomainService(service)).toBe(true);
    expect(isTrustedOpsAgentP2DomainService({ ...service })).toBe(false);
    expect(Object.isFrozen(service)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed transports, repository lookalikes, and cursor keys", () => {
    expect(() => createSupabaseOpsAgentP2Repositories({} as never)).toThrow(
      TypeError
    );

    const repositories = createSupabaseOpsAgentP2Repositories({
      rpc: vi.fn(async () => ({ data: null, error: null })),
    });
    expect(() =>
      createOpsAgentP2DomainService({
        repositories: { ...repositories } as never,
        cursorKey: {
          keyId: "p2-composition-test",
          key: Uint8Array.from({ length: 32 }, () => 0xab),
        },
      })
    ).toThrow(TypeError);
    expect(() =>
      createOpsAgentP2DomainService({
        repositories,
        cursorKey: {
          keyId: "p2-composition-test",
          key: Uint8Array.from({ length: 31 }, () => 0xab),
        },
      })
    ).toThrow(TypeError);
  });

  it("captures an adversarial RPC getter exactly once before constructing repositories", () => {
    const trustedRpc = vi.fn(async () => ({ data: null, error: null }));
    const attackerRpc = vi.fn(async () => {
      throw new Error("Attacker RPC must never be captured");
    });
    let reads = 0;
    const transport = Object.defineProperty({}, "rpc", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? trustedRpc : attackerRpc;
      },
    });

    const repositories = createSupabaseOpsAgentP2Repositories(
      transport as { rpc: typeof trustedRpc }
    );

    expect(isTrustedOpsAgentP2Repositories(repositories)).toBe(true);
    expect(reads).toBe(1);
    expect(trustedRpc).not.toHaveBeenCalled();
    expect(attackerRpc).not.toHaveBeenCalled();
  });

  it("captures each cursor-key field exactly once before minting services", () => {
    const repositories = createSupabaseOpsAgentP2Repositories({
      rpc: vi.fn(async () => ({ data: null, error: null })),
    });
    let keyIdReads = 0;
    let keyReads = 0;
    const cursorKey = Object.defineProperties(
      {},
      {
        keyId: {
          enumerable: true,
          get() {
            keyIdReads += 1;
            return keyIdReads === 1 ? "p2-captured" : "attacker";
          },
        },
        key: {
          enumerable: true,
          get() {
            keyReads += 1;
            return keyReads === 1
              ? Uint8Array.from({ length: 32 }, () => 0xab)
              : new Uint8Array(31);
          },
        },
      }
    );

    const service = createOpsAgentP2DomainService({
      repositories,
      cursorKey: cursorKey as {
        readonly keyId: string;
        readonly key: Uint8Array;
      },
    });

    expect(isTrustedOpsAgentP2DomainService(service)).toBe(true);
    expect(keyIdReads).toBe(1);
    expect(keyReads).toBe(1);
  });

  it("reads a site-visit deck through linked authority when unlinked authority is denied", async () => {
    const authorizations = await deckGeometryCandidateAuthorizations({
      query: SITE_VISIT_DECK_QUERY,
      permissions: {
        "calendar.view": "own",
        "clients.view": "assigned",
        "deck_builder.view": "assigned",
        "pipeline.view": "assigned",
        "projects.view": null,
      },
    });

    await expectDeckRepositoryCall({
      actorContext: authorizations.site_visit_artifact_linked!.actorContext,
      expectedVariantKeys: ["site_visit_artifact_linked"],
    });
  });

  it("reads a site-visit deck through unlinked authority when linked authority is denied", async () => {
    const authorizations = await deckGeometryCandidateAuthorizations({
      query: SITE_VISIT_DECK_QUERY,
      oauthScopes: MINIMAL_UNLINKED_OAUTH_SCOPES,
      permissions: {
        "calendar.view": null,
        "clients.view": null,
        "deck_builder.view": "all",
        "pipeline.view": "all",
        "projects.view": null,
      },
    });

    await expectDeckRepositoryCall({
      actorContext: authorizations.site_visit_artifact_unlinked!.actorContext,
      expectedVariantKeys: ["site_visit_artifact_unlinked"],
    });
  });

  it("retains both independently authorized site-visit deck paths in canonical order", async () => {
    const authorizations = await deckGeometryCandidateAuthorizations({
      query: SITE_VISIT_DECK_QUERY,
    });

    await expectDeckRepositoryCall({
      actorContext: authorizations.site_visit_artifact_linked!.actorContext,
      expectedVariantKeys: [
        "site_visit_artifact_linked",
        "site_visit_artifact_unlinked",
      ],
    });
  });

  it("rejects before repository access when neither site-visit deck path is authorized", async () => {
    const actorSource = await deckGeometryCandidateAuthorizations({
      query: {
        source: "job_artifact",
        job_ref: { kind: "opportunity", id: DECK_GEOMETRY_JOB_ID },
        deck_design_ref: DECK_GEOMETRY_DECK_REF,
      },
      permissions: {
        "calendar.view": null,
        "clients.view": null,
        "deck_builder.view": "assigned",
        "pipeline.view": "assigned",
        "projects.view": null,
      },
    });
    const rpc = notFoundRpc();
    const service = deckGeometryComposition({ rpc });

    await expect(
      service.getDeckDesignGeometry(
        actorSource.job_artifact_opportunity!.actorContext,
        SITE_VISIT_DECK_QUERY
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

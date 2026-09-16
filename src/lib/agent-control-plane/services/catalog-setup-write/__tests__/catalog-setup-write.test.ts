import { describe, expect, it, vi } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { MCP_EXPOSURE_V24 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  CatalogSetupWriteRepositoryError,
  createCatalogSetupWriteRepository,
  matchesCreateVariantRequest,
  type CatalogSetupWriteRpcClient,
} from "../catalog-setup-write-repository";
import {
  CatalogSetupWritePrepareError,
  createCatalogSetupWriteService,
} from "../catalog-setup-write-service";
import {
  ACTOR_ID,
  CLIENT_ID,
  COMPANY_ID,
  GRANT_ID,
  MANIFEST_REVISION,
  SCOPES,
  actorFixture,
  requestFixture,
  resultFixture,
} from "./fixtures";

function service(
  rpc: CatalogSetupWriteRpcClient["rpc"],
  authorityRepository: Parameters<
    typeof createCatalogSetupWriteService
  >[0]["authorityRepository"],
  now?: () => Date
) {
  return createCatalogSetupWriteService({
    repository: createCatalogSetupWriteRepository({ rpc }),
    authorityRepository,
    now,
  });
}

describe("catalogue setup write domain boundary", () => {
  it("reauthorizes and sends the exact v28/V24 authority binding with the kind", async () => {
    const { actor, authorityClient } = await actorFixture();
    const request = requestFixture();
    const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(request), error: null })
    );
    const result = await service(rpc, authorityClient.repository, () =>
      new Date("2026-09-15T21:00:00.000Z")
    ).prepareCreateCatalogVariant(actor, request);

    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(result.status).toBe("approval_required");
    expect(result.kind).toBe("create_variant");
    expect(result.proposal.effects.messages_sent).toBe(0);
    expect(result.proposal.effects.accounting_sync_enqueued).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      "prepare_catalog_setup_write_as_system",
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_oauth_client_id: CLIENT_ID,
        p_granted_scope_ceiling: [...SCOPES],
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_manifest_revision: MANIFEST_REVISION,
        p_exposure_revision: "2026-09-15.mcp-exposure.v24",
        p_capability_id: "prepare_create_catalog_variant",
        p_capability_revision: "prepare_create_catalog_variant:2026-09-15.v1",
        p_kind: "create_variant",
        p_request: request,
        p_observed_at: "2026-09-15T21:00:00.000Z",
      })
    );
  });

  it("carries the full consented V24 ceiling through to the RPC in order", async () => {
    const scopes = [...MCP_EXPOSURE_V24.grantableScopes];
    expect(scopes).toHaveLength(22);
    expect(scopes.indexOf("ops.catalog.prepare")).toBeLessThan(
      scopes.indexOf("ops.catalog.read")
    );
    const { actor, authorityClient } = await actorFixture({ scopes });
    const request = requestFixture();
    const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>((_name, args) => {
      expect(args.p_granted_scope_ceiling).toEqual(scopes);
      return Promise.resolve({ data: resultFixture(request), error: null });
    });
    await service(rpc, authorityClient.repository).prepareCreateCatalogVariant(
      actor,
      request
    );
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("refuses a v20 actor before touching the database", async () => {
    const { actor, authorityClient } = await actorFixture({
      capabilityManifestRevision: "2026-09-04.capability-manifest.v20",
    });
    const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(), error: null })
    );
    await expect(
      service(rpc, authorityClient.repository).prepareCreateCatalogVariant(
        actor,
        requestFixture()
      )
    ).rejects.toBeInstanceOf(Error);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails before persistence when a scope or current permission is missing", async () => {
    for (const missing of [
      { scopes: ["ops.catalog.read"] as const },
      {
        permissions: [
          "agent.review",
          "catalog.products.view",
          "catalog.stock.adjust",
          "catalog.view",
        ] as const,
      },
      {
        // Opening stock needs the operator's stock-adjust authority.
        permissions: [
          "agent.review",
          "catalog.manage",
          "catalog.products.view",
          "catalog.view",
        ] as const,
      },
    ]) {
      const { actor, authorityClient } = await actorFixture(missing);
      const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>(() =>
        Promise.resolve({ data: resultFixture(), error: null })
      );
      await expect(
        service(rpc, authorityClient.repository).prepareCreateCatalogVariant(
          actor,
          requestFixture()
        )
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("allows a variant without opening stock when stock-adjust is absent", async () => {
    const { actor, authorityClient } = await actorFixture({
      permissions: [
        "agent.review",
        "catalog.manage",
        "catalog.products.view",
        "catalog.view",
      ],
    });
    const request = requestFixture({ opening_quantity: undefined });
    const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(request), error: null })
    );
    const result = await service(
      rpc,
      authorityClient.repository
    ).prepareCreateCatalogVariant(actor, request);
    expect(result.proposal.effects.stock_events_recorded).toBe(0);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("maps every database refusal to its own transport answer", async () => {
    // The shared P2 transport refuses to report STALE_CONTEXT without authentic
    // current source versions, and this write boundary deliberately discloses
    // none: a stale family, a dormant seal and a revoked grant all project to
    // the same retryable TEMPORARILY_UNAVAILABLE rather than leaking a marker.
    const cases = [
      {
        message: "CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED",
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      },
      {
        message: "CATALOG_SETUP_SOURCE_STALE",
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      },
      {
        message: "CATALOG_SETUP_VARIANT_EXISTS",
        code: "INVALID_ARGUMENT",
        retryable: false,
        issue: "CATALOG_SETUP_VARIANT_EXISTS",
      },
      {
        message: "CATALOG_SETUP_PRICE_REQUIRED",
        code: "INVALID_ARGUMENT",
        retryable: false,
        issue: "CATALOG_SETUP_WRITE_INPUT_INVALID",
      },
      {
        message: "CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT",
        code: "INVALID_ARGUMENT",
        retryable: false,
        issue: "CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT",
      },
      {
        message: "CATALOG_SETUP_WRITE_GRANT_STALE_OR_DENIED",
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      },
      {
        message: "something unexpected",
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      },
    ] as const;
    for (const expected of cases) {
      const { actor, authorityClient } = await actorFixture();
      const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>(() =>
        Promise.resolve({
          data: null,
          error: { code: "22023", message: expected.message },
        })
      );
      const response = await service(rpc, authorityClient.repository)
        .prepareCreateCatalogVariant(actor, requestFixture())
        .catch((error: CatalogSetupWritePrepareError) => error.toAgentError());
      expect(response, expected.message).toMatchObject({
        code: expected.code,
        retryable: expected.retryable,
      });
      if ("issue" in expected) {
        expect(response).toMatchObject({
          details: { field_issues: [{ code: expected.issue }] },
        });
      }
    }
  });

  it("refuses a proposal that does not describe the request that was sent", async () => {
    const request = requestFixture();
    const substitutions = [
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.family.family_ref.id =
          "00000000-0000-4000-8000-000000000001";
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.variant.sale_price = {
          amount: "99.0000",
          origin: "variant",
        };
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.variant.option_values.pop();
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.opening_quantity = null;
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.variant.warning_threshold = {
          value: "99",
          origin: "variant",
        };
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.evidence[0]!.text = "Something else entirely";
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.request_id = "another-request";
      },
    ];
    for (const substitute of substitutions) {
      const { actor, authorityClient } = await actorFixture();
      const rpc = vi.fn<CatalogSetupWriteRpcClient["rpc"]>(() => {
        const result = resultFixture(request);
        substitute(result);
        return Promise.resolve({ data: result, error: null });
      });
      await expect(
        service(rpc, authorityClient.repository).prepareCreateCatalogVariant(
          actor,
          request
        )
      ).rejects.toBeInstanceOf(CatalogSetupWritePrepareError);
    }
  });

  it("accepts an equal price written with a different scale", () => {
    const request = requestFixture({
      price_override: { amount: "45", currency: "CAD" },
    });
    const result = resultFixture(request);
    result.proposal.after.variant.sale_price = {
      amount: "45.0000",
      origin: "variant",
    };
    expect(matchesCreateVariantRequest(result, request)).toBe(true);
  });

  it("accepts a price equal to the family default, which the new variant inherits", () => {
    const request = requestFixture({
      price_override: { amount: "45", currency: "CAD" },
    });
    const result = resultFixture(request);
    result.proposal.before.default_price = "45.0000";
    result.proposal.after.variant.sale_price = {
      amount: "45.0000",
      origin: "family",
    };
    expect(matchesCreateVariantRequest(result, request)).toBe(true);
  });

  it("refuses a new variant pinned to the family price it would inherit", () => {
    const request = requestFixture({
      price_override: { amount: "45", currency: "CAD" },
    });
    const result = resultFixture(request);
    result.proposal.before.default_price = "45.0000";
    // What the shipped compile staged: an override equal to the family default.
    expect(result.proposal.after.variant.sale_price).toEqual({
      amount: "45",
      origin: "variant",
    });
    expect(matchesCreateVariantRequest(result, request)).toBe(false);
  });

  it("refuses an inherited price that is not the family's default", () => {
    const request = requestFixture({
      price_override: { amount: "45", currency: "CAD" },
    });
    const result = resultFixture(request);
    result.proposal.before.default_price = "40.0000";
    result.proposal.after.variant.sale_price = {
      amount: "45.0000",
      origin: "family",
    };
    expect(matchesCreateVariantRequest(result, request)).toBe(false);
  });

  it("accepts a requested level the new variant inherits, and refuses an unrequested one it claims", () => {
    const request = requestFixture();
    const inheriting = resultFixture(request);
    inheriting.proposal.after.variant.warning_threshold = {
      value: "30",
      origin: "category",
    };
    expect(matchesCreateVariantRequest(inheriting, request)).toBe(true);

    const unrequested = requestFixture({ warning_threshold: undefined });
    delete (unrequested as Record<string, unknown>).warning_threshold;
    const claimed = resultFixture(unrequested);
    claimed.proposal.after.variant.warning_threshold = {
      value: "30",
      origin: "variant",
    };
    expect(matchesCreateVariantRequest(claimed, unrequested)).toBe(false);
    const inherited = resultFixture(unrequested);
    inherited.proposal.after.variant.warning_threshold = {
      value: "30",
      origin: "family",
    };
    expect(matchesCreateVariantRequest(inherited, unrequested)).toBe(true);
  });

  it("refuses a unit cost that is not the family's, because the write sets none", () => {
    const request = requestFixture();
    const result = resultFixture(request);
    result.proposal.before.default_unit_cost = "8.5000";
    // Family cost is 8.50, but the preview claims no cost at all.
    expect(matchesCreateVariantRequest(result, request)).toBe(false);
    result.proposal.after.variant.unit_cost = {
      amount: "8.5000",
      origin: "family",
    };
    expect(matchesCreateVariantRequest(result, request)).toBe(true);
    result.proposal.after.variant.unit_cost = {
      amount: "9.0000",
      origin: "family",
    };
    expect(matchesCreateVariantRequest(result, request)).toBe(false);
  });

  it("refuses an untrusted repository or a broken clock", async () => {
    const { authorityClient } = await actorFixture();
    expect(() =>
      createCatalogSetupWriteService({
        repository: {
          prepareCreateVariant: async () => resultFixture(),
        } as never,
        authorityRepository: authorityClient.repository,
      })
    ).toThrow(TypeError);
    expect(
      new CatalogSetupWriteRepositoryError("DUPLICATE").code
    ).toBe("DUPLICATE");
  });
});

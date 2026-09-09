import { describe, it, expect, vi } from "vitest";
import { createCatalogAuthoringService } from "../catalog-authoring-service";
import { actorFixture, REQUEST, resultFixture, SCOPES } from "./fixtures";
import type { ScheduleChangeRpcClient } from "../../schedule-change/schedule-change-repository";
import { resolveCatalogAuthoringCapabilityAuthorization } from "../../../registry/capability-manifest";

describe("catalog domain authority and evidence", () => {
  it("revalidates current authority and binds one exact server request", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(), error: null })
    );
    const service = createCatalogAuthoringService({
      rpc,
      authorityRepository: authorityClient.repository,
    });
    expect(await service.prepareCatalogChanges(actor, REQUEST)).toEqual(
      resultFixture()
    );
    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      "prepare_catalog_changes_as_system",
      expect.objectContaining({
        p_request: REQUEST,
        p_context: expect.objectContaining({
          actor: actor.actorUserId,
          company: actor.companyId,
          manifest: "2026-09-08.capability-manifest.v24",
        }),
      })
    );
  });
  it.each(["55P03", "57014", "25P04"])(
    "returns actionable retry guidance for database contention %s",
    async (code) => {
      const { actor, authorityClient } = await actorFixture();
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
        Promise.resolve({
          data: null,
          error: { code, message: "database error" },
        })
      );
      await expect(
        createCatalogAuthoringService({
          rpc,
          authorityRepository: authorityClient.repository,
        }).prepareCatalogChanges(actor, REQUEST)
      ).rejects.toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
        message: "The catalog is busy. Retry the same request shortly.",
      });
    }
  );
  it("rejects an unbranded actor before evidence reads", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    await expect(
      createCatalogAuthoringService({
        rpc,
        authorityRepository: authorityClient.repository,
      }).prepareCatalogChanges({ ...actor }, REQUEST)
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["ops.catalog.prepare", "ops.catalog_prices.write"])(
    "requires exact %s scope",
    async (scope) => {
      const { actor, authorityClient } = await actorFixture({
        scopes: SCOPES.filter((s) => s !== scope),
      });
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
      await expect(
        createCatalogAuthoringService({
          rpc,
          authorityRepository: authorityClient.repository,
        }).prepareCatalogChanges(actor, REQUEST)
      ).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    }
  );
  it("refuses permissions revoked after token creation", async () => {
    const { actor, authorityClient } = await actorFixture();
    authorityClient.mcpResult = {
      ...authorityClient.mcpResult!,
      configuredPermissions: [],
      effectivePermissions: [],
    };
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    await expect(
      createCatalogAuthoringService({
        rpc,
        authorityRepository: authorityClient.repository,
      }).prepareCatalogChanges(actor, REQUEST)
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["cost", "identity", "source", "skip", "seal"])(
    "rejects server %s binding corruption",
    async (kind) => {
      const { actor, authorityClient } = await actorFixture();
      const data = resultFixture();
      if (kind === "cost") data.proposal.rows[0].after!.cost = 5;
      if (kind === "identity") data.proposal.rows[0].row_key = "other";
      if (kind === "source")
        data.proposal.source = { ...data.proposal.source, name: "Other file" };
      if (kind === "skip")
        data.proposal.skipped_rows = [{ source_row: "3", reason: "hidden" }];
      if (kind === "seal") data.preview_sha256 = null;
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
        Promise.resolve({ data, error: null })
      );
      await expect(
        createCatalogAuthoringService({
          rpc,
          authorityRepository: authorityClient.repository,
        }).prepareCatalogChanges(actor, REQUEST)
      ).rejects.toThrow();
    }
  );
  it("selects extra cost authority only for an explicit cost patch", () => {
    const plain = resolveCatalogAuthoringCapabilityAuthorization(
      "prepare_catalog_changes",
      REQUEST
    );
    const cost = resolveCatalogAuthoringCapabilityAuthorization(
      "prepare_catalog_changes",
      {
        ...REQUEST,
        rows: [
          {
            ...REQUEST.rows[0],
            values: { ...REQUEST.rows[0].values, cost: "4.00" },
          },
        ],
      }
    );
    expect(cost.variants.length).toBe(plain.variants.length + 1);
  });
  it("rejects source content used as approval fields", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    await expect(
      createCatalogAuthoringService({
        rpc,
        authorityRepository: authorityClient.repository,
      }).prepareCatalogChanges(actor, { ...REQUEST, approved: true } as never)
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

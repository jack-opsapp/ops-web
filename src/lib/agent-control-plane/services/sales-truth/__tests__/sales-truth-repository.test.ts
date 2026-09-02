import { describe, expect, it, vi } from "vitest";

import {
  createSalesTruthRepository,
  SalesTruthRepositoryUnavailableError,
  type SalesTruthRpcClient,
} from "../sales-truth-repository";
import {
  SALES_TRUTH_CLIENT_ID,
  SALES_TRUTH_COMPANY_ID,
  SALES_TRUTH_GRANT_ID,
  SALES_TRUTH_PERMISSIONS,
  SALES_TRUTH_SCOPES,
  SALES_TRUTH_USER_ID,
  salesTruthActorFixture,
  salesTruthSourceFixture,
} from "./fixtures";

describe("sales-truth repository", () => {
  it("makes one abortable read with the exact v13/v7 actor binding and source bounds", async () => {
    const { actor } = await salesTruthActorFixture();
    const source = salesTruthSourceFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({ data: source, error: null }));
    const rpc = vi.fn<SalesTruthRpcClient["rpc"]>(() =>
      Object.assign(Promise.resolve({ data: source, error: null }), {
        abortSignal,
      })
    );

    await expect(
      createSalesTruthRepository({ rpc }).readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        signal,
      })
    ).resolves.toEqual(source);

    expect(rpc).toHaveBeenCalledWith("read_agent_sales_truth_as_system", {
      p_actor_user_id: SALES_TRUTH_USER_ID,
      p_company_id: SALES_TRUTH_COMPANY_ID,
      p_oauth_grant_id: SALES_TRUTH_GRANT_ID,
      p_oauth_client_id: SALES_TRUTH_CLIENT_ID,
      p_grant_revision: "b".repeat(32),
      p_granted_scope_ceiling: SALES_TRUTH_SCOPES,
      p_permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v13",
      p_exposure_revision: "2026-09-01.mcp-exposure.v7",
      p_capability_id: "analyze_sales_truth",
      p_capability_revision: "analyze_sales_truth:2026-09-01.v1",
      p_observed_at: source.observed_at,
      p_window_days: 180,
      p_opportunity_limit: 5_000,
      p_transition_limit: 20_000,
      p_disposition_limit: 5_000,
      p_activity_limit: 20_000,
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("binds a v15 actor to the exact dormant v9 exposure", async () => {
    const { actor } = await salesTruthActorFixture(
      SALES_TRUTH_PERMISSIONS,
      "2026-09-01.capability-manifest.v15"
    );
    const source = salesTruthSourceFixture();
    const rpc = vi.fn<SalesTruthRpcClient["rpc"]>(() =>
      Promise.resolve({ data: source, error: null })
    );

    await createSalesTruthRepository({ rpc }).readSourceSnapshot({
      actorContext: actor,
      observedAt: source.observed_at,
    });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
      p_exposure_revision: "2026-09-01.mcp-exposure.v9",
    });
  });

  it("rejects wrong manifest actors, storage errors, clock drift, and malformed snapshots", async () => {
    const { actor } = await salesTruthActorFixture();
    const source = salesTruthSourceFixture();
    const wrongManifest = { ...actor, capabilityManifestRevision: "wrong" };
    const rpc = vi.fn<SalesTruthRpcClient["rpc"]>(() =>
      Promise.resolve({ data: source, error: null })
    );
    await expect(
      createSalesTruthRepository({ rpc }).readSourceSnapshot({
        actorContext: wrongManifest,
        observedAt: source.observed_at,
      })
    ).rejects.toThrow("Sales-truth analysis requires a supported MCP actor");
    expect(rpc).not.toHaveBeenCalled();

    const failing = createSalesTruthRepository({
      rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
    });
    await expect(
      failing.readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
      })
    ).rejects.toBeInstanceOf(SalesTruthRepositoryUnavailableError);

    for (const data of [
      { ...source, observed_at: "2026-09-01T12:00:01.000Z" },
      { ...source, context: { ...source.context, timezone: "Invalid/Zone" } },
    ]) {
      await expect(
        createSalesTruthRepository({
          rpc: () => Promise.resolve({ data, error: null }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
        })
      ).rejects.toBeInstanceOf(SalesTruthRepositoryUnavailableError);
    }
  });
});

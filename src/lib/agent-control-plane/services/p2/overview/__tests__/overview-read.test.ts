import { describe, expect, it } from "vitest";

import {
  getOperationalOverview,
  OperationalOverviewReadError,
} from "../get-operational-overview";
import { createSupabaseOperationalOverviewRepository } from "../overview-repository";
import {
  overviewAuthorization,
  overviewRawSnapshot,
} from "./overview-fixtures";

function repositoryFor(data: unknown, error: unknown = null) {
  return createSupabaseOperationalOverviewRepository({
    rpc: () => Promise.resolve({ data, error }),
  });
}

describe("getOperationalOverview", () => {
  it("returns one coarse row per independently authorized component", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["schedule_readiness", "integration_attention"],
      },
    });
    const result = await getOperationalOverview({
      authorization,
      repository: repositoryFor(overviewRawSnapshot({ authorization })),
    });
    expect(result.items.map(({ component }) => component)).toEqual([
      "integration_attention",
      "schedule_readiness",
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.collection_proof.source_revisions).toEqual([
      { domain: "company", source_revision: 13 },
      { domain: "integrations", source_revision: 17 },
      { domain: "legacy_operational", source_revision: 5 },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns only fixed warnings when every default is denied", async () => {
    const authorization = await overviewAuthorization({
      scopes: ["ops.operations.read"],
      permissions: [["reports.view", "all"]],
    });
    const result = await getOperationalOverview({
      authorization,
      repository: repositoryFor(overviewRawSnapshot({ authorization })),
    });
    expect(result).toMatchObject({
      items: [],
      item_proofs: [],
      evidence: [],
      warnings: authorization.warnings,
      collection_proof: {
        source_revisions: [],
        returned_count: 0,
        has_more: false,
      },
    });
  });

  it("fails closed on bounded or invalid sources", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    for (const [error, code] of [
      [
        {
          code: "54000",
          message: "agent_operational_overview_source_query_bound",
        },
        "RESULT_TOO_LARGE",
      ],
      [
        {
          code: "22000",
          message: "agent_operational_overview_source_data_invalid",
        },
        "TEMPORARILY_UNAVAILABLE",
      ],
    ] as const) {
      await expect(
        getOperationalOverview({
          authorization,
          repository: repositoryFor(null, error),
        })
      ).rejects.toMatchObject({ code });
    }
  });

  it("maps repository tampering and failures to closed errors", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    const tampered = overviewRawSnapshot({
      authorization,
      overrides: { collection_proof_ref: `ops_proof:v1:${"F".repeat(64)}` },
    });
    await expect(
      getOperationalOverview({
        authorization,
        repository: repositoryFor(tampered),
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
    await expect(
      getOperationalOverview({
        authorization,
        repository: repositoryFor(null, {
          code: "42501",
          message: "permission denied",
        }),
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
  });

  it("rejects forged authorization and repository brands", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    await expect(
      getOperationalOverview({
        authorization: {} as never,
        repository: repositoryFor(overviewRawSnapshot({ authorization })),
      })
    ).rejects.toBeInstanceOf(OperationalOverviewReadError);
    await expect(
      getOperationalOverview({
        authorization,
        repository: {} as never,
      })
    ).rejects.toBeInstanceOf(OperationalOverviewReadError);
  });

  it("honors an already aborted signal without returning data", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      getOperationalOverview({
        authorization,
        repository: repositoryFor(overviewRawSnapshot({ authorization })),
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
  });
});

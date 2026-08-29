import { describe, expect, it } from "vitest";

import {
  IntegrationHealthReadError,
  getIntegrationHealth,
} from "../get-integration-health";
import {
  createSupabaseIntegrationHealthRepository,
  type IntegrationHealthRpcClient,
} from "../integration-repository";
import {
  integrationAuthorization,
  integrationRawSnapshot,
} from "./integration-fixtures";

function client(response: Readonly<{ data: unknown; error: unknown }>) {
  return {
    rpc() {
      return Promise.resolve(response);
    },
  } as IntegrationHealthRpcClient;
}

describe("P2 integration-health service", () => {
  it("returns an immutable bounded result for every explicit selection", async () => {
    const authorization = await integrationAuthorization();
    const result = await getIntegrationHealth({
      authorization,
      repository: createSupabaseIntegrationHealthRepository(
        client({ data: integrationRawSnapshot({ authorization }), error: null })
      ),
    });
    expect(
      result.items.map(({ integration_type, provider }) => ({
        integration_type,
        provider,
      }))
    ).toEqual(authorization.query.integrations);
    expect(result.collection_proof).toMatchObject({
      returned_count: 2,
      has_more: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(60_000);
  });

  it("maps source cardinality and invalid source states without leaking details", async () => {
    const authorization = await integrationAuthorization();
    for (const [error, expected] of [
      [
        {
          code: "54000",
          message: "agent_integration_health_source_query_bound",
        },
        { code: "RESULT_TOO_LARGE", retryable: false },
      ],
      [
        {
          code: "22000",
          message: "agent_integration_health_source_data_invalid",
        },
        { code: "TEMPORARILY_UNAVAILABLE", retryable: true },
      ],
    ] as const) {
      await expect(
        getIntegrationHealth({
          authorization,
          repository: createSupabaseIntegrationHealthRepository(
            client({ data: null, error })
          ),
        })
      ).rejects.toMatchObject({
        ...expected,
        requestId: "request-integration-health",
      });
    }
  });

  it("rejects forged authorization and untrusted repositories before reading", async () => {
    const authorization = await integrationAuthorization();
    await expect(
      getIntegrationHealth({
        authorization: { ...authorization },
        repository: { read: async () => ({ state: "source_bound" as const }) },
      })
    ).rejects.toBeInstanceOf(IntegrationHealthReadError);
    await expect(
      getIntegrationHealth({
        authorization,
        repository: { read: async () => ({ state: "source_bound" as const }) },
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

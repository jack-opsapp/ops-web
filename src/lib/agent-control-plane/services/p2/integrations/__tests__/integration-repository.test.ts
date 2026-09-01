import { describe, expect, it } from "vitest";

import {
  IntegrationHealthRepositoryError,
  createSupabaseIntegrationHealthRepository,
  isTrustedIntegrationHealthRepository,
  type IntegrationHealthRpcClient,
} from "../integration-repository";
import {
  INTEGRATION_SOURCE_INSPECTED,
  integrationAuthorization,
  integrationItems,
  integrationRawSnapshot,
} from "./integration-fixtures";

class StubClient implements IntegrationHealthRpcClient {
  readonly calls: Array<{
    functionName: "read_agent_integration_health_as_system";
    args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}

  rpc(
    functionName: "read_agent_integration_health_as_system",
    args: Readonly<Record<string, unknown>>
  ) {
    this.calls.push({ functionName, args });
    return Promise.resolve(this.response);
  }
}

describe("P2 integration-health repository", () => {
  it("calls only the fixed RPC and accepts the exact safe proof-bound snapshot", async () => {
    const authorization = await integrationAuthorization();
    const client = new StubClient({
      data: integrationRawSnapshot({ authorization }),
      error: null,
    });
    const repository = createSupabaseIntegrationHealthRepository(client);
    expect(isTrustedIntegrationHealthRepository(repository)).toBe(true);
    await expect(repository.read({ authorization })).resolves.toMatchObject({
      state: "found",
      proofBinding: { sourceInspected: INTEGRATION_SOURCE_INSPECTED },
      value: {
        items: [
          { integration_type: "accounting", provider: "quickbooks" },
          { integration_type: "mailbox", provider: "gmail" },
        ],
        collection_proof: { returned_count: 2, has_more: false },
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      functionName: "read_agent_integration_health_as_system",
      args: {
        p_request_id: "request-integration-health",
        p_capability_id: "get_integration_health",
        p_capability_revision: "get_integration_health:2026-08-22.v1",
        p_required_oauth_scopes: ["ops.integrations.read"],
        p_settings_integrations_scope: "all",
        p_accounting_scope: "all",
        p_email_scope: "own",
        p_source_limit: 501,
      },
    });
    expect(client.calls[0]!.args.p_selections).toEqual([
      { integration_type: "accounting", provider: "quickbooks" },
      { integration_type: "mailbox", provider: "gmail" },
    ]);
    expect(JSON.stringify(client.calls[0])).not.toMatch(
      /access_token|refresh_token|webhook_subscription|raw_error|provider_id/
    );
  });

  it("fails closed on binding, selection, source, privacy, and proof tampering", async () => {
    const authorization = await integrationAuthorization();
    const base = integrationRawSnapshot({ authorization });
    const cases = [
      { ...base, email_scope: "all" },
      { ...base, selections: [...base.selections].reverse() },
      { ...base, source_inspected: { accounting: 501, mailbox: 1 } },
      {
        ...base,
        rows: base.rows.map((row, index) =>
          index === 0
            ? { ...row, item: { ...row.item, realm_id: "secret" } }
            : row
        ),
      },
      {
        ...base,
        rows: base.rows.map((row, index) =>
          index === 0
            ? { ...row, proof_ref: `ops_proof:v1:${"f".repeat(64)}` }
            : row
        ),
      },
    ];
    for (const data of cases) {
      const repository = createSupabaseIntegrationHealthRepository(
        new StubClient({ data, error: null })
      );
      await expect(repository.read({ authorization })).rejects.toMatchObject({
        code: "INTEGRATION_HEALTH_INVALID",
      });
    }
  });

  it("rejects every proof-valid mailbox-only state forged onto accounting", async () => {
    const authorization = await integrationAuthorization();
    const baseItems = [...integrationItems(authorization.query)];
    for (const state of [
      {
        connection_state: "reconnect_required",
        sync_state: "not_available",
        reason_code: "needs_reconnect",
        last_healthy_progress_at: null,
      },
      {
        connection_state: "reconnect_required",
        sync_state: "not_available",
        reason_code: "webhook_expired",
        last_healthy_progress_at: null,
      },
      {
        connection_state: "attention_required",
        sync_state: "not_available",
        reason_code: "webhook_setup_failed",
        last_healthy_progress_at: null,
      },
      {
        connection_state: "attention_required",
        sync_state: "stale",
        reason_code: "sync_stale",
        last_healthy_progress_at: "2026-08-29T01:00:00.000Z",
      },
      {
        connection_state: "disabled",
        sync_state: "not_available",
        reason_code: "operator_paused",
        last_healthy_progress_at: null,
      },
      {
        connection_state: "attention_required",
        sync_state: "not_available",
        reason_code: "setup_incomplete",
        last_healthy_progress_at: null,
      },
      {
        connection_state: "attention_required",
        sync_state: "not_available",
        reason_code: "provider_error",
        last_healthy_progress_at: null,
      },
    ] as const) {
      const forgedAccountingItem = {
        ...baseItems[0],
        ...state,
      } as unknown as (typeof baseItems)[number];
      const repository = createSupabaseIntegrationHealthRepository(
        new StubClient({
          data: integrationRawSnapshot({
            authorization,
            items: [forgedAccountingItem, baseItems[1]!],
          }),
          error: null,
        })
      );
      await expect(repository.read({ authorization })).rejects.toMatchObject({
        code: "INTEGRATION_HEALTH_INVALID",
      });
    }
  });

  it("maps only exact source-bound and invalid sentinels", async () => {
    const authorization = await integrationAuthorization();
    for (const [error, state] of [
      [
        {
          code: "54000",
          message: "agent_integration_health_source_query_bound",
        },
        "source_bound",
      ],
      [
        {
          code: "22000",
          message: "agent_integration_health_source_data_invalid",
        },
        "source_invalid",
      ],
    ] as const) {
      await expect(
        createSupabaseIntegrationHealthRepository(
          new StubClient({ data: null, error })
        ).read({ authorization })
      ).resolves.toEqual({ state });
    }
    await expect(
      createSupabaseIntegrationHealthRepository(
        new StubClient({
          data: null,
          error: { code: "XX000", message: "private" },
        })
      ).read({ authorization })
    ).rejects.toBeInstanceOf(IntegrationHealthRepositoryError);
  });

  it("rejects forged authorization and aborted reads", async () => {
    const authorization = await integrationAuthorization();
    const repository = createSupabaseIntegrationHealthRepository(
      new StubClient({
        data: integrationRawSnapshot({ authorization }),
        error: null,
      })
    );
    await expect(
      repository.read({ authorization: { ...authorization } })
    ).rejects.toMatchObject({ code: "INTEGRATION_HEALTH_INVALID" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({ code: "INTEGRATION_HEALTH_READ_FAILED" });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  OPERATIONAL_OVERVIEW_FETCH_LIMIT,
  OPERATIONAL_OVERVIEW_MAX_ATTENTION_COUNT,
  OPERATIONAL_OVERVIEW_MAX_SOURCE_ROWS,
} from "@/lib/agent-control-plane/contracts/operational-overview";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  createSupabaseOperationalOverviewRepository,
  isTrustedOperationalOverviewRepository,
  OperationalOverviewRepositoryError,
} from "../overview-repository";
import {
  OVERVIEW_ACTOR_ID,
  OVERVIEW_CLIENT_ID,
  OVERVIEW_COMPANY_ID,
  OVERVIEW_GRANT_ID,
  OVERVIEW_GRANT_REVISION,
  OVERVIEW_PERMISSION_REVISION,
  overviewAuthorization,
  overviewRawSnapshot,
} from "./overview-fixtures";

function clientFor(data: unknown, error: unknown = null) {
  const request = Promise.resolve({ data, error });
  const rpc = vi.fn(() => request);
  return { rpc, request };
}

describe("operational overview repository", () => {
  it("performs exactly one fixed RPC with all preauthorized component bindings", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["schedule_readiness", "integration_attention"],
      },
    });
    const raw = overviewRawSnapshot({ authorization });
    const client = clientFor(raw);
    const repository = createSupabaseOperationalOverviewRepository(client);

    const result = await repository.read({ authorization });

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "read_agent_operational_overview_as_system",
      {
        p_request_id: "request-operational-overview",
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_company_id: OVERVIEW_COMPANY_ID,
        p_oauth_grant_id: OVERVIEW_GRANT_ID,
        p_oauth_client_id: OVERVIEW_CLIENT_ID,
        p_grant_revision: OVERVIEW_GRANT_REVISION,
        p_granted_scope_ceiling: [...authorization.grantedScopeCeiling],
        p_permission_snapshot_revision: OVERVIEW_PERMISSION_REVISION,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_id: "get_operational_overview",
        p_capability_revision: "get_operational_overview:2026-08-22.v1",
        p_capability_manifest_revision: "2026-08-22.capability-manifest.v8",
        p_selections: authorization.selections,
        p_authorized_components: raw.authorized_components,
        p_warnings: [],
        p_item_limit: OPERATIONAL_OVERVIEW_MAX_ATTENTION_COUNT,
        p_page_fetch_limit: OPERATIONAL_OVERVIEW_FETCH_LIMIT,
        p_source_limit: OPERATIONAL_OVERVIEW_MAX_SOURCE_ROWS,
      }
    );
    expect(result.state).toBe("found");
    if (result.state !== "found") throw new Error("expected found");
    expect(result.value.items.map(({ component }) => component)).toEqual([
      "integration_attention",
      "schedule_readiness",
    ]);
    expect(result.value.item_proofs[0]!.source_revisions).toEqual(
      raw.rows[0]!.source_revisions
    );
    expect(result.value.item_proofs[1]!.source_revisions).toEqual(
      raw.rows[1]!.source_revisions
    );
    expect(result.value.collection_proof.source_revisions).toEqual(
      raw.source_revisions
    );
    expect(result.proofBinding.componentSourceInspected).toEqual([
      { component: "integration_attention", source_inspected: 2 },
      { component: "schedule_readiness", source_inspected: 1 },
    ]);
    expect(result.proofBinding.sourceInspected).toBe(3);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(isTrustedOperationalOverviewRepository(repository)).toBe(true);
  });

  it("keeps the warnings-only path request-bound with zero source material", async () => {
    const authorization = await overviewAuthorization({
      scopes: ["ops.operations.read"],
      permissions: [["reports.view", "all"]],
    });
    const raw = overviewRawSnapshot({ authorization });
    const client = clientFor(raw);
    const repository = createSupabaseOperationalOverviewRepository(client);

    const result = await repository.read({ authorization });

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("found");
    if (result.state !== "found") throw new Error("expected found");
    expect(result.value.items).toEqual([]);
    expect(result.value.item_proofs).toEqual([]);
    expect(result.value.evidence).toEqual([]);
    expect(result.value.collection_proof.source_revisions).toEqual([]);
    expect(result.value.warnings).toHaveLength(6);
    expect(result.proofBinding.componentSourceInspected).toEqual([]);
    expect(result.proofBinding.sourceInspected).toBe(0);
  });

  it("fails closed on binding, revision, proof, warning, and omitted-row tampering", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    const base = overviewRawSnapshot({ authorization });
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value.company_id = "99999999-9999-4999-8999-999999999999";
      },
      (value) => {
        value.request_id = "request-operational-overview-retry";
      },
      (value) => {
        value.selections = [{ component: "work_due", origin: "explicit" }];
      },
      (value) => {
        value.authorized_components = [];
      },
      (value) => {
        value.warnings = [
          {
            code: "DEFAULT_COMPONENT_OMITTED",
            component: "work_due",
          },
        ];
      },
      (value) => {
        const rows = value.rows as Array<Record<string, unknown>>;
        rows[0]!.proof_ref = `ops_proof:v1:${"F".repeat(64)}`;
      },
      (value) => {
        const rows = value.rows as Array<Record<string, unknown>>;
        rows[0]!.source_revisions = [{ domain: "tasks", source_revision: 99 }];
      },
      (value) => {
        const rows = value.rows as Array<Record<string, unknown>>;
        rows.push({
          ...rows[0],
          item: { ...(rows[0]!.item as object), component: "work_due" },
        });
      },
      (value) => {
        value.source_revisions = [];
      },
      (value) => {
        value.collection_proof_ref = `ops_proof:v1:${"E".repeat(64)}`;
      },
      (value) => {
        value.source_inspected = -1;
      },
      (value) => {
        const rows = value.rows as Array<Record<string, unknown>>;
        rows[0]!.source_inspected = Number.MAX_SAFE_INTEGER;
      },
      (value) => {
        value.component_source_inspected = [
          {
            component: "integration_attention",
            source_inspected: 1001,
          },
        ];
        value.source_inspected = 1001;
      },
    ];

    for (const mutate of mutations) {
      const raw = structuredClone(base) as unknown as Record<string, unknown>;
      mutate(raw);
      const repository = createSupabaseOperationalOverviewRepository(
        clientFor(raw)
      );
      await expect(repository.read({ authorization })).rejects.toMatchObject({
        code: "OPERATIONAL_OVERVIEW_INVALID",
      });
    }
  });

  it("rejects equal-total inspection redistribution and authorization redistribution", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["integration_attention", "schedule_readiness"],
      },
    });
    const base = overviewRawSnapshot({ authorization });

    const redistributedInspection = structuredClone(base);
    redistributedInspection.rows[0]!.source_inspected = 1;
    redistributedInspection.rows[1]!.source_inspected = 2;
    redistributedInspection.component_source_inspected = [
      { component: "integration_attention", source_inspected: 1 },
      { component: "schedule_readiness", source_inspected: 2 },
    ];
    expect(redistributedInspection.source_inspected).toBe(
      base.source_inspected
    );
    await expect(
      createSupabaseOperationalOverviewRepository(
        clientFor(redistributedInspection)
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "OPERATIONAL_OVERVIEW_INVALID" });

    const redistributedAuthorization = structuredClone(base);
    const first = redistributedAuthorization.authorized_components[0]!;
    const second = redistributedAuthorization.authorized_components[1]!;
    redistributedAuthorization.authorized_components[0] = {
      ...first,
      resolved_permission_scopes: second.resolved_permission_scopes,
    };
    redistributedAuthorization.authorized_components[1] = {
      ...second,
      resolved_permission_scopes: first.resolved_permission_scopes,
    };
    await expect(
      createSupabaseOperationalOverviewRepository(
        clientFor(redistributedAuthorization)
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "OPERATIONAL_OVERVIEW_INVALID" });
  });

  it("maps only fixed database bounds and invalid-source states", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    for (const [error, state] of [
      [
        {
          code: "54000",
          message: "agent_operational_overview_source_query_bound",
        },
        "source_bound",
      ],
      [
        {
          code: "22000",
          message: "agent_operational_overview_source_data_invalid",
        },
        "source_invalid",
      ],
    ] as const) {
      const repository = createSupabaseOperationalOverviewRepository(
        clientFor(null, error)
      );
      await expect(repository.read({ authorization })).resolves.toEqual({
        state,
      });
    }

    const repository = createSupabaseOperationalOverviewRepository(
      clientFor(null, { code: "42501", message: "permission denied" })
    );
    await expect(repository.read({ authorization })).rejects.toBeInstanceOf(
      OperationalOverviewRepositoryError
    );
  });

  it("rejects aborted calls, forged authorizations, and untrusted clients", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    const client = clientFor(overviewRawSnapshot({ authorization }));
    const repository = createSupabaseOperationalOverviewRepository(client);
    const controller = new AbortController();
    controller.abort();
    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({ code: "OPERATIONAL_OVERVIEW_READ_FAILED" });
    await expect(
      repository.read({ authorization: {} as never })
    ).rejects.toMatchObject({ code: "OPERATIONAL_OVERVIEW_INVALID" });
    expect(() =>
      createSupabaseOperationalOverviewRepository({} as never)
    ).toThrowError("An operational-overview RPC client is required");
  });
});

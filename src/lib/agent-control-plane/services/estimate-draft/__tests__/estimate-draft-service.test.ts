import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  createEstimateDraftRepository,
  type EstimateDraftRpcClient,
} from "../estimate-draft-repository";
import {
  createEstimateDraftService,
  EstimateDraftPrepareError,
} from "../estimate-draft-service";
import {
  INPUT,
  OAUTH_CLIENT_ID,
  estimateDraftActorFixture,
  estimateDraftSourceFixture,
} from "./fixtures";

function successfulRpc(source = estimateDraftSourceFixture()) {
  return vi.fn<EstimateDraftRpcClient["rpc"]>((functionName) =>
    Promise.resolve(
      functionName === "read_agent_estimate_draft_as_system"
        ? { data: source, error: null }
        : {
            data: {
              permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
              source_revision: source.source_revision,
            },
            error: null,
          }
    )
  );
}

describe("estimate draft service", () => {
  it("reauthorizes before the read and before return, then returns one truthful exact preview", async () => {
    const { actor, authorityClient } = await estimateDraftActorFixture();
    const source = estimateDraftSourceFixture();
    const rpc = successfulRpc(source);
    const service = createEstimateDraftService({
      repository: createEstimateDraftRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });

    const result = await service.prepareEstimateFromPastJob(actor, INPUT);

    expect(authorityClient.actorLookups).toHaveLength(2);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "read_agent_estimate_draft_as_system",
      "assert_agent_estimate_draft_authority_as_system",
    ]);
    expect(result).toMatchObject({
      request_id: actor.requestId,
      status: "ready",
      request: INPUT,
      source: {
        estimate_id: INPUT.source_estimate_id,
        estimate_status: "approved",
        project_status: "completed",
      },
      draft: {
        pricing_rule: { increase_percent: "8" },
        tax: { policy: "current_company_default", rate: "0.0775" },
        totals: {
          subtotal: "216.00",
          discount_amount: "21.60",
          taxable_total: "194.40",
          tax_amount: "15.07",
          total: "209.47",
          deposit_amount: "41.89",
        },
      },
      safety: {
        estimate_created: false,
        estimate_number_reserved: false,
        estimate_issued: false,
        estimate_approved: false,
        estimate_published: false,
        messages_sent: 0,
        prices_committed: false,
        commit_capability_available: false,
      },
    });
    expect(result.draft.line_items[0]?.name).toContain("<system>");
    expect(result.prompt_safety).toContain("untrusted data");
  });

  it("is replay-stable apart from the transport request id", async () => {
    const first = await estimateDraftActorFixture();
    const second = await estimateDraftActorFixture({
      requestId: "request-estimate-draft-replay",
    });
    const source = estimateDraftSourceFixture();
    const firstService = createEstimateDraftService({
      repository: createEstimateDraftRepository({ rpc: successfulRpc(source) }),
      authorityRepository: first.authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    const secondService = createEstimateDraftService({
      repository: createEstimateDraftRepository({ rpc: successfulRpc(source) }),
      authorityRepository: second.authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    const firstResult = await firstService.prepareEstimateFromPastJob(
      first.actor,
      INPUT
    );
    const secondResult = await secondService.prepareEstimateFromPastJob(
      second.actor,
      INPUT
    );
    expect(firstResult.request_id).not.toBe(secondResult.request_id);
    expect(firstResult.preview_sha256).toBe(secondResult.preview_sha256);
  });

  it("fails before reading when a scope or granular permission is missing", async () => {
    const missingScope = await estimateDraftActorFixture({
      scopes: ["ops.company.read"],
    });
    const missingPermission = await estimateDraftActorFixture({
      permissions: ["clients.view"],
    });
    for (const fixture of [missingScope, missingPermission]) {
      const rpc = successfulRpc();
      const service = createEstimateDraftService({
        repository: createEstimateDraftRepository({ rpc }),
        authorityRepository: fixture.authorityClient.repository,
      });
      await expect(
        service.prepareEstimateFromPastJob(fixture.actor, INPUT)
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("rejects tenant, source, target, tax, totals, and line-bound drift without returning a preview", async () => {
    const invalidSources = [
      {
        ...estimateDraftSourceFixture(),
        context: {
          ...estimateDraftSourceFixture().context,
          company_id: OAUTH_CLIENT_ID,
        },
      },
      {
        ...estimateDraftSourceFixture(),
        target: { ...estimateDraftSourceFixture().target, stage: "won" },
      },
      {
        ...estimateDraftSourceFixture(),
        source: { ...estimateDraftSourceFixture().source, status: "draft" },
      },
      { ...estimateDraftSourceFixture(), default_tax_rate_count: 0 },
      { ...estimateDraftSourceFixture(), source_revision: "bad" },
      { ...estimateDraftSourceFixture(), line_items: [] },
      {
        ...estimateDraftSourceFixture(),
        source: { ...estimateDraftSourceFixture().source, total: "999.00" },
      },
    ];
    for (const source of invalidSources) {
      const { actor, authorityClient } = await estimateDraftActorFixture();
      const service = createEstimateDraftService({
        repository: createEstimateDraftRepository({
          rpc: () => Promise.resolve({ data: source, error: null }),
        }),
        authorityRepository: authorityClient.repository,
        now: () => new Date(estimateDraftSourceFixture().observed_at),
      });
      await expect(
        service.prepareEstimateFromPastJob(actor, INPUT)
      ).rejects.toBeInstanceOf(EstimateDraftPrepareError);
    }
  });

  it("fails closed on source changes, final authority changes, aborts, invalid clocks, and output bounds", async () => {
    const source = estimateDraftSourceFixture();
    const cases: Array<{
      configure: (
        authorityClient: Awaited<
          ReturnType<typeof estimateDraftActorFixture>
        >["authorityClient"]
      ) => EstimateDraftRpcClient["rpc"];
      now?: () => Date;
      maxOutputCharacters?: number;
      signal?: AbortSignal;
      code: EstimateDraftPrepareError["code"];
    }> = [
      {
        configure: () => () =>
          Promise.resolve({
            data: null,
            error: {
              code: "55000",
              message: "AGENT_ESTIMATE_DRAFT_SOURCE_STALE",
            },
          }),
        code: "STALE_CONTEXT",
      },
      {
        configure: () => (functionName) =>
          Promise.resolve(
            functionName === "read_agent_estimate_draft_as_system"
              ? { data: source, error: null }
              : {
                  data: {
                    permission_snapshot_revision: "changed",
                    source_revision: source.source_revision,
                  },
                  error: null,
                }
          ),
        code: "STALE_CONTEXT",
      },
      {
        configure: () => successfulRpc(source),
        now: () => new Date("invalid"),
        code: "INTERNAL",
      },
      {
        configure: () => successfulRpc(source),
        maxOutputCharacters: 1,
        code: "RESULT_TOO_LARGE",
      },
    ];
    for (const testCase of cases) {
      const { actor, authorityClient } = await estimateDraftActorFixture();
      const service = createEstimateDraftService({
        repository: createEstimateDraftRepository({
          rpc: testCase.configure(authorityClient),
        }),
        authorityRepository: authorityClient.repository,
        now: testCase.now ?? (() => new Date(source.observed_at)),
        maxOutputCharacters: testCase.maxOutputCharacters,
      });
      await expect(
        service.prepareEstimateFromPastJob(actor, INPUT, {
          signal: testCase.signal,
        })
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });
});

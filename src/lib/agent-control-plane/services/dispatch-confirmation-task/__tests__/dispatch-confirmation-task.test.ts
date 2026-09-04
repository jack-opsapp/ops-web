import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts";
import {
  DispatchConfirmationTaskRepositoryError,
  createDispatchConfirmationTaskRepository,
  type DispatchConfirmationTaskRpcClient,
} from "../dispatch-confirmation-task-repository";
import {
  DispatchConfirmationTaskPrepareError,
  createDispatchConfirmationTaskService,
} from "../dispatch-confirmation-task-service";
import {
  ACTOR_ID,
  CLIENT_ID,
  COMPANY_ID,
  GRANT_ID,
  REQUEST,
  SCOPES,
  actorFixture,
  resultFixture,
} from "./fixtures";

describe("dispatch confirmation task domain boundary", () => {
  it("reauthorizes, sends the exact v19/v13 authority binding, and returns one sealed proposal", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<DispatchConfirmationTaskRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(), error: null })
    );
    const service = createDispatchConfirmationTaskService({
      repository: createDispatchConfirmationTaskRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date("2026-09-03T20:00:00.000Z"),
    });

    const result = await service.prepareDispatchConfirmationTask(
      actor,
      REQUEST
    );

    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(result.proposal.task.title).toBe("Confirm dispatch");
    expect(result.effects.tasks_created).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      "prepare_agent_dispatch_confirmation_task_as_system",
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_oauth_client_id: CLIENT_ID,
        p_granted_scope_ceiling: SCOPES,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_manifest_revision: "2026-09-03.capability-manifest.v19",
        p_exposure_revision: "2026-09-03.mcp-exposure.v13",
        p_capability_id: "prepare_dispatch_confirmation_task",
        p_source_task_id: REQUEST.source_task_id,
        p_expected_schedule_version: 7,
        p_idempotency_key: REQUEST.idempotency_key,
      })
    );
  });

  it("fails before persistence when a scope or current permission is missing", async () => {
    for (const fixture of [
      await actorFixture({ scopes: ["ops.company.read"] }),
      await actorFixture({ permissions: ["tasks.view"] }),
    ]) {
      const rpc = vi.fn<DispatchConfirmationTaskRpcClient["rpc"]>();
      const service = createDispatchConfirmationTaskService({
        repository: createDispatchConfirmationTaskRepository({ rpc }),
        authorityRepository: fixture.authorityClient.repository,
      });
      await expect(
        service.prepareDispatchConfirmationTask(fixture.actor, REQUEST)
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("fails closed on changed input, policy conflict, stale source, and malformed output", async () => {
    const cases = [
      ["AGENT_DISPATCH_IDEMPOTENCY_CONFLICT", "CONFLICT"],
      ["AGENT_DISPATCH_POLICY_CONFLICT", "POLICY_UNAVAILABLE"],
      ["AGENT_DISPATCH_SOURCE_STALE", "STALE_CONTEXT"],
    ] as const;
    for (const [message, code] of cases) {
      const { actor, authorityClient } = await actorFixture();
      const service = createDispatchConfirmationTaskService({
        repository: createDispatchConfirmationTaskRepository({
          rpc: () => Promise.resolve({ data: null, error: { message } }),
        }),
        authorityRepository: authorityClient.repository,
      });
      await expect(
        service.prepareDispatchConfirmationTask(actor, REQUEST)
      ).rejects.toMatchObject({ code });
    }

    const { actor, authorityClient } = await actorFixture();
    const service = createDispatchConfirmationTaskService({
      repository: createDispatchConfirmationTaskRepository({
        rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
      }),
      authorityRepository: authorityClient.repository,
    });
    await expect(
      service.prepareDispatchConfirmationTask(actor, REQUEST)
    ).rejects.toBeInstanceOf(DispatchConfirmationTaskPrepareError);
  });

  it("preserves repository error categories", () => {
    expect(new DispatchConfirmationTaskRepositoryError("POLICY").code).toBe(
      "POLICY"
    );
  });

  it("emits only contract-valid, non-fabricated failure envelopes", () => {
    const conflict = new DispatchConfirmationTaskPrepareError({
      code: "CONFLICT",
      requestId: "request-1",
    });
    expect(AgentErrorSchema.parse(conflict.toAgentError())).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      details: {
        field_issues: [{ code: "DISPATCH_CONFIRMATION_IDEMPOTENCY_CONFLICT" }],
      },
    });

    for (const code of [
      "POLICY_UNAVAILABLE",
      "STALE_CONTEXT",
      "TEMPORARILY_UNAVAILABLE",
    ] as const) {
      const error = new DispatchConfirmationTaskPrepareError({
        code,
        requestId: "request-1",
      });
      expect(AgentErrorSchema.parse(error.toAgentError())).toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      });
    }
  });
});

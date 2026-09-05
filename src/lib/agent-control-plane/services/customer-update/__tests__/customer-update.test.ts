import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { MCP_EXPOSURE_V14 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts";
import {
  CustomerUpdateRepositoryError,
  createCustomerUpdateRepository,
  type CustomerUpdateRpcClient,
} from "../customer-update-repository";
import {
  CustomerUpdatePrepareError,
  createCustomerUpdateService,
} from "../customer-update-service";
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

describe("customer update domain boundary", () => {
  it("preserves the full consented 21-scope grant through principal, actor, service and RPC", async () => {
    const scopes = [...MCP_EXPOSURE_V14.grantableScopes].sort();
    expect(scopes).toHaveLength(21);
    expect(scopes.indexOf("ops.catalog.read")).toBeLessThan(
      scopes.indexOf("ops.catalog_costs.read")
    );
    const { actor, authorityClient } = await actorFixture({ scopes });
    const rpc = vi.fn<CustomerUpdateRpcClient["rpc"]>((name, args) => {
      // Reproduce the database's ordered grant equality at the actual RPC boundary.
      expect(args.p_granted_scope_ceiling).toEqual(scopes);
      expect(args).toMatchObject({
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_oauth_client_id: CLIENT_ID,
        p_grant_revision: "8".repeat(32),
        p_exposure_revision: "2026-09-04.mcp-exposure.v14",
      });
      return Promise.resolve({ data: resultFixture(), error: null });
    });
    const service = createCustomerUpdateService({
      repository: createCustomerUpdateRepository({ rpc }),
      authorityRepository: authorityClient.repository,
    });
    await service.prepareCustomerUpdate(actor, REQUEST);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("reauthorizes, sends the exact v20/v14 authority binding, and returns one sealed proposal", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<CustomerUpdateRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(), error: null })
    );
    const service = createCustomerUpdateService({
      repository: createCustomerUpdateRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date("2026-09-03T20:00:00.000Z"),
    });

    const result = await service.prepareCustomerUpdate(actor, REQUEST);

    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(result.proposal.after.title).toBe(REQUEST.changes.title);
    expect(result.proposal.effects.messages_sent).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      "prepare_agent_customer_update_as_system",
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_oauth_client_id: CLIENT_ID,
        p_granted_scope_ceiling: SCOPES,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_manifest_revision: "2026-09-04.capability-manifest.v20",
        p_exposure_revision: "2026-09-04.mcp-exposure.v14",
        p_capability_id: "prepare_customer_update",
        p_request: REQUEST,
      })
    );
  });

  it("fails before persistence when a scope or current permission is missing", async () => {
    for (const fixture of [
      await actorFixture({ scopes: ["ops.company.read"] }),
      await actorFixture({ permissions: ["pipeline.view"] }),
      await actorFixture({
        permissions: ["agent.review", "pipeline.view", "pipeline.edit"],
      }),
    ]) {
      const rpc = vi.fn<CustomerUpdateRpcClient["rpc"]>();
      const service = createCustomerUpdateService({
        repository: createCustomerUpdateRepository({ rpc }),
        authorityRepository: fixture.authorityClient.repository,
      });
      await expect(
        service.prepareCustomerUpdate(fixture.actor, REQUEST)
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("fails closed on changed input, policy conflict, stale source, and malformed output", async () => {
    const cases = [
      ["AGENT_CUSTOMER_UPDATE_IDEMPOTENCY_CONFLICT", "CONFLICT"],
      ["AGENT_CUSTOMER_UPDATE_POLICY_CONFLICT", "POLICY_UNAVAILABLE"],
      ["AGENT_CUSTOMER_UPDATE_SOURCE_STALE", "STALE_CONTEXT"],
    ] as const;
    for (const [message, code] of cases) {
      const { actor, authorityClient } = await actorFixture();
      const service = createCustomerUpdateService({
        repository: createCustomerUpdateRepository({
          rpc: () => Promise.resolve({ data: null, error: { message } }),
        }),
        authorityRepository: authorityClient.repository,
      });
      await expect(
        service.prepareCustomerUpdate(actor, REQUEST)
      ).rejects.toMatchObject({ code });
    }

    const { actor, authorityClient } = await actorFixture();
    const service = createCustomerUpdateService({
      repository: createCustomerUpdateRepository({
        rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
      }),
      authorityRepository: authorityClient.repository,
    });
    await expect(
      service.prepareCustomerUpdate(actor, REQUEST)
    ).rejects.toBeInstanceOf(CustomerUpdatePrepareError);
  });

  it("rejects schema-valid previews with substituted target, fields, or evidence", async () => {
    for (const mutate of [
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.title = "Unrequested title";
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.opportunity_id = COMPANY_ID;
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.evidence[0]!.text = "Substituted statement";
      },
      (result: ReturnType<typeof resultFixture>) => {
        result.proposal.after.assignment_version += 1;
      },
    ]) {
      const { actor, authorityClient } = await actorFixture();
      const result = resultFixture();
      mutate(result);
      const service = createCustomerUpdateService({
        repository: createCustomerUpdateRepository({
          rpc: () => Promise.resolve({ data: result, error: null }),
        }),
        authorityRepository: authorityClient.repository,
      });
      await expect(
        service.prepareCustomerUpdate(actor, REQUEST)
      ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
    }
  });

  it("preserves repository error categories", () => {
    expect(new CustomerUpdateRepositoryError("POLICY").code).toBe("POLICY");
  });

  it("emits only contract-valid, non-fabricated failure envelopes", () => {
    const conflict = new CustomerUpdatePrepareError({
      code: "CONFLICT",
      requestId: "request-1",
    });
    expect(AgentErrorSchema.parse(conflict.toAgentError())).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      details: {
        field_issues: [{ code: "CUSTOMER_UPDATE_IDEMPOTENCY_CONFLICT" }],
      },
    });

    for (const code of [
      "POLICY_UNAVAILABLE",
      "STALE_CONTEXT",
      "TEMPORARILY_UNAVAILABLE",
    ] as const) {
      const error = new CustomerUpdatePrepareError({
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

import { reauthorizeCustomerUpdateReadActor } from "../../capability-service";
import { CAPABILITY_MANIFEST_REVISION } from "../../../registry/capability-manifest";
describe("v20 preserved read authority", () => {
  it("freshly resolves the same actor, tenant, grant and scope ceiling under the original read contracts", async () => {
    const { actor, authorityClient } = await actorFixture();
    const readActor = await reauthorizeCustomerUpdateReadActor(
      actor,
      authorityClient.repository
    );
    expect(readActor.capabilityManifestRevision).toBe(
      CAPABILITY_MANIFEST_REVISION
    );
    expect(readActor.actorUserId).toBe(actor.actorUserId);
    expect(readActor.companyId).toBe(actor.companyId);
    expect(readActor.auth).toEqual(actor.auth);
    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(actor.capabilityManifestRevision).toBe(
      "2026-09-04.capability-manifest.v20"
    );
  });
});

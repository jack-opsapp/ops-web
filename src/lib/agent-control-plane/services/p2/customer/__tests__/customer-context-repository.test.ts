import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { canonicalizeP2DomainRevisions } from "../../shared/domain-revisions";
import {
  createSupabaseCustomerContextRepository,
  CustomerContextRepositoryError,
  isTrustedCustomerContextRepository,
} from "../customer-context-repository";
import {
  CUSTOMER_CONTEXT_ACTOR_ID,
  CUSTOMER_CONTEXT_COMPANY_ID,
  CUSTOMER_CONTEXT_GRANT_REVISION,
  CUSTOMER_CONTEXT_OAUTH_CLIENT_ID,
  CUSTOMER_CONTEXT_OAUTH_GRANT_ID,
  CUSTOMER_CONTEXT_PERMISSION_REVISION,
  CUSTOMER_CONTEXT_PROOF_REF,
  CUSTOMER_CONTEXT_READ_AT,
  CUSTOMER_CONTEXT_SUB_CLIENT_ID,
  FULL_CUSTOMER_CONTEXT_QUERY,
  StubCustomerContextRpcClient,
  customerContextAuthorization,
  fullCustomerContextRaw,
} from "./customer-context-fixtures";

describe("P2 customer-context repository", () => {
  it("calls only the fixed RPC with literal authority, consent, selection, and hard-bound args", async () => {
    const authorization = await customerContextAuthorization(
      FULL_CUSTOMER_CONTEXT_QUERY
    );
    const raw = fullCustomerContextRaw();
    const client = new StubCustomerContextRpcClient([
      { data: raw, error: null },
    ]);
    const repository = createSupabaseCustomerContextRepository(client);
    const result = await repository.read({ authorization });

    expect(isTrustedCustomerContextRepository(repository)).toBe(true);
    expect(client.calls).toEqual([
      {
        functionName: "read_agent_customer_context_as_system",
        args: {
          p_request_id: "request-customer-context",
          p_actor_user_id: CUSTOMER_CONTEXT_ACTOR_ID,
          p_company_id: CUSTOMER_CONTEXT_COMPANY_ID,
          p_oauth_grant_id: CUSTOMER_CONTEXT_OAUTH_GRANT_ID,
          p_oauth_client_id: CUSTOMER_CONTEXT_OAUTH_CLIENT_ID,
          p_grant_revision: CUSTOMER_CONTEXT_GRANT_REVISION,
          p_granted_scope_ceiling: [
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          p_permission_snapshot_revision: CUSTOMER_CONTEXT_PERMISSION_REVISION,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: "get_customer_context",
          p_capability_revision: "get_customer_context:2026-08-22.v1",
          p_capability_manifest_revision: "2026-08-22.capability-manifest.v8",
          p_required_oauth_scopes: [
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          p_clients_scope: "assigned",
          p_pipeline_scope: "all",
          p_projects_scope: "assigned",
          p_customer_kind: "sub_client",
          p_customer_id: CUSTOMER_CONTEXT_SUB_CLIENT_ID,
          p_sections: [
            "business_address",
            "business_notes",
            "contacts",
            "duplicate_state",
            "job_rollup",
            "preferences",
            "profile",
          ],
          p_contact_purpose: "communication",
          p_job_kinds: ["opportunity", "project"],
          p_source_limit: 501,
          p_item_limit: 25,
        },
      },
    ]);
    expect(result).toEqual({
      state: "found",
      value: {
        ...raw.result,
        proof: {
          proof_ref: CUSTOMER_CONTEXT_PROOF_REF,
          read_at: CUSTOMER_CONTEXT_READ_AT,
          source_revisions: canonicalizeP2DomainRevisions(raw.source_revisions),
        },
      },
      proofBinding: {
        sourceRevisions: raw.source_revisions,
        sourceInspected: raw.source_inspected,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("attaches AbortSignal and fails aborted reads closed", async () => {
    const authorization = await customerContextAuthorization(
      FULL_CUSTOMER_CONTEXT_QUERY
    );
    const client = new StubCustomerContextRpcClient([
      { data: fullCustomerContextRaw(), error: null },
    ]);
    const repository = createSupabaseCustomerContextRepository(client);
    const controller = new AbortController();
    await repository.read({ authorization, signal: controller.signal });
    expect(client.abortSignals).toEqual([controller.signal]);

    controller.abort();
    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({ code: "CUSTOMER_CONTEXT_READ_FAILED" });
  });

  it("maps privacy-indistinguishable absence and physical source bounds without returning data", async () => {
    const authorization = await customerContextAuthorization(
      FULL_CUSTOMER_CONTEXT_QUERY
    );
    const client = new StubCustomerContextRpcClient([
      {
        data: null,
        error: {
          code: "P0002",
          message: "agent_customer_context_not_found_or_not_visible",
        },
      },
      {
        data: null,
        error: {
          code: "54000",
          message: "agent_customer_context_source_query_bound",
        },
      },
    ]);
    const repository = createSupabaseCustomerContextRepository(client);
    await expect(repository.read({ authorization })).resolves.toEqual({
      state: "not_found",
    });
    await expect(repository.read({ authorization })).resolves.toEqual({
      state: "source_bound",
    });
  });

  it("rejects strict-wire identity, selection, source, proof, privacy, and ordering tampering", async () => {
    const authorization = await customerContextAuthorization(
      FULL_CUSTOMER_CONTEXT_QUERY
    );
    const mutations: Array<
      (raw: ReturnType<typeof fullCustomerContextRaw>) => void
    > = [
      (raw) => {
        raw.company_id = "77777777-7777-4777-8777-777777777777";
      },
      (raw) => {
        raw.oauth_grant_id = "99999999-9999-4999-8999-999999999999";
      },
      (raw) => {
        raw.grant_revision = "e".repeat(32);
      },
      (raw) => {
        raw.selected_sections = ["profile"];
      },
      (raw) => {
        raw.source_revisions = raw.source_revisions.slice(1);
      },
      (raw) => {
        raw.source_revisions.push({
          domain: "company",
          source_revision: 1,
        } as never);
      },
      (raw) => {
        raw.source_revisions[1] = {
          ...raw.source_revisions[1]!,
          version: "revision:84",
        } as never;
      },
      (raw) => {
        raw.source_inspected.contacts = 3;
      },
      (raw) => {
        raw.source_inspected.contacts = 501;
      },
      (raw) => {
        raw.result.sections.contacts!.contacts[1]!.email = {
          state: "blocked",
          address: "leak@example.com",
        } as never;
      },
      (raw) => {
        raw.result.sections.job_rollup!.kinds.reverse();
      },
      (raw) => {
        raw.result.sections.contacts!.source_count += 1;
        raw.result.sections.contacts!.result_budget_omitted_count = 1;
      },
      (raw) => {
        raw.proof_ref = `ops_proof:v1:${"f".repeat(64)}`;
      },
      (raw) => {
        raw.result.sections.profile!.display_name = "Mutated customer";
      },
      (raw) => {
        (raw.result as unknown as Record<string, unknown>).financials = {
          total: 10,
        };
      },
    ];

    for (const mutate of mutations) {
      const raw = structuredClone(fullCustomerContextRaw());
      mutate(raw);
      const repository = createSupabaseCustomerContextRepository(
        new StubCustomerContextRpcClient([{ data: raw, error: null }])
      );
      await expect(repository.read({ authorization })).rejects.toBeInstanceOf(
        CustomerContextRepositoryError
      );
    }
  });

  it("rejects structural authorization and repository clients", async () => {
    expect(() => createSupabaseCustomerContextRepository({} as never)).toThrow(
      TypeError
    );
    const repository = createSupabaseCustomerContextRepository(
      new StubCustomerContextRpcClient([
        { data: fullCustomerContextRaw(), error: null },
      ])
    );
    const authorization = await customerContextAuthorization(
      FULL_CUSTOMER_CONTEXT_QUERY
    );
    await expect(
      repository.read({ authorization: { ...authorization } as never })
    ).rejects.toMatchObject({ code: "CUSTOMER_CONTEXT_INVALID" });
  });
});

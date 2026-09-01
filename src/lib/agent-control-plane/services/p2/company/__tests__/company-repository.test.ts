import { describe, expect, it } from "vitest";

import {
  COMPANY_ID,
  companyContextRawSnapshot,
  companyContextResult,
  createAuthorizedCompanyContextRead,
  SOURCE_INSPECTED,
  SOURCE_REVISIONS,
} from "./company-fixtures";
import {
  CompanyContextRepositoryError,
  createSupabaseCompanyContextRepository,
  isTrustedCompanyContextRepository,
  type CompanyContextRpcClient,
} from "../company-repository";

class StubClient implements CompanyContextRpcClient {
  readonly calls: Array<{
    functionName: "read_agent_company_context_as_system";
    args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}

  rpc(
    functionName: "read_agent_company_context_as_system",
    args: Readonly<Record<string, unknown>>
  ) {
    this.calls.push({ functionName, args });
    return Promise.resolve(this.response);
  }
}

describe("P2 company-context repository", () => {
  it("calls only the fixed RPC and accepts an exactly proof-bound safe snapshot", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const client = new StubClient({
      data: companyContextRawSnapshot(authorization),
      error: null,
    });
    const repository = createSupabaseCompanyContextRepository(client);

    expect(isTrustedCompanyContextRepository(repository)).toBe(true);
    await expect(repository.read({ authorization })).resolves.toEqual({
      state: "found",
      value: companyContextResult(authorization),
      proofBinding: {
        sourceRevisions: SOURCE_REVISIONS,
        sourceInspected: SOURCE_INSPECTED,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      functionName: "read_agent_company_context_as_system",
      args: {
        p_request_id: "request-company-context",
        p_actor_user_id: authorization.actorContext.actorUserId,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: authorization.oauthGrantId,
        p_oauth_client_id: authorization.oauthClientId,
        p_grant_revision: authorization.grantRevision,
        p_granted_scope_ceiling: ["ops.company.read"],
        p_permission_snapshot_revision:
          authorization.actorContext.permissionSnapshotRevision,
        p_capability_id: "get_company_context",
        p_capability_revision: "get_company_context:2026-08-22.v1",
        p_capability_manifest_revision: "2026-08-22.capability-manifest.v8",
        p_required_oauth_scopes: ["ops.company.read"],
        p_settings_company_scope: "all",
      },
    });
  });

  it("fails closed on binding, source, bound, privacy, and proof tampering", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const base = companyContextRawSnapshot(authorization);
    const cases: unknown[] = [];

    cases.push({ ...base, company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    cases.push({
      ...base,
      source_revisions: [{ domain: "catalog", source_revision: 7 }],
    });
    cases.push({
      ...base,
      source_inspected: { ...base.source_inspected, companies: 2 },
    });
    cases.push({
      ...base,
      result: {
        ...base.result,
        profile: { ...base.result.profile, admin_ids: ["private"] },
      },
    });
    cases.push({ ...base, proof_ref: `ops_proof:v1:${"f".repeat(64)}` });

    for (const data of cases) {
      const repository = createSupabaseCompanyContextRepository(
        new StubClient({ data, error: null })
      );
      await expect(repository.read({ authorization })).rejects.toMatchObject({
        code: "COMPANY_CONTEXT_INVALID",
      });
    }
  });

  it("maps only the exact hidden-company sentinel and rejects every other RPC error", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const hidden = createSupabaseCompanyContextRepository(
      new StubClient({
        data: null,
        error: {
          code: "P0002",
          message: "agent_company_context_not_found_or_not_visible",
        },
      })
    );
    await expect(hidden.read({ authorization })).resolves.toEqual({
      state: "not_found",
    });

    const failed = createSupabaseCompanyContextRepository(
      new StubClient({
        data: null,
        error: { code: "XX000", message: "private failure" },
      })
    );
    await expect(failed.read({ authorization })).rejects.toBeInstanceOf(
      CompanyContextRepositoryError
    );
  });

  it("refuses forged authorization and an already-aborted request", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const repository = createSupabaseCompanyContextRepository(
      new StubClient({
        data: companyContextRawSnapshot(authorization),
        error: null,
      })
    );
    await expect(
      repository.read({ authorization: { ...authorization } })
    ).rejects.toMatchObject({ code: "COMPANY_CONTEXT_INVALID" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({ code: "COMPANY_CONTEXT_READ_FAILED" });
  });
});

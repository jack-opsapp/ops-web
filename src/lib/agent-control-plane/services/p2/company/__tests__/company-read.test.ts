import { describe, expect, it } from "vitest";

import {
  companyContextRawSnapshot,
  companyContextResult,
  createAuthorizedCompanyContextRead,
} from "./company-fixtures";
import {
  createSupabaseCompanyContextRepository,
  type CompanyContextRpcClient,
} from "../company-repository";
import {
  CompanyContextReadError,
  getCompanyContext,
} from "../get-company-context";

function client(response: Readonly<{ data: unknown; error: unknown }>) {
  return {
    rpc() {
      return Promise.resolve(response);
    },
  } as CompanyContextRpcClient;
}

describe("P2 company-context service", () => {
  it("returns one immutable, bounded, proof-valid safe context", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const result = await getCompanyContext({
      authorization,
      repository: createSupabaseCompanyContextRepository(
        client({ data: companyContextRawSnapshot(authorization), error: null })
      ),
    });

    expect(result).toEqual(companyContextResult(authorization));
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(60_000);
  });

  it("uses privacy-identical not-found and temporarily-unavailable failures", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const hidden = createSupabaseCompanyContextRepository(
      client({
        data: null,
        error: {
          code: "P0002",
          message: "agent_company_context_not_found_or_not_visible",
        },
      })
    );
    await expect(
      getCompanyContext({ authorization, repository: hidden })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      requestId: "request-company-context",
      retryable: false,
    });

    const unavailable = createSupabaseCompanyContextRepository(
      client({ data: null, error: { code: "XX000", message: "private" } })
    );
    await expect(
      getCompanyContext({ authorization, repository: unavailable })
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      requestId: "request-company-context",
      retryable: true,
    });
  });

  it("rejects forged authorization and untrusted repositories before reading", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    await expect(
      getCompanyContext({
        authorization: { ...authorization },
        repository: { read: async () => ({ state: "not_found" as const }) },
      })
    ).rejects.toBeInstanceOf(CompanyContextReadError);
    await expect(
      getCompanyContext({
        authorization,
        repository: { read: async () => ({ state: "not_found" as const }) },
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

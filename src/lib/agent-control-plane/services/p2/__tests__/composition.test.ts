import { describe, expect, it, vi } from "vitest";

import {
  createOpsAgentP2DomainService,
  isTrustedOpsAgentP2DomainService,
} from "../domain-service";
import {
  createSupabaseOpsAgentP2Repositories,
  isTrustedOpsAgentP2Repositories,
} from "../repositories";

const EXPECTED_P2_METHODS = [
  "getCustomerContext",
  "listTasks",
  "getTaskContext",
  "listJobArtifacts",
  "getJobArtifactEvidence",
  "listSiteVisits",
  "getSiteVisitContext",
  "getDeckDesignGeometry",
  "listSalesDocuments",
  "getSalesDocument",
  "listPayments",
  "listExpenses",
  "getExpenseContext",
  "listWorkQueue",
  "searchCatalogItems",
  "getCatalogItem",
  "listPurchaseOrders",
  "getPurchaseOrder",
  "getCompanyContext",
  "listTeamMembers",
  "listTeamAvailability",
  "getIntegrationHealth",
  "getOperationalOverview",
] as const;

describe("P2 domain composition", () => {
  it("constructs one nominal repository graph and all twenty-three methods without reading", () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repositories = createSupabaseOpsAgentP2Repositories({ rpc });
    const service = createOpsAgentP2DomainService({
      repositories,
      cursorKey: {
        keyId: "p2-composition-test",
        key: Uint8Array.from({ length: 32 }, () => 0xab),
      },
    });

    expect(isTrustedOpsAgentP2Repositories(repositories)).toBe(true);
    expect(isTrustedOpsAgentP2Repositories({ ...repositories })).toBe(false);
    expect(Object.isFrozen(repositories)).toBe(true);
    expect(Object.keys(service)).toEqual(EXPECTED_P2_METHODS);
    expect(isTrustedOpsAgentP2DomainService(service)).toBe(true);
    expect(isTrustedOpsAgentP2DomainService({ ...service })).toBe(false);
    expect(Object.isFrozen(service)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed transports, repository lookalikes, and cursor keys", () => {
    expect(() => createSupabaseOpsAgentP2Repositories({} as never)).toThrow(
      TypeError
    );

    const repositories = createSupabaseOpsAgentP2Repositories({
      rpc: vi.fn(async () => ({ data: null, error: null })),
    });
    expect(() =>
      createOpsAgentP2DomainService({
        repositories: { ...repositories } as never,
        cursorKey: {
          keyId: "p2-composition-test",
          key: Uint8Array.from({ length: 32 }, () => 0xab),
        },
      })
    ).toThrow(TypeError);
    expect(() =>
      createOpsAgentP2DomainService({
        repositories,
        cursorKey: {
          keyId: "p2-composition-test",
          key: Uint8Array.from({ length: 31 }, () => 0xab),
        },
      })
    ).toThrow(TypeError);
  });

  it("captures an adversarial RPC getter exactly once before constructing repositories", () => {
    const trustedRpc = vi.fn(async () => ({ data: null, error: null }));
    const attackerRpc = vi.fn(async () => {
      throw new Error("Attacker RPC must never be captured");
    });
    let reads = 0;
    const transport = Object.defineProperty({}, "rpc", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? trustedRpc : attackerRpc;
      },
    });

    const repositories = createSupabaseOpsAgentP2Repositories(
      transport as { rpc: typeof trustedRpc }
    );

    expect(isTrustedOpsAgentP2Repositories(repositories)).toBe(true);
    expect(reads).toBe(1);
    expect(trustedRpc).not.toHaveBeenCalled();
    expect(attackerRpc).not.toHaveBeenCalled();
  });

  it("captures each cursor-key field exactly once before minting services", () => {
    const repositories = createSupabaseOpsAgentP2Repositories({
      rpc: vi.fn(async () => ({ data: null, error: null })),
    });
    let keyIdReads = 0;
    let keyReads = 0;
    const cursorKey = Object.defineProperties(
      {},
      {
        keyId: {
          enumerable: true,
          get() {
            keyIdReads += 1;
            return keyIdReads === 1 ? "p2-captured" : "attacker";
          },
        },
        key: {
          enumerable: true,
          get() {
            keyReads += 1;
            return keyReads === 1
              ? Uint8Array.from({ length: 32 }, () => 0xab)
              : new Uint8Array(31);
          },
        },
      }
    );

    const service = createOpsAgentP2DomainService({
      repositories,
      cursorKey: cursorKey as {
        readonly keyId: string;
        readonly key: Uint8Array;
      },
    });

    expect(isTrustedOpsAgentP2DomainService(service)).toBe(true);
    expect(keyIdReads).toBe(1);
    expect(keyReads).toBe(1);
  });
});

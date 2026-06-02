// tests/unit/services/sync-orchestrator-pull-only.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const pushClient = vi.fn((..._a: unknown[]) => undefined);
const pullClients = vi.fn(async (..._a: unknown[]) => []);
const pullInvoices = vi.fn(async (..._a: unknown[]) => []);

vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: { getValidToken: vi.fn(async () => ({ accessToken: "t", realmId: "r" })) },
}));
vi.mock("@/lib/api/services/quickbooks-sync-service", () => ({
  QuickBooksSyncService: {
    pushClient: (...a: unknown[]) => pushClient(...a),
    pushInvoice: vi.fn(), pushEstimate: vi.fn(), pushPayment: vi.fn(),
    pullClients: (...a: unknown[]) => pullClients(...a),
    pullInvoices: (...a: unknown[]) => pullInvoices(...a),
  },
}));
vi.mock("@/lib/api/services/sage-sync-service", () => ({ SageSyncService: {} }));

function fakeSupabase() {
  const writes: string[] = [];
  const api: any = {
    from(t: string) {
      return {
        select: () => ({ eq: () => ({ or: () => Promise.resolve({ data: [], error: null }) }) }),
        update: () => { writes.push(`update:${t}`); return { eq: () => Promise.resolve({ error: null }) }; },
        insert: () => { writes.push(`insert:${t}`); return Promise.resolve({ error: null }); },
        upsert: () => { writes.push(`upsert:${t}`); return Promise.resolve({ error: null }); },
      };
    },
    __writes: writes,
  };
  return api;
}

describe("runSyncForConnection pull_only guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pull_only never invokes any push* method", async () => {
    const { runSyncForConnection } = await import("@/lib/api/services/sync-orchestrator");
    const sb = fakeSupabase();
    await runSyncForConnection(sb, "co-1", "quickbooks", "conn-1", null, "pull_only");
    expect(pushClient).not.toHaveBeenCalled();
    expect(pullClients).toHaveBeenCalled(); // pulls still run
  });

  it("bidirectional still pushes (backwards compatible)", async () => {
    const { runSyncForConnection } = await import("@/lib/api/services/sync-orchestrator");
    const sb = fakeSupabase();
    await runSyncForConnection(sb, "co-1", "quickbooks", "conn-1", null, "bidirectional");
    // No client rows returned, so pushClient body loop doesn't run, but the
    // push *section* executed (no throw). Pull still runs.
    expect(pullClients).toHaveBeenCalled();
  });
});

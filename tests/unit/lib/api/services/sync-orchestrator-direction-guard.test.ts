import { describe, expect, it, vi, beforeEach } from "vitest";

// Use vi.hoisted so the mock fns exist before the vi.mock factories run.
const { pushClient, pushInvoice, pushEstimate, pushPayment, pullClients, pullInvoices } =
  vi.hoisted(() => ({
    pushClient: vi.fn(),
    pushInvoice: vi.fn(),
    pushEstimate: vi.fn(),
    pushPayment: vi.fn(),
    pullClients: vi.fn(async () => []),
    pullInvoices: vi.fn(async () => []),
  }));

vi.mock("@/lib/api/services/quickbooks-sync-service", () => ({
  QuickBooksSyncService: { pushClient, pushInvoice, pushEstimate, pushPayment, pullClients, pullInvoices },
}));
vi.mock("@/lib/api/services/sage-sync-service", () => ({
  SageSyncService: {
    pushClient: vi.fn(), pushInvoice: vi.fn(), pushEstimate: vi.fn(),
    pushPayment: vi.fn(), pullClients: vi.fn(async () => []), pullInvoices: vi.fn(async () => []),
  },
}));
vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: vi.fn(async () => ({ accessToken: "tok", realmId: "realm-1" })),
  },
}));

import { runSyncForConnection } from "@/lib/api/services/sync-orchestrator";

/**
 * Minimal chainable Supabase stub. select(...).eq(...).eq(...).single()
 * returns the connection row carrying sync_direction; all writes/upserts
 * resolve to no-ops; pull selects (clients/invoices by qb_id) resolve empty.
 */
function makeSupabaseStub(syncDirection: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    or: vi.fn(chain),
    order: vi.fn(chain),
    limit: vi.fn(chain),
    update: vi.fn(chain),
    insert: vi.fn(async () => ({ data: null, error: null })),
    upsert: vi.fn(async () => ({ data: null, error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({
      data: { id: "conn-1", sync_direction: syncDirection },
      error: null,
    })),
    then: undefined,
  });
  // `await builder` (used for list selects) resolves to an empty rows envelope.
  (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });
  return { from: vi.fn(() => builder) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSyncForConnection direction guard", () => {
  it("never calls any push* method for a pull_only connection", async () => {
    const supabase = makeSupabaseStub("pull_only");
    await runSyncForConnection(
      supabase,
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      "quickbooks",
      "conn-1",
      null
    );
    expect(pushClient).not.toHaveBeenCalled();
    expect(pushInvoice).not.toHaveBeenCalled();
    expect(pushEstimate).not.toHaveBeenCalled();
    expect(pushPayment).not.toHaveBeenCalled();
  });

  it("never calls any pull* method for a push_only connection", async () => {
    const supabase = makeSupabaseStub("push_only");
    await runSyncForConnection(
      supabase,
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      "quickbooks",
      "conn-1",
      null
    );
    expect(pullClients).not.toHaveBeenCalled();
    expect(pullInvoices).not.toHaveBeenCalled();
  });

  it("does not emit QuickBooks push results for a bidirectional connection", async () => {
    vi.stubEnv("ACCOUNTING_WRITE_ENABLED", "true");
    const supabase = makeSupabaseStub("bidirectional");
    const result = await runSyncForConnection(
      supabase,
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      "quickbooks",
      "conn-1",
      null
    );
    expect(result.results.some((r) => r.direction === "push")).toBe(false);
    expect(pullClients).toHaveBeenCalledTimes(1);
    expect(pullInvoices).toHaveBeenCalledTimes(1);
  });
});

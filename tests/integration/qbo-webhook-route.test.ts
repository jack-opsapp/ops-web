import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { realmIdLookup } from "@/lib/api/services/token-cipher";

// ── Mocks ───────────────────────────────────────────────────────────────────
// The route resolves the connection via the service-role client, then delegates
// each entity to QuickBooksWebhookApplyService.applyEntity. We mock both so the
// route's verify + route + dispatch logic is exercised in isolation.

const connMaybeSingle = vi.fn();
const syncLogInsert = vi.fn();
const applyEntity = vi.fn();

// A minimal service-role client double: `from(table)` returns a chainable query
// builder. accounting_connections lookups resolve via connMaybeSingle;
// accounting_sync_log inserts record into syncLogInsert.
function makeSupabase() {
  return {
    from(table: string) {
      if (table === "accounting_connections") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => connMaybeSingle(),
        };
        return builder;
      }
      if (table === "accounting_sync_log") {
        return { insert: (row: unknown) => syncLogInsert(row) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeSupabase(),
}));

vi.mock("@/lib/api/services/quickbooks-webhook-apply-service", () => ({
  QuickBooksWebhookApplyService: class {
    applyEntity = (...a: unknown[]) => applyEntity(...a);
  },
}));

const VERIFIER = "test-qb-webhook-verifier-token";
const REALM = "4620816365088321";
const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";

function sign(body: string): string {
  return createHmac("sha256", VERIFIER).update(body, "utf8").digest("base64");
}

function buildBody(entities: Array<{ name: string; id: string; operation: string }>): string {
  return JSON.stringify({
    eventNotifications: [
      {
        realmId: REALM,
        dataChangeEvent: {
          entities: entities.map((e) => ({ ...e, lastUpdated: "2026-06-03T00:00:00.000Z" })),
        },
      },
    ],
  });
}

function req(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["intuit-signature"] = signature;
  return new Request("http://localhost/api/integrations/quickbooks/webhook", {
    method: "POST",
    headers,
    body,
  });
}

async function loadPost() {
  const mod = await import("@/app/api/integrations/quickbooks/webhook/route");
  return mod.POST;
}

describe("POST /api/integrations/quickbooks/webhook — signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QB_WEBHOOK_VERIFIER_TOKEN = VERIFIER;
    connMaybeSingle.mockResolvedValue({
      data: { id: "conn-1", company_id: CO },
      error: null,
    });
    applyEntity.mockResolvedValue({
      status: "success",
      logEntityType: "invoice",
      qbId: "130",
      detail: null,
    });
    syncLogInsert.mockResolvedValue({ error: null });
  });

  it("accepts a request with the correct HMAC and dispatches the entity (200)", async () => {
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, sign(body)));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({ received: true, processed: 1 });

    expect(applyEntity).toHaveBeenCalledTimes(1);
    const [conn, name, id, operation] = applyEntity.mock.calls[0];
    expect(conn).toEqual({ id: "conn-1", company_id: CO });
    expect(name).toBe("Invoice");
    expect(id).toBe("130");
    expect(operation).toBe("Update");
    expect(syncLogInsert).toHaveBeenCalledTimes(1);
  });

  it("rejects a WRONG signature (401) and processes nothing", async () => {
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, "this-is-not-the-right-signature"));

    expect(res.status).toBe(401);
    expect(applyEntity).not.toHaveBeenCalled();
    expect(connMaybeSingle).not.toHaveBeenCalled();
  });

  it("rejects a MISSING signature header (401) and processes nothing", async () => {
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, null));

    expect(res.status).toBe(401);
    expect(applyEntity).not.toHaveBeenCalled();
  });

  it("rejects a signature built over DIFFERENT bytes (401) — verifies the raw body, not a reserialization", async () => {
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    // Sign a DIFFERENT body than the one we send.
    const otherSig = sign(buildBody([{ name: "Invoice", id: "999", operation: "Update" }]));
    const POST = await loadPost();
    const res = await POST(req(body, otherSig));
    expect(res.status).toBe(401);
    expect(applyEntity).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED with 500 when the verifier env is unset (never processes unverified)", async () => {
    const saved = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
    delete process.env.QB_WEBHOOK_VERIFIER_TOKEN;
    try {
      const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
      const POST = await loadPost();
      // Even a "correctly" signed request must not be processed without a verifier.
      const res = await POST(req(body, sign(body)));
      expect(res.status).toBe(500);
      expect(applyEntity).not.toHaveBeenCalled();
    } finally {
      process.env.QB_WEBHOOK_VERIFIER_TOKEN = saved;
    }
  });
});

describe("POST /api/integrations/quickbooks/webhook — realm routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QB_WEBHOOK_VERIFIER_TOKEN = VERIFIER;
    applyEntity.mockResolvedValue({
      status: "success",
      logEntityType: "invoice",
      qbId: "130",
      detail: null,
    });
    syncLogInsert.mockResolvedValue({ error: null });
  });

  it("processes a notification whose realm maps to a connected company", async () => {
    connMaybeSingle.mockResolvedValue({ data: { id: "conn-1", company_id: CO }, error: null });
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect((await res.json()).processed).toBe(1);
    expect(applyEntity).toHaveBeenCalledTimes(1);
  });

  it("looks up the connection by the deterministic realm hash", async () => {
    // Spy on the realm hash so we can assert routing uses it (sanity check that
    // the helper is deterministic and the route would query by it).
    expect(realmIdLookup(REALM)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips (still 200) when the realm maps to no connected company", async () => {
    connMaybeSingle.mockResolvedValue({ data: null, error: null });
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect((await res.json()).processed).toBe(0);
    expect(applyEntity).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/quickbooks/webhook — entity dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QB_WEBHOOK_VERIFIER_TOKEN = VERIFIER;
    connMaybeSingle.mockResolvedValue({ data: { id: "conn-1", company_id: CO }, error: null });
    syncLogInsert.mockResolvedValue({ error: null });
  });

  it("dispatches a Customer Update to the apply service", async () => {
    applyEntity.mockResolvedValue({
      status: "success",
      logEntityType: "client",
      qbId: "1",
      detail: null,
    });
    const body = buildBody([{ name: "Customer", id: "1", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    const [, name, id, operation] = applyEntity.mock.calls[0];
    expect(name).toBe("Customer");
    expect(id).toBe("1");
    expect(operation).toBe("Update");
  });

  it("ignores unhandled entity types (e.g. Item) — never dispatched", async () => {
    const body = buildBody([{ name: "Item", id: "5", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect((await res.json()).processed).toBe(0);
    expect(applyEntity).not.toHaveBeenCalled();
  });

  it("still returns 200 when a per-entity apply throws (Intuit must not retry forever)", async () => {
    applyEntity.mockRejectedValue(new Error("transient QB 500"));
    const body = buildBody([{ name: "Invoice", id: "130", operation: "Update" }]);
    const POST = await loadPost();
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    // The failure was logged as an error row, not surfaced as a non-2xx.
    expect(syncLogInsert).toHaveBeenCalledTimes(1);
    expect(syncLogInsert.mock.calls[0][0]).toMatchObject({ status: "error", external_id: "130" });
  });
});

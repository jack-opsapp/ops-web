// tests/integration/sync-route-pull-only-409.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const runSyncForConnection = vi.fn();
const connSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/api/services/sync-orchestrator", () => ({
  runSyncForConnection: (...a: unknown[]) => runSyncForConnection(...a),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: () => connSingle() }) }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function post(body: unknown) {
  return new Request("http://localhost/api/sync", { method: "POST", body: JSON.stringify(body) }) as never;
}

describe("POST /api/sync direction gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    runSyncForConnection.mockResolvedValue({ success: true, results: [], message: "ok" });
  });

  it("409 when connection is pull_only", async () => {
    connSingle.mockResolvedValue({
      data: { id: "conn-1", is_connected: true, last_sync_at: null, sync_direction: "pull_only" },
      error: null,
    });
    const { POST } = await import("@/app/api/sync/route");
    const res = await POST(post({ companyId: CO, provider: "quickbooks" }));
    expect(res.status).toBe(409);
    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it("runs and forwards sync_direction for bidirectional", async () => {
    connSingle.mockResolvedValue({
      data: { id: "conn-1", is_connected: true, last_sync_at: null, sync_direction: "bidirectional" },
      error: null,
    });
    const { POST } = await import("@/app/api/sync/route");
    const res = await POST(post({ companyId: CO, provider: "quickbooks" }));
    expect(res.status).toBe(200);
    expect(runSyncForConnection).toHaveBeenCalledWith(
      expect.anything(), CO, "quickbooks", "conn-1", null, "bidirectional"
    );
  });
});

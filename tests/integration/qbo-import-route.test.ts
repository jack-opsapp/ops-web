// tests/integration/qbo-import-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const startImportRun = vi.fn();
const pullAndStage = vi.fn();
const computeCustomerMatches = vi.fn();
const getImportReview = vi.fn();
const connSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      single: () => connSingle(),
    };
    return { from: () => chain };
  },
}));
vi.mock("@/lib/api/services/quickbooks-import-service", () => ({
  QuickBooksImportService: class {
    startImportRun = (...a: unknown[]) => startImportRun(...a);
    pullAndStage = (...a: unknown[]) => pullAndStage(...a);
    computeCustomerMatches = (...a: unknown[]) => computeCustomerMatches(...a);
    getImportReview = (...a: unknown[]) => getImportReview(...a);
  },
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function req(body: unknown, url = "http://localhost/api/integrations/quickbooks/import") {
  return new Request(url, { method: "POST", body: JSON.stringify(body) }) as never;
}

describe("POST /api/integrations/quickbooks/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    connSingle.mockResolvedValue({ data: { id: "conn-1", is_connected: true }, error: null });
    startImportRun.mockResolvedValue({ id: "run-1", company_id: CO, status: "pending" });
    pullAndStage.mockResolvedValue(undefined);
    computeCustomerMatches.mockResolvedValue(undefined);
  });

  it("401 when unauthenticated", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(401);
  });

  it("403 when lacking accounting.manage_connections", async () => {
    checkPermissionById.mockResolvedValue(false);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(403);
  });

  it("403 when company mismatch", async () => {
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "other-co" });
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(403);
  });

  it("400 when companyId missing", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("runs start→pull→match and returns runId", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: "run-1" });
    expect(startImportRun).toHaveBeenCalledWith(CO);
    expect(pullAndStage).toHaveBeenCalledWith("run-1");
    expect(computeCustomerMatches).toHaveBeenCalledWith("run-1");
  });

  it("GET returns the review aggregate for a runId", async () => {
    getImportReview.mockResolvedValue({ run: { id: "run-1", companyId: CO }, matches: [], counts: {}, reconciliation: {} });
    const { GET } = await import("@/app/api/integrations/quickbooks/import/route");
    const url = `http://localhost/api/integrations/quickbooks/import?runId=run-1`;
    const res = await GET(new Request(url) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).run.id).toBe("run-1");
    expect(getImportReview).toHaveBeenCalledWith("run-1");
  });
});

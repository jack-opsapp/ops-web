// tests/integration/qbo-import-apply-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const applyImport = vi.fn();
const runSingle = vi.fn();
const runUpdate = vi.fn();
const notificationInsert = vi.fn();
const notificationUpdate = vi.fn();
// Captures the background callback passed to next/server `after()` so the test
// can run it and assert the post-response write + notification resolution.
const afterMock = vi.fn();

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (cb: unknown) => afterMock(cb) };
});
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (t: string) => {
      if (t === "qbo_import_runs") {
        return {
          select: () => ({ eq: () => ({ single: () => runSingle() }) }),
          update: (patch: unknown) => {
            runUpdate(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (t === "notifications") {
        return {
          insert: (row: unknown) => {
            notificationInsert(row);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: "notif-1" }, error: null }),
              }),
            };
          },
          update: (patch: unknown) => {
            notificationUpdate(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return {};
    },
  }),
}));
vi.mock("@/lib/api/services/quickbooks-import-service", () => ({
  QuickBooksImportService: class {
    applyImport = (...a: unknown[]) => applyImport(...a);
  },
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function post(body: unknown) {
  return new Request("http://localhost/api/integrations/quickbooks/import/apply", {
    method: "POST", body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/integrations/quickbooks/import/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    runSingle.mockResolvedValue({ data: { id: "run-1", company_id: CO }, error: null });
    applyImport.mockResolvedValue({
      clientsLinked: 0, clientsCreated: 1, clientsSkipped: 0,
      estimatesUpserted: 1, invoicesUpserted: 1, lineItemsInserted: 2,
      paymentsUpserted: 1, invoicesReconciled: 1, qb_write_calls: 0,
    });
  });

  it("401 unauthenticated", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: [] }))).status).toBe(401);
  });

  it("403 without permission", async () => {
    checkPermissionById.mockResolvedValue(false);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: [] }))).status).toBe(403);
  });

  it("403 when run belongs to another company", async () => {
    runSingle.mockResolvedValue({ data: { id: "run-1", company_id: "other" }, error: null });
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: [] }))).status).toBe(403);
  });

  it("400 when runId missing", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ decisions: [] }))).status).toBe(400);
  });

  it("400 when decisions is not an array", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: "nope" }))).status).toBe(400);
  });

  it("accepts (202), marks the run applying, and opens a persistent rail notification", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    const res = await POST(post({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB-CUST-1", action: "create" }],
    }));

    // Background job: respond immediately, do the write after.
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toEqual({ status: "applying", runId: "run-1" });

    // Run is flipped to `applying` up front so the client's first poll sees it.
    expect(runUpdate).toHaveBeenCalledWith({ status: "applying" });

    // A PERSISTENT "applying" notification is opened, deep-linking to the tab.
    expect(notificationInsert).toHaveBeenCalledTimes(1);
    const note = notificationInsert.mock.calls[0][0];
    expect(note.user_id).toBe("user-1");
    expect(note.company_id).toBe(CO);
    expect(note.action_url).toBe("/books?segment=sync&view=import");
    expect(note.persistent).toBe(true);

    // The write hasn't run yet — it's deferred to after().
    expect(applyImport).not.toHaveBeenCalled();
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("runs the write in after() and resolves the notification to a completion", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    await POST(post({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB-CUST-1", action: "create" }],
    }));

    // Execute the captured background callback.
    const backgroundJob = afterMock.mock.calls[0][0] as () => Promise<void>;
    await backgroundJob();

    expect(applyImport).toHaveBeenCalledWith("run-1", [
      { customer_qb_id: "QB-CUST-1", action: "create" },
    ]);
    // The persistent notification is resolved to a non-persistent completion.
    expect(notificationUpdate).toHaveBeenCalledTimes(1);
    const patch = notificationUpdate.mock.calls[0][0];
    expect(patch.persistent).toBe(false);
    expect(patch.title).toMatch(/complete/i);
  });

  it("resolves the notification to a failure state when the background write throws", async () => {
    applyImport.mockRejectedValue(new Error("write failed"));
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    await POST(post({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB-CUST-1", action: "create" }],
    }));

    const backgroundJob = afterMock.mock.calls[0][0] as () => Promise<void>;
    await backgroundJob();

    expect(notificationUpdate).toHaveBeenCalledTimes(1);
    const patch = notificationUpdate.mock.calls[0][0];
    expect(patch.persistent).toBe(false);
    expect(patch.title).toMatch(/couldn't finish/i);
  });
});

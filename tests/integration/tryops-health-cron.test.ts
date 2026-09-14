// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ db: vi.fn(), control: vi.fn(), health: vi.fn() }));
vi.mock("@/lib/supabase/admin-client", () => ({ getAdminSupabase: m.db }));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({ runWithCronWorkloadControl: m.control }));
vi.mock("@/lib/admin/analytics-health-runner", () => ({ runAnalyticsHealth: m.health }));
import { GET } from "@/app/api/cron/analytics-health/route";
const request = (secret = "local-only") => new NextRequest("https://app.opsapp.co/api/cron/analytics-health", { headers: { authorization: `Bearer ${secret}` } });
const evaluation = { overall: "healthy", checkedAt: "2026-09-14T21:00:00Z", failedChecks: [], sources: [] };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "local-only");
  vi.stubEnv("OPS_PLATFORM_ALERT_USER_ID", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("OPS_PLATFORM_ALERT_COMPANY_ID", "22222222-2222-4222-8222-222222222222");
  m.control.mockImplementation(async ({ work }) => ({ status: "completed", value: await work() }));
  m.health.mockResolvedValue({ evaluation, transitions: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function database(error: unknown = null) {
  const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { status: "drained", delivered: 1, pending: 0, failed: 0 }, error }) });
  m.db.mockReturnValue({ rpc }); return rpc;
}
it("runs actual consumer inside the authenticated existing lease and returns delivery separately", async () => {
  const rpc = database(); const response = await GET(request());
  expect(response.status).toBe(200);
  expect((await response.json()).tryopsHealth).toEqual({ status: "drained", delivered: 1, pending: 0, failed: 0 });
  expect(m.control).toHaveBeenCalledWith(expect.objectContaining({ workloadKey: "analytics-health", leaseSeconds: 90 }));
  expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(m.health.mock.invocationCallOrder[0]);
});
it("does not break analytics source evaluation when the new migration is unavailable", async () => {
  database({ code: "PGRST202" }); const response = await GET(request()); const body = await response.json();
  expect(response.status).toBe(503); expect(body.state).toBe("healthy");
  expect(body.ok).toBe(false); expect(body.aggregateState).toBe("degraded");
  expect(body.tryopsHealth).toEqual({ status: "unavailable", reason: "migration_unavailable" });
  expect(m.health).toHaveBeenCalledOnce(); expect(console.error).toHaveBeenCalled();
});
it("reports a failed rail insert as degraded while preserving completed source checks", async () => {
  const rpc = database();
  rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { status: "drained", delivered: 0, failed: 1, pending: 1 }, error: null }) });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, aggregateState: "degraded", state: "healthy", ran: true });
  expect(m.health).toHaveBeenCalledOnce();
});
it("does not count a waiting backoff row alone as a new delivery failure", async () => {
  const rpc = database();
  rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { status: "drained", delivered: 0, failed: 0, pending: 1 }, error: null }) });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, aggregateState: "healthy" });
});
it("preserves a failed analytics source in the aggregate even when delivery also fails", async () => {
  database({ code: "57014" });
  m.health.mockResolvedValue({ evaluation: { ...evaluation, overall: "failed" }, transitions: [] });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, state: "failed", aggregateState: "failed" });
});
it("still drains its durable alerts before an existing analytics source fails", async () => {
  const rpc = database(); m.health.mockRejectedValue(new Error("analytics source offline"));
  expect((await GET(request())).status).toBe(500);
  expect(rpc).toHaveBeenCalledOnce();
});
it("cannot consume outbox rows without cron authentication", async () => {
  const rpc = database(); expect((await GET(request("wrong"))).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled(); expect(m.control).not.toHaveBeenCalled();
});
it("does not bypass an occupied workload lease", async () => {
  const rpc = database(); m.control.mockResolvedValue({ status: "skipped", reason: "lease_held" });
  expect((await GET(request())).status).toBe(200);
  expect(rpc).not.toHaveBeenCalled(); expect(m.health).not.toHaveBeenCalled();
});

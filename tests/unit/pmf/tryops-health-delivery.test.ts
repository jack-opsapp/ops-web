// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { drainTryopsHealthNotifications } from "@/lib/pmf/tryops-health-delivery";
const userId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const environment = { OPS_PLATFORM_ALERT_USER_ID: userId, OPS_PLATFORM_ALERT_COMPANY_ID: companyId };
function fixture(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  return { client: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
it("drains a bounded batch using only configured server operator identity", async () => {
  const f = fixture({ status: "drained", delivered: 2, pending: 0, failed: 0 });
  expect(await drainTryopsHealthNotifications({ client: f.client, environment })).toEqual({ status: "drained", delivered: 2, pending: 0, failed: 0 });
  expect(f.rpc).toHaveBeenCalledWith("drain_tryops_health_notifications", { p_user_id: userId, p_company_id: companyId, p_limit: 20 });
  expect(f.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("does not invent a recipient when configuration is missing or malformed", async () => {
  const f = fixture(null);
  expect(await drainTryopsHealthNotifications({ client: f.client, environment: {} })).toEqual({ status: "unavailable", reason: "recipient_unconfigured" });
  expect(await drainTryopsHealthNotifications({ client: f.client, environment: { ...environment, OPS_PLATFORM_ALERT_USER_ID: "someone@example.test" } })).toEqual({ status: "unavailable", reason: "recipient_unconfigured" });
  expect(f.rpc).not.toHaveBeenCalled();
});
it("reports a database-rejected operator without claiming delivery", async () => {
  const f = fixture({ status: "rejected", reason: "invalid_recipient" });
  expect(await drainTryopsHealthNotifications({ client: f.client, environment })).toEqual({ status: "unavailable", reason: "invalid_recipient" });
});
it("keeps missing migration observable and retryable without throwing", async () => {
  const f = fixture(null, { code: "PGRST202", message: "sensitive raw text" });
  expect(await drainTryopsHealthNotifications({ client: f.client, environment })).toEqual({ status: "unavailable", reason: "migration_unavailable" });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive raw text");
});
it("reports transport errors and later consumes recovered storage", async () => {
  const f = fixture(null); f.abortSignal.mockRejectedValueOnce(new Error("private details"));
  expect(await drainTryopsHealthNotifications({ client: f.client, environment })).toEqual({ status: "unavailable", reason: "storage_unavailable" });
  f.abortSignal.mockResolvedValue({ data: { status: "drained", delivered: 1, pending: 0, failed: 0 }, error: null });
  expect((await drainTryopsHealthNotifications({ client: f.client, environment })).status).toBe("drained");
});
it.each([null, [], {}, { status: "drained", delivered: -1, pending: 0, failed: 0 }, { status: "drained", delivered: 21, pending: 0, failed: 0 }, { status: "drained", delivered: 0, pending: 0, failed: "0" }])("rejects malformed or unbounded acknowledgement %j", async data => {
  const f = fixture(data);
  expect(await drainTryopsHealthNotifications({ client: f.client, environment })).toEqual({ status: "unavailable", reason: "invalid_response" });
});
it("surfaces partial failures and backlog so retries are not swallowed", async () => {
  const f = fixture({ status: "drained", delivered: 1, pending: 4, failed: 1 });
  expect(await drainTryopsHealthNotifications({ client: f.client, environment })).toEqual({ status: "drained", delivered: 1, pending: 4, failed: 1 });
  expect(console.error).toHaveBeenCalledWith("[tryops/health] delivery pending", { status: "drained", delivered: 1, pending: 4, failed: 1 });
});

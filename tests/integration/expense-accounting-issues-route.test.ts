// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  load: vi.fn(),
  db: { rpc: vi.fn() },
}));
vi.mock("@/lib/accounting/supplier-bills/route-auth", () => ({
  resolveSupplierBillActor: mocks.actor,
}));
vi.mock("@/lib/accounting/expenses/review-service", () => ({
  loadExpenseAccountingIssues: mocks.load,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.db,
}));
import {
  GET,
  POST,
} from "@/app/api/integrations/accounting/expense-issues/route";
const id = "0db4e6af-3b62-41d5-9a86-d7569c57c1e8";
const post = (body: unknown = { queueId: id }) =>
  new NextRequest(
    "https://example.test/api/integrations/accounting/expense-issues",
    { method: "POST", body: JSON.stringify(body) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "true");
  mocks.actor.mockResolvedValue({
    actorUserId: "verified-actor",
    companyId: "verified-company",
  });
  mocks.db.rpc.mockResolvedValue({
    data: { queueId: id, status: "pending" },
    error: null,
  });
});
describe("expense issue recovery API", () => {
  it("binds GET to the verified company, exact requested connection, and pagination", async () => {
    mocks.load.mockResolvedValue({
      connectionId: id,
      issues: [],
      nextOffset: null,
    });
    const result = await GET(
      new NextRequest(
        `https://example.test/api/integrations/accounting/expense-issues?connectionId=${id}&offset=50`
      )
    );
    expect(mocks.load).toHaveBeenCalledWith(
      mocks.db,
      "verified-company",
      id,
      50
    );
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), [
      "accounting.manage_connections",
      "expenses.approve",
    ]);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it("calls only the guarded retry RPC with the verified actor", async () => {
    const result = await POST(post());
    expect(mocks.db.rpc).toHaveBeenCalledWith(
      "retry_expense_accounting_before_write",
      { p_actor_user_id: "verified-actor", p_queue_id: id }
    );
    expect(await result.json()).toEqual({ queueId: id, status: "pending" });
  });
  it("accepts a canonical cancellation receipt without implying provider payment", async () => {
    mocks.db.rpc.mockResolvedValue({
      data: { queueId: id, status: "cancelled" },
      error: null,
    });
    const result = await POST(post());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ queueId: id, status: "cancelled" });
  });
  it.each([
    { queueId: id, actorUserId: "spoofed" },
    { queueId: "invalid" },
    { queueId: id, connectionId: id },
    null,
  ])("rejects malformed or caller-supplied authority %s", async (body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("preserves denied authentication before any database operation", async () => {
    mocks.actor.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await POST(post())).status).toBe(403);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it.each(["42501", "23514"])(
    "returns a bounded error for RPC guard %s",
    async (code) => {
      mocks.db.rpc.mockResolvedValue({
        error: { code, message: "private details" },
      });
      const result = await POST(post());
      expect(result.status).toBe(code === "42501" ? 403 : 409);
      expect(JSON.stringify(await result.json())).not.toContain(
        "private details"
      );
    }
  );
  it("does not claim success after malformed canonical receipt or uncertain transport", async () => {
    mocks.db.rpc
      .mockResolvedValueOnce({ data: { queueId: id, status: "claimed" } })
      .mockRejectedValueOnce(new Error("timeout"));
    expect((await POST(post())).status).toBe(503);
    expect((await POST(post())).status).toBe(503);
  });
});


afterEach(() => vi.unstubAllEnvs());
describe("expense retry activation", () => {
  it.each([undefined, "false", "TRUE"])("denies retry before RPC when gate is %s", async (value) => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", value);
    const result = await POST(post());
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ code: "EXPENSE_ACCOUNTING_PAUSED", error: "Expense accounting sync is paused." });
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it.each([401, 403])("preserves %s authentication denial while paused", async (status) => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    mocks.actor.mockResolvedValue(NextResponse.json({}, { status }));
    expect((await POST(post())).status).toBe(status);
    expect(mocks.db.rpc).not.toHaveBeenCalled();
  });
  it("allows explicit guarded recovery only after activation", async () => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    expect((await POST(post())).status).toBe(409);
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "true");
    expect((await POST(post())).status).toBe(200);
    expect(mocks.db.rpc).toHaveBeenCalledTimes(1);
  });
});

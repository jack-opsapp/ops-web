// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createExpenseSyncHandler } from "../../../supabase/functions/accounting-sync-expense/handler";

const expenseId = "812a7d55-59b9-40ed-98f8-942b6d52f435";
const companyId = "30cf31ee-370b-4f61-a310-2f43cb884e09";
function setup(
  response: Response = Response.json({ status: "pending", queued: 1 })
) {
  const fetcher = vi.fn().mockResolvedValue(response);
  const handler = createExpenseSyncHandler({
    supabaseUrl: "https://example.supabase.co",
    anonKey: "public-anon-key",
    fetcher,
  });
  return { fetcher, handler };
}
function request(
  body: unknown,
  authorization = "Bearer firebase-original-token"
) {
  return new Request(
    "https://example.supabase.co/functions/v1/accounting-sync-expense",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("expense sync compatibility edge", () => {
  it.each([
    ["{broken", 400],
    ["x".repeat(4097), 413],
  ])("rejects invalid raw bodies before RPC delivery", async (body, status) => {
    const { handler, fetcher } = setup();
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer original" },
        body,
      })
    );
    expect(response.status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [{ expense_id: expenseId }, null],
    [{ expenseId, companyId }, companyId],
    [{ expense_id: expenseId.toUpperCase(), expenseId }, null],
  ])(
    "forwards exact caller and accepts supported request %j",
    async (body, expectedCompany) => {
      const { handler, fetcher } = setup();
      const response = await handler(request(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "pending", queued: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(
        "https://example.supabase.co/rest/v1/rpc/request_expense_accounting_sync"
      );
      expect(init.headers).toEqual({
        authorization: "Bearer firebase-original-token",
        apikey: "public-anon-key",
        "content-type": "application/json",
      });
      expect(JSON.parse(init.body)).toEqual({
        p_expense_id: expenseId,
        p_company_id: expectedCompany,
      });
    }
  );
  it.each([
    {},
    null,
    [],
    { expense_id: "not-a-uuid" },
    { expense_id: expenseId, expenseId: companyId },
    { expenseId, companyId: "wrong" },
    { expense_id: expenseId, redirect: "https://attacker.test" },
  ])("rejects invalid request %j without I/O", async (body) => {
    const { handler, fetcher } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a bearer and does not use admin authentication", async () => {
    const { handler, fetcher } = setup();
    expect((await handler(request({ expense_id: expenseId }, ""))).status).toBe(
      401
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("handles CORS and rejects other methods without I/O", async () => {
    const { handler, fetcher } = setup();
    expect(
      (
        await handler(
          new Request("https://example.test", { method: "OPTIONS" })
        )
      ).status
    ).toBe(204);
    expect((await handler(new Request("https://example.test"))).status).toBe(
      405
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 500])(
    "does not leak an upstream %i error",
    async (status) => {
      const { handler } = setup(
        Response.json({ message: "sensitive upstream details" }, { status })
      );
      const response = await handler(request({ expense_id: expenseId }));
      expect(response.status).toBe(status < 500 ? status : 503);
      expect(await response.text()).not.toContain("sensitive");
    }
  );
  it("reports an unavailable queue without claiming success", async () => {
    const { handler, fetcher } = setup();
    fetcher.mockRejectedValue(new Error("secret network detail"));
    const response = await handler(request({ expense_id: expenseId }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
  it("keeps a missing cutover RPC unavailable without falling back to a provider", async () => {
    const { handler, fetcher } = setup(
      Response.json(
        { code: "PGRST202", message: "request RPC missing from schema cache" },
        { status: 404 }
      )
    );
    const response = await handler(request({ expense_id: expenseId }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Accounting sync is unavailable. Try again.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://example.supabase.co/rest/v1/rpc/request_expense_accounting_sync"
    );
  });
  it("does not trust malformed success responses", async () => {
    const { handler } = setup(Response.json({ unrelated: "ok" }));
    expect((await handler(request({ expense_id: expenseId }))).status).toBe(
      503
    );
  });
});

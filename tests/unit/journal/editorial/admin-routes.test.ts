import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: true as boolean,
  rpc: vi.fn(),
  send: vi.fn(),
  insert: vi.fn(async () => ({ error: null })),
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/admin/api-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/api-auth")>("@/lib/admin/api-auth");
  return {
    ...actual,
    requireAdmin: vi.fn(async () => {
      if (!state.admin) throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return { uid: "u1", email: "jackson@opsapp.co", claims: {} };
    }),
  };
});
vi.mock("@/lib/email/sendgrid", () => ({ sendBlogNewsletter: state.send }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: state.rpc,
    from: (table: string) =>
      table === "email_log"
        ? { insert: state.insert }
        : {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }),
            }),
          },
  }),
}));

import { POST } from "@/app/api/admin/journal/editorial/[id]/route";

const ID = "11111111-1111-4111-8111-111111111111";

function call(body: unknown, id = ID) {
  return POST(
    new NextRequest(`https://app.opsapp.co/api/admin/journal/editorial/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe("admin journal actions", () => {
  beforeEach(() => {
    state.admin = true;
    state.rpc.mockReset();
    state.send.mockReset();
    state.insert.mockClear();
    state.row = null;
  });

  it("refuses anyone who is not an admin", async () => {
    state.admin = false;
    const response = await call({ action: "stop" });
    expect(response.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown action and a malformed id", async () => {
    expect((await call({ action: "delete" })).status).toBe(400);
    expect((await call({ action: "stop" }, "nope")).status).toBe(404);
  });

  it("stops through the ledger and names the operator", async () => {
    state.rpc.mockResolvedValue({ data: "cancelled", error: null });
    const response = await call({ action: "stop" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.rpc).toHaveBeenCalledWith("cancel_journal_editorial_assignment", { p_id: ID, p_actor: "admin:jackson@opsapp.co" });
  });

  it("publishes by hand only through the guarded function and passes on its refusal", async () => {
    state.rpc.mockResolvedValueOnce({ data: { state: "published", blog_id: "b1" }, error: null });
    const ok = await call({ action: "publish_now" });
    expect(await ok.json()).toEqual({ state: "published", blog_id: "b1" });
    expect(state.rpc).toHaveBeenCalledWith("publish_journal_editorial_assignment", { p_id: ID, p_manual: true, p_actor: "admin:jackson@opsapp.co" });

    state.rpc.mockResolvedValueOnce({ data: { code: "SLUG_TAKEN" }, error: null });
    const refused = await call({ action: "publish_now" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ code: "SLUG_TAKEN", state: null });
  });

  it("writes another only while the slot can still be met", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    const response = await call({ action: "write_another" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "SLOT_PASSED" });
  });

  it("mails a test to the operator alone and logs it", async () => {
    state.row = {
      id: ID,
      slug: "the-first-call",
      preview: { url: "https://x/blog/journal/a.jpg" },
      package: { article: { title: "THE FIRST CALL", teaser: "t", email_content: "<p>e</p>" }, html: "<p>b</p>" },
    };
    state.send.mockResolvedValue({ sent: 1, failed: 0, skipped: 0, errors: [], results: [{ email: "jackson@opsapp.co", status: "sent" }] });
    const response = await call({ action: "send_test" });
    expect(response.status).toBe(200);
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: [{ email: "jackson@opsapp.co", first_name: null }] })
    );
    expect(state.insert).toHaveBeenCalledWith([
      expect.objectContaining({ email_type: "blog_newsletter_test", recipient_email: "jackson@opsapp.co" }),
    ]);
  });
});

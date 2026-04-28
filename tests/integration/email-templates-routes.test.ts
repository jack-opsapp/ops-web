import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  withAdmin: (h: any) => h,
  requireAdmin: async () => ({ userId: "admin", email: "ops@opsapp.co" }),
}));

const listTemplatesMock = vi.fn();
const listVersionsMock = vi.fn();
vi.mock("@/lib/admin/email-template-queries", () => ({
  listTemplates: () => listTemplatesMock(),
  listTemplateVersions: () => listVersionsMock(),
}));

const sendTransactionalEmailMock = vi.fn();
vi.mock("@/lib/email/sendgrid", () => ({
  sendTransactionalEmail: (params: any) => sendTransactionalEmailMock(params),
}));

const insertMock = vi.fn();
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({ insert: (row: any) => insertMock(row) }),
  }),
}));

import { GET as listGET } from "@/app/api/admin/email/templates/route";
import { GET as detailGET } from "@/app/api/admin/email/templates/[templateId]/route";
import { POST as previewPOST } from "@/app/api/admin/email/templates/[templateId]/preview/route";
import { POST as sendTestPOST } from "@/app/api/admin/email/templates/[templateId]/send-test/route";

beforeEach(() => {
  listTemplatesMock.mockReset();
  listVersionsMock.mockReset();
  sendTransactionalEmailMock.mockReset();
  insertMock.mockReset();
  insertMock.mockResolvedValue({ data: null, error: null });
});

describe("email templates routes", () => {
  it("GET /api/admin/email/templates returns ok + templates array", async () => {
    listTemplatesMock.mockResolvedValueOnce([
      { templateId: "x", displayName: "X", currentVersion: "1.0.0", versionsCount: 1 },
    ]);
    const r = await (listGET as unknown as (req: Request, ctx: unknown) => Promise<Response>)(new Request("https://x"), {});
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.templates).toHaveLength(1);
  });

  it("GET /api/admin/email/templates/[id] returns 404 for unknown", async () => {
    listVersionsMock.mockResolvedValueOnce([]);
    const r = await detailGET(new Request("https://x") as any, {
      params: Promise.resolve({ templateId: "nonexistent" }),
    });
    expect(r.status).toBe(404);
  });

  it("GET /api/admin/email/templates/[id] returns versions for known", async () => {
    listVersionsMock.mockResolvedValueOnce([
      {
        id: "v1",
        template_id: "password_reset",
        version: "1.0.0",
        content_hash: "abc",
        rendered_sample_html: "<html/>",
        preview_props: {},
        notes: null,
        created_at: "2026-04-27T00:00:00Z",
      },
    ]);
    const r = await detailGET(new Request("https://x") as any, {
      params: Promise.resolve({ templateId: "password_reset" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.template.templateId).toBe("password_reset");
    expect(j.versions).toHaveLength(1);
  });

  it("POST /preview returns 404 for unknown template", async () => {
    const r = await previewPOST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ props: {} }),
      }) as any,
      { params: Promise.resolve({ templateId: "nonexistent" }) }
    );
    expect(r.status).toBe(404);
  });

  it("POST /preview renders html for known template", async () => {
    const r = await previewPOST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ props: { resetLink: "https://x/y" } }),
      }) as any,
      { params: Promise.resolve({ templateId: "password_reset" }) }
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(typeof j.html).toBe("string");
    expect(j.html.length).toBeGreaterThan(100);
  });

  it("POST /send-test rejects missing recipient", async () => {
    const r = await sendTestPOST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ recipient: "", props: {} }),
      }) as any,
      { params: Promise.resolve({ templateId: "password_reset" }) }
    );
    expect(r.status).toBe(400);
    expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
  });

  it("POST /send-test sends and logs on success", async () => {
    sendTransactionalEmailMock.mockResolvedValueOnce(undefined);
    const r = await sendTestPOST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({
          recipient: "qa@opsapp.co",
          props: { resetLink: "https://x/y" },
        }),
      }) as any,
      { params: Promise.resolve({ templateId: "password_reset" }) }
    );
    expect(r.status).toBe(200);
    expect(sendTransactionalEmailMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledOnce();
    const logged = insertMock.mock.calls[0][0];
    expect(logged.recipient_email).toBe("qa@opsapp.co");
    expect(logged.email_type).toBe("password_reset");
    expect(logged.metadata.is_test).toBe(true);
    expect(logged.metadata.via).toBe("admin_test");
    expect(logged.status).toBe("sent");
  });

  it("POST /send-test logs failure when send throws", async () => {
    sendTransactionalEmailMock.mockRejectedValueOnce(new Error("sg down"));
    const r = await sendTestPOST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({
          recipient: "qa@opsapp.co",
          props: { resetLink: "https://x/y" },
        }),
      }) as any,
      { params: Promise.resolve({ templateId: "password_reset" }) }
    );
    expect(r.status).toBe(500);
    expect(insertMock).toHaveBeenCalledOnce();
    const logged = insertMock.mock.calls[0][0];
    expect(logged.status).toBe("failed");
    expect(logged.error_message).toBe("sg down");
  });

  it("POST /send-test 404s for unknown template", async () => {
    const r = await sendTestPOST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ recipient: "qa@opsapp.co", props: {} }),
      }) as any,
      { params: Promise.resolve({ templateId: "nonexistent" }) }
    );
    expect(r.status).toBe(404);
  });
});

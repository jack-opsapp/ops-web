import { beforeEach, describe, expect, it, vi } from "vitest";
import sgMail from "@sendgrid/mail";

vi.mock("@/lib/supabase/server-client", () => {
  const empty = { data: [], error: null };
  interface QueryChain {
    select(): QueryChain;
    in(): QueryChain;
    eq(): Promise<typeof empty>;
    ilike(): QueryChain;
    limit(): Promise<typeof empty>;
    insert(): Promise<{ error: null }>;
  }
  const chain = {} as QueryChain;
  chain.select = () => chain;
  chain.in = () => chain;
  chain.eq = () => Promise.resolve(empty);
  chain.ilike = () => chain;
  chain.limit = () => Promise.resolve(empty);
  chain.insert = () => Promise.resolve({ error: null });
  return {
    getServiceRoleClient: () => ({ from: () => chain }),
  };
});

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi
      .fn()
      .mockResolvedValue([{ headers: { "x-message-id": "sg-mcp-123" } }, {}]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "0".repeat(64);
});

describe("MCP tool-request operator alert", () => {
  it("sends the durable request to support with a requester reply-to", async () => {
    const { sendMcpToolRequest } = await import("@/lib/email/sendgrid");

    await sendMcpToolRequest({
      requesterEmail: "builder@example.com",
      details:
        "Compare this estimate with the last similar job and keep the result read-only.",
      submissionId: "mcp-tool:11111111-1111-4111-8111-111111111111",
      adminUrl: "https://app.opsapp.co/admin/feedback",
    });

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const message = vi.mocked(sgMail.send).mock.calls[0]?.[0];
    if (!message || Array.isArray(message)) {
      throw new Error("Expected one SendGrid message");
    }
    expect(message.to).toBe("support@opsapp.co");
    expect(message.from).toEqual({
      email: "dispatch@opsapp.co",
      name: "OPS Dispatch",
    });
    expect(message.replyTo).toBe("builder@example.com");
    expect(message.subject).toBe(
      "MCP tool request — mcp-tool:11111111-1111-4111-8111-111111111111"
    );
    expect(message.subject).not.toContain("builder@example.com");
    expect(message.customArgs?.email_type).toBe("mcp_tool_request");
    expect(message.html).toContain("builder@example.com");
    expect(message.html).toContain("Compare this estimate");
    expect(message.html).toContain("https://app.opsapp.co/admin/feedback");
  }, 15_000);
});

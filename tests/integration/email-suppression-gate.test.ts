/**
 * Verifies that suppressed addresses are skipped at the send chokepoint
 * (gatedSend). We mock @sendgrid/mail and the Supabase client, then call
 * sendPasswordReset with a suppressed address and assert that sgMail.send
 * was NOT called and email_log was inserted with status='suppression_skipped'.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so the mock fns exist before vi.mock factories run.
const { sgSend, fromMock } = vi.hoisted(() => ({
  sgSend: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: sgSend,
  },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: fromMock }),
}));

vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<html>fake</html>"),
}));

import { sendPasswordReset } from "@/lib/email/sendgrid";

beforeEach(() => {
  vi.clearAllMocks();
  sgSend.mockResolvedValue([{ statusCode: 202 } as unknown, {}]);
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  // PR 2 — gatedSend builds a compliance unsubscribe URL on every send,
  // which requires a 32+ char HMAC secret.
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "z".repeat(64);
});

function mockSuppressed(emails: string[]) {
  fromMock.mockImplementation((table: string) => {
    if (table === "email_suppressions") {
      return {
        select: () => ({
          ilike: () => ({
            in: () => ({
              limit: async () =>
                emails.length === 0
                  ? { data: [], error: null }
                  : {
                      data: emails.map(() => ({
                        id: "sup-1",
                        list: "global",
                        expires_at: null,
                      })),
                      error: null,
                    },
            }),
          }),
        }),
      };
    }
    if (table === "email_log") {
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

describe("send-time suppression gate", () => {
  it("skips sgMail.send when recipient is suppressed", async () => {
    mockSuppressed(["blocked@example.com"]);
    await sendPasswordReset({
      email: "blocked@example.com",
      resetLink: "https://app.opsapp.co/reset?x=1",
    });
    expect(sgSend).not.toHaveBeenCalled();
  });

  it("logs status=suppression_skipped when recipient is suppressed", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "email_suppressions") {
        return {
          select: () => ({
            ilike: () => ({
              in: () => ({
                limit: async () => ({
                  data: [{ id: "x", list: "global", expires_at: null }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "email_log") return { insert: insertSpy };
      throw new Error(`unexpected table: ${table}`);
    });
    await sendPasswordReset({
      email: "blocked@example.com",
      resetLink: "https://app.opsapp.co/reset?x=1",
    });
    expect(insertSpy).toHaveBeenCalledOnce();
    const inserted = insertSpy.mock.calls[0][0];
    expect(inserted.status).toBe("suppression_skipped");
    expect(inserted.recipient_email).toBe("blocked@example.com");
    expect(inserted.email_type).toBe("password_reset");
  });

  it("dispatches normally when recipient is NOT suppressed", async () => {
    mockSuppressed([]);
    await sendPasswordReset({
      email: "ok@example.com",
      resetLink: "https://app.opsapp.co/reset?x=1",
    });
    expect(sgSend).toHaveBeenCalledOnce();
    const sendArg = sgSend.mock.calls[0][0];
    expect(sendArg.to).toBe("ok@example.com");
    expect(sendArg.subject).toBe("Reset your OPS password");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import sgMail from "@sendgrid/mail";

vi.mock("@/lib/supabase/server-client", () => {
  const chain: any = {
    select: () => chain,
    insert: () => Promise.resolve({ error: null }),
    in: () => chain,
    eq: () => Promise.resolve({ data: [], error: null }),
    ilike: () => chain,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    getServiceRoleClient: () => ({ from: () => chain }),
  };
});

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([
      { headers: { "x-message-id": "sg-test-456" } },
      {},
    ]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "0".repeat(64);
});

describe("Dispatch-persona onboarding senders", () => {
  it("sendOnboardingDay1NoProject uses DISPATCH from, replyTo jack@", async () => {
    const { sendOnboardingDay1NoProject } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay1NoProject({
      email: "test@example.com",
      ctaUrl: "https://app.opsapp.co/projects/new",
      onboardingEmailLogId: "log-uuid-1",
    });
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.from).toEqual({ email: "dispatch@opsapp.co", name: "OPS Dispatch" });
    expect(call.replyTo).toBe("jack@opsapp.co");
    expect(call.subject).toBe("the move that gets OPS working");
  });

  it("sendOnboardingDay1HasProject renders projectCount-aware copy", async () => {
    const { sendOnboardingDay1HasProject } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay1HasProject({
      email: "test@example.com",
      projectCount: 1,
      ctaUrl: "https://app.opsapp.co/dashboard",
      onboardingEmailLogId: "log-uuid-2",
    });
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.subject).toBe("you're moving");
    expect(call.html).toContain("first project");
  });

  it("sendOnboardingDay4NoNotification renders the mocked push card", async () => {
    const { sendOnboardingDay4NoNotification } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay4NoNotification({
      email: "test@example.com",
      ctaUrl: "https://app.opsapp.co/settings/team",
      onboardingEmailLogId: "log-uuid-3",
    });
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.html).toContain("Task Completed");
    expect(call.html).toContain("Jake completed");
  });

  it("sendOnboardingDay4HasNotification subject 'you've heard the ping'", async () => {
    const { sendOnboardingDay4HasNotification } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay4HasNotification({
      email: "test@example.com",
      ctaUrl: "https://app.opsapp.co/projects?filter=recurring",
      onboardingEmailLogId: "log-uuid-4",
    });
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.subject).toBe("you've heard the ping");
  });
});

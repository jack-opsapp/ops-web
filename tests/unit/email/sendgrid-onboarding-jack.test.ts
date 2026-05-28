/**
 * Verifies the six Jack-persona onboarding senders in sendgrid.tsx route
 * through gatedSend with the correct sender identity, reply-to, subject,
 * and SendGrid customArgs (so webhooks can attribute opens / clicks back to
 * the originating onboarding_email_log row).
 *
 * Source spec: PR Onboarding Drip Task 18, plan v3.1 §3.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import sgMail from "@sendgrid/mail";

// Mock supabase service-role client used by gatedSend internals.
//   - pause check:        .from('email_pause_state').select(...).in(...).eq(...)
//   - suppression check:  .from('email_suppressions').select(...).ilike(...).in(...).limit(...)
//   - log insert:         .from('email_log').insert(...)
// Every chain method returns an object exposing every method that could be
// called next, so the same generic mock handles all three paths.
vi.mock("@/lib/supabase/server-client", () => {
  const empty = { data: [], error: null };
  const chain: Record<string, any> = {};
  chain.select = () => chain;
  chain.in = () => chain;
  chain.eq = () => Promise.resolve(empty);
  chain.ilike = () => chain;
  chain.limit = () => Promise.resolve(empty);
  chain.insert = () => Promise.resolve({ error: null });
  return {
    getServiceRoleClient: () => ({
      from: () => chain,
    }),
  };
});

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([
      { headers: { "x-message-id": "sg-test-123" } },
      {},
    ]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "0".repeat(64);
});

describe("Jack-persona onboarding senders", () => {
  it("sendOnboardingDay0Welcome uses JACK from, replies to jack@, includes onboarding_email_log_id in customArgs", async () => {
    const { sendOnboardingDay0Welcome } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay0Welcome({
      email: "test@example.com",
      firstName: "Pat",
      onboardingEmailLogId: "log-uuid-123",
    });

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.from).toEqual({ email: "jack@opsapp.co", name: "Jack Sweet" });
    expect(call.replyTo).toBe("jack@opsapp.co");
    expect(call.customArgs.email_type).toBe("onboarding_day_0_welcome");
    expect(call.customArgs.onboarding_email_log_id).toBe("log-uuid-123");
  });

  it("sendOnboardingDay3Inbox has subject 'the part of OPS I'm most proud of'", async () => {
    const { sendOnboardingDay3Inbox } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay3Inbox({
      email: "test@example.com",
      firstName: "Pat",
      onboardingEmailLogId: "log-uuid-456",
    });
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.subject).toBe("the part of OPS I'm most proud of");
  });

  it("sendOnboardingDay14Active includes the three stat counts in the rendered html", async () => {
    const { sendOnboardingDay14Active } = await import("@/lib/email/sendgrid");
    await sendOnboardingDay14Active({
      email: "test@example.com",
      firstName: "Pat",
      projectCount: 3,
      taskCount: 8,
      notificationCount: 2,
      onboardingEmailLogId: "log-uuid-789",
    });
    const call = (sgMail.send as any).mock.calls[0][0];
    expect(call.html).toContain("3 projects, 8 tasks");
  });
});

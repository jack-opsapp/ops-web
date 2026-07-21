import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";

describe("OneSignal external-user delivery idempotency", () => {
  beforeEach(() => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "os-1", recipients: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards the durable delivery UUID as OneSignal idempotency_key", async () => {
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";

    const result = await sendOneSignalPush({
      recipientUserIds: ["user-1"],
      title: "Lead assigned",
      body: "Open Canpro framing",
      data: {
        leadId: "lead-1",
        screen: "leadDetails",
        type: "lead_assigned",
      },
      idempotencyKey,
    });

    expect(result).toEqual({ ok: true, recipients: 1, onesignalId: "os-1" });
    const [, request] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toMatchObject({
      idempotency_key: idempotencyKey,
      include_aliases: { external_id: ["user-1"] },
      data: {
        leadId: "lead-1",
        screen: "leadDetails",
        type: "lead_assigned",
      },
    });
  });

  it("passes a cancellation signal to bound provider work", async () => {
    await sendOneSignalPush({
      recipientUserIds: ["user-1"],
      title: "OPENAI CREDITS EXHAUSTED",
      body: "OpenAI calls stopped. Add credits now.",
      timeoutMs: 25,
    });

    const [, request] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("settles safely when OneSignal exceeds the caller timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );

    const result = await Promise.race([
      sendOneSignalPush({
        recipientUserIds: ["user-1"],
        title: "OPENAI CREDITS EXHAUSTED",
        body: "OpenAI calls stopped. Add credits now.",
        timeoutMs: 5,
      }),
      new Promise<"unbounded">((resolve) =>
        setTimeout(() => resolve("unbounded"), 50)
      ),
    ]);

    expect(result).not.toBe("unbounded");
    expect(result).toMatchObject({ ok: false });
  });

  it("treats HTTP 200 without a provider message ID as not accepted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              recipients: 0,
              errors: ["All included subscriptions are not subscribed"],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
      )
    );

    await expect(
      sendOneSignalPush({
        recipientUserIds: ["user-1"],
        title: "OPENAI CREDITS EXHAUSTED",
        body: "OpenAI calls stopped. Add credits now.",
      })
    ).resolves.toMatchObject({ ok: false, status: 200 });
  });
});

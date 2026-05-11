import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendOneSignalPush } from "@/lib/notifications/onesignal";

describe("sendOneSignalPush", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("no-ops when env vars are missing", async () => {
    delete process.env.ONESIGNAL_APP_ID;
    delete process.env.ONESIGNAL_REST_API_KEY;

    const result = await sendOneSignalPush({
      playerIds: ["abc"],
      title: "Test",
      body: "Body",
      data: { type: "test" },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("no-ops when playerIds is empty", async () => {
    process.env.ONESIGNAL_APP_ID = "app-id";
    process.env.ONESIGNAL_REST_API_KEY = "api-key";

    await sendOneSignalPush({
      playerIds: [],
      title: "Test",
      body: "Body",
      data: {},
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls OneSignal REST API with correct payload", async () => {
    process.env.ONESIGNAL_APP_ID = "app-id-123";
    process.env.ONESIGNAL_REST_API_KEY = "rest-key-456";
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    await sendOneSignalPush({
      playerIds: ["player-1", "player-2"],
      title: "Sarah joined your crew",
      body: "Sarah needs a role.",
      data: { type: "member_joined", memberId: "uuid-abc" },
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, options] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://onesignal.com/api/v1/notifications");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Basic rest-key-456",
    });
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      app_id: "app-id-123",
      include_player_ids: ["player-1", "player-2"],
      headings: { en: "Sarah joined your crew" },
      contents: { en: "Sarah needs a role." },
      data: { type: "member_joined", memberId: "uuid-abc" },
    });
  });

  it("swallows fetch errors so the caller is not blocked", async () => {
    process.env.ONESIGNAL_APP_ID = "app-id";
    process.env.ONESIGNAL_REST_API_KEY = "api-key";
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down")
    );

    await expect(
      sendOneSignalPush({
        playerIds: ["abc"],
        title: "T",
        body: "B",
        data: {},
      })
    ).resolves.toBeUndefined();
  });

  it("logs but does not throw on non-ok response", async () => {
    process.env.ONESIGNAL_APP_ID = "app-id";
    process.env.ONESIGNAL_REST_API_KEY = "api-key";
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid auth",
    });

    await expect(
      sendOneSignalPush({
        playerIds: ["abc"],
        title: "T",
        body: "B",
        data: {},
      })
    ).resolves.toBeUndefined();
  });
});

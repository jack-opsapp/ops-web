import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsService,
  ANALYTICS_QUEUE_STORAGE_KEY,
} from "@/lib/analytics/analytics-service";
import { saveSetupStep } from "@/lib/analytics/setup-save-client";
import type { AnalyticsClientEvent } from "@/lib/analytics/analytics-types";

let telemetry: AnalyticsService;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  telemetry = new AnalyticsService({
    autoStart: false,
    environment: "production",
    storage: localStorage,
    sessionStorage,
  });
});
afterEach(() => {
  telemetry.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const events = (): AnalyticsClientEvent[] =>
  JSON.parse(localStorage.getItem(ANALYTICS_QUEUE_STORAGE_KEY) ?? "[]");
const options = () => ({
  step: "company" as const,
  data: { companyName: "Private business" },
  durationMs: 2500,
  getToken: async () => "secret-token",
  telemetry,
});

describe("setup save browser evidence", () => {
  it("records completion only after acknowledged persistence and sends the same session/attempt context", async () => {
    let payload: { analytics?: { sessionId: string; attemptId: string } } = {};
    const fetcher = vi.fn(async (_url, init) => {
      payload = JSON.parse(init.body);
      expect(events().map((event) => event.event_name)).toEqual([
        "setup_save_attempted",
      ]);
      return Response.json({ success: true });
    });
    expect(await saveSetupStep({ ...options(), fetcher })).toBe(true);
    const saved = events();
    expect(saved.map((event) => event.event_name)).toEqual([
      "setup_save_attempted",
      "setup_save_acknowledged",
      "setup_step_completed",
    ]);
    expect(payload.analytics?.sessionId).toBe(saved[0].session_id);
    expect(payload.analytics?.attemptId.replaceAll("-", "")).toBe(
      saved[0].properties.attempt_key
    );
    expect(JSON.stringify(saved)).not.toMatch(/Private business|secret-token/);
  });

  it.each([401, 403, 409, 500])(
    "records HTTP %s as rejected, without a false completion",
    async (status) => {
      const fetcher = vi.fn(async () =>
        Response.json(
          { error: "private@example.com secret backend detail" },
          { status }
        )
      );
      expect(await saveSetupStep({ ...options(), fetcher })).toBe(false);
      expect(events().at(-1)).toMatchObject({
        event_name: "setup_save_failed",
        properties: { outcome: "rejected", status_code: status },
      });
      expect(JSON.stringify(events())).not.toMatch(
        /setup_step_completed|private@example/
      );
    }
  );

  it("records a lost response as unconfirmed, not proof that the database save failed", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("private URL failed");
    });
    expect(await saveSetupStep({ ...options(), fetcher })).toBe(false);
    expect(events().at(-1)).toMatchObject({
      event_name: "setup_save_failed",
      properties: { outcome: "unconfirmed", reason: "network_or_timeout" },
    });
  });

  it.each([
    Response.json({ success: false }),
    new Response("not-json", { status: 200 }),
  ])(
    "does not count a malformed/unsuccessful acknowledgement as completion",
    async (response) => {
      expect(
        await saveSetupStep({ ...options(), fetcher: async () => response })
      ).toBe(false);
      expect(events().map((event) => event.event_name)).not.toContain(
        "setup_step_completed"
      );
    }
  );

  it("records missing authentication without sending a save request", async () => {
    const fetcher = vi.fn();
    expect(
      await saveSetupStep({ ...options(), getToken: async () => null, fetcher })
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(events().at(-1)).toMatchObject({
      properties: { outcome: "not_sent", reason: "authentication_unavailable" },
    });
  });

  it("uses a fresh attempt for a retry while keeping the same session", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true }));
    await saveSetupStep({ ...options(), fetcher });
    await saveSetupStep({ ...options(), fetcher });
    const attempts = events().filter(
      (event) => event.event_name === "setup_save_attempted"
    );
    expect(attempts[0].session_id).toBe(attempts[1].session_id);
    expect(attempts[0].properties.attempt_key).not.toBe(
      attempts[1].properties.attempt_key
    );
  });

  it("does not let failed browser instrumentation block a successful save", async () => {
    vi.spyOn(telemetry, "track").mockImplementation(() => {
      throw new Error("Telemetry unavailable");
    });
    const fetcher = vi.fn(async () => Response.json({ success: true }));
    expect(await saveSetupStep({ ...options(), fetcher })).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("unlocks a save when token refresh never settles", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn();
      const result = saveSetupStep({
        ...options(),
        getToken: () => new Promise(() => {}),
        fetcher,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await result).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
      expect(events().at(-1)).toMatchObject({
        properties: {
          outcome: "not_sent",
          reason: "authentication_unavailable",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  }, 1000);

  it.each([
    ["staging.opsapp.co", "production"],
    ["preview.vercel.app", "preview"],
    ["app.opsapp.co", "preview"],
    ["localhost", "production"],
  ])(
    "does not collect browser setup events on %s / %s",
    async (hostname, environment) => {
      telemetry.destroy();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", environment);
      vi.stubGlobal("window", {
        location: { hostname },
        removeEventListener: vi.fn(),
      });
      telemetry = new AnalyticsService({
        autoStart: false,
        storage: localStorage,
        sessionStorage,
      });
      expect(
        await saveSetupStep({
          ...options(),
          fetcher: async () => Response.json({ success: true }),
        })
      ).toBe(true);
      expect(events()).toEqual([]);
    }
  );

  it("collects production setup events on the canonical app host", async () => {
    telemetry.destroy();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    vi.stubGlobal("window", {
      location: { hostname: "app.opsapp.co" },
      removeEventListener: vi.fn(),
    });
    telemetry = new AnalyticsService({
      autoStart: false,
      storage: localStorage,
      sessionStorage,
    });
    expect(
      await saveSetupStep({
        ...options(),
        fetcher: async () => Response.json({ success: true }),
      })
    ).toBe(true);
    expect(events()).toHaveLength(3);
  });
});

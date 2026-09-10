import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdsEngineCron, type AdsEngineCronDependencies } from "@/app/api/cron/ads-engine/handler";

const SECRET = "cron-secret-with-at-least-32-characters-ok";

function deps(overrides: Partial<AdsEngineCronDependencies> = {}): AdsEngineCronDependencies {
  return {
    run: async () => ({ expired: 0, autoApplied: 0, autoFailed: 0, autoSkipped: 0, testsConcluded: 0, followUps: 0, verdicts: 0, disapproved: 0, pacing: 0, notified: 1, stalled: false, campaignsLive: true, rehearsal: false, google: "available" }),
    loadRuntime: () => ({ supabase: {} as never }),
    runWithControl: (async ({ work }: { work: () => Promise<unknown> }) => ({ status: "completed", value: await work() })) as never,
    ...overrides,
  };
}

const request = (auth?: string) =>
  new Request("http://localhost/api/cron/ads-engine", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => vi.stubEnv("CRON_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("ads-engine cron handler", () => {
  it("fails closed without a configured secret", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    const response = await handleAdsEngineCron(request(`Bearer short`), deps());
    expect(response.status).toBe(503);
  });

  it("answers 401 with no-store to a wrong bearer", async () => {
    const response = await handleAdsEngineCron(request("Bearer wrong"), deps());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("runs the tick under the durable workload lease and returns its result", async () => {
    let key = "";
    const response = await handleAdsEngineCron(
      request(`Bearer ${SECRET}`),
      deps({
        runWithControl: (async ({ workloadKey, leaseSeconds, work }: { workloadKey: string; leaseSeconds: number; work: () => Promise<unknown> }) => {
          key = `${workloadKey}:${leaseSeconds}`;
          return { status: "completed", value: await work() };
        }) as never,
      })
    );
    expect(response.status).toBe(200);
    expect(key).toBe("ads-engine:360");
    await expect(response.json()).resolves.toMatchObject({ notified: 1, campaignsLive: true });
  });

  it("is an idempotent no-op while another tick holds the lease, and fails closed when control is unavailable", async () => {
    const held = await handleAdsEngineCron(request(`Bearer ${SECRET}`), deps({ runWithControl: (async () => ({ status: "skipped", reason: "lease_held" })) as never }));
    expect(held.status).toBe(200);
    await expect(held.json()).resolves.toEqual({ ok: true, ran: false, reason: "already_running" });
    const down = await handleAdsEngineCron(request(`Bearer ${SECRET}`), deps({ runWithControl: (async () => ({ status: "skipped", reason: "control_unavailable" })) as never }));
    expect(down.status).toBe(503);
  });

  it("answers 500 when the tick throws", async () => {
    const response = await handleAdsEngineCron(request(`Bearer ${SECRET}`), deps({ run: async () => { throw new Error("boom"); } }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: "ADS_ENGINE_WORKER_FAILED" });
  });
});

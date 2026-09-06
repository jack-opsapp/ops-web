import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  handleSocialPublishCron,
  type SocialPublishCronDependencies,
} from "@/app/api/cron/social-publish/handler";
import type {
  CronWorkloadControlResult,
  RunWithCronWorkloadControlOptions,
} from "@/lib/api/services/cron-workload-control-service";
import { InstagramConnectionError } from "@/lib/social/instagram-connection-service";

const CRON_SECRET = "cron-secret-with-at-least-32-characters";

const IDLE_SUMMARY = {
  claimToken: "claim-1",
  claimed: 0,
  recoveryNotifications: 0,
  published: 0,
  retryScheduled: 0,
  failed: 0,
  persistenceFailed: 0,
  results: [],
};

function request(secret?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/social-publish", {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

type RunWithControl = SocialPublishCronDependencies["runWithControl"];

/**
 * The durable guard runs the leased work immediately, exactly like the real
 * service does once a lease is acquired.
 */
function acquiredLease(): RunWithControl {
  return vi.fn(
    async <T>({ work }: RunWithCronWorkloadControlOptions<T>) =>
      ({
        status: "completed",
        value: await work({
          ownerToken: "owner-1",
          fenceToken: 1,
          globalFenceToken: 1,
          expiresAt: new Date(Date.now() + 360_000).toISOString(),
          signal: new AbortController().signal,
        }),
      }) satisfies CronWorkloadControlResult<T>
  ) as unknown as RunWithControl;
}

function skippedLease(
  result: Exclude<CronWorkloadControlResult<never>, { status: "completed" }>
): RunWithControl {
  return vi.fn(async () => result) as unknown as RunWithControl;
}

const supabase = { rpc: vi.fn() };

function dependencies(
  overrides: Partial<SocialPublishCronDependencies> = {}
): SocialPublishCronDependencies {
  return {
    runBatch: vi.fn().mockResolvedValue(IDLE_SUMMARY),
    loadRuntime: () => ({ supabase }),
    runWithControl: acquiredLease(),
    ...overrides,
  };
}

describe("social publish cron", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when CRON_SECRET is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const deps = dependencies();
    const response = await handleSocialPublishCron(request(), deps);

    expect(response.status).toBe(503);
    expect(deps.runBatch).not.toHaveBeenCalled();
    expect(deps.runWithControl).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token before touching the lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies();
    const response = await handleSocialPublishCron(request("wrong"), deps);

    expect(response.status).toBe(401);
    expect(deps.runBatch).not.toHaveBeenCalled();
    expect(deps.runWithControl).not.toHaveBeenCalled();
  });

  it("runs the batch inside the shared durable lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies();
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 0,
      recovery_notifications: 0,
      published: 0,
      retry_scheduled: 0,
      failed: 0,
      persistence_failed: 0,
      results: [],
    });
    expect(deps.runWithControl).toHaveBeenCalledTimes(1);
    expect(deps.runWithControl).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        workloadKey: "social-publish",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
    expect(deps.runBatch).toHaveBeenCalledWith({ limit: 2 });
  });

  it("treats an unconnected Instagram account as a successful idle run", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runBatch: vi
        .fn()
        .mockRejectedValue(
          new InstagramConnectionError(
            "INSTAGRAM_NOT_CONNECTED",
            "Instagram is not connected",
            false
          )
        ),
    });
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    // The acquired-lease double only reports "completed" when the leased work
    // resolves, so a 200 here proves the idle state completes the lease as a
    // success instead of surfacing as a workload failure.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: "instagram_not_connected",
      claimed: 0,
      recovery_notifications: 0,
      published: 0,
      retry_scheduled: 0,
      failed: 0,
      persistence_failed: 0,
      results: [],
    });
  });

  it("skips with 200 already_running while another run holds the lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runWithControl: skippedLease({ status: "skipped", reason: "lease_held" }),
    });
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("fails closed with 503 while the database pressure circuit is open", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runWithControl: skippedLease({
        status: "skipped",
        reason: "circuit_open",
      }),
    });
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      ran: false,
      reason: "circuit_open",
    });
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when workload control is unreachable", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runWithControl: skippedLease({
        status: "skipped",
        reason: "control_unavailable",
        error: new Error("database password was visible here"),
      }),
    });
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      ran: false,
      reason: "control_unavailable",
    });
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("returns 500 without exposing an internal worker error", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runBatch: vi
        .fn()
        .mockRejectedValue(new Error("database password was visible here")),
    });
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "SOCIAL_PUBLISH_WORKER_FAILED",
      error: "Social publish worker failed",
    });
  });

  it("returns 500 without exposing a runtime configuration error", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      loadRuntime: () => {
        throw new Error(
          "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
        );
      },
    });
    const response = await handleSocialPublishCron(request(CRON_SECRET), deps);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "SOCIAL_PUBLISH_WORKER_FAILED",
      error: "Social publish worker failed",
    });
    expect(deps.runWithControl).not.toHaveBeenCalled();
    expect(deps.runBatch).not.toHaveBeenCalled();
  });
});

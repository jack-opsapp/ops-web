import { NextRequest } from "next/server";
import { createSocialPublishCronHandler } from "@/lib/social/publish-cron-handler";
import { InstagramConnectionError } from "@/lib/social/instagram-connection-service";

const CRON_SECRET = "cron-secret-with-at-least-32-characters";

function request(secret?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/social-publish", {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("social publish cron", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when CRON_SECRET is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const runBatch = vi.fn();
    const response = await createSocialPublishCronHandler({ runBatch })(
      request()
    );

    expect(response.status).toBe(503);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const runBatch = vi.fn();
    const response = await createSocialPublishCronHandler({ runBatch })(
      request("wrong")
    );

    expect(response.status).toBe(401);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("returns a stable no-work summary", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const runBatch = vi.fn().mockResolvedValue({
      claimToken: "claim-1",
      claimed: 0,
      recoveryNotifications: 0,
      published: 0,
      retryScheduled: 0,
      failed: 0,
      persistenceFailed: 0,
      results: [],
    });
    const response = await createSocialPublishCronHandler({ runBatch })(
      request(CRON_SECRET)
    );

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
    expect(runBatch).toHaveBeenCalledWith({ limit: 2 });
  });

  it("treats an unconnected Instagram account as an idle cron state", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const response = await createSocialPublishCronHandler({
      runBatch: vi.fn().mockRejectedValue(
        new InstagramConnectionError(
          "INSTAGRAM_NOT_CONNECTED",
          "Instagram is not connected",
          false
        )
      ),
    })(request(CRON_SECRET));

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

  it("returns 500 without exposing an internal worker error", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const response = await createSocialPublishCronHandler({
      runBatch: vi
        .fn()
        .mockRejectedValue(new Error("database password was visible here")),
    })(request(CRON_SECRET));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "SOCIAL_PUBLISH_WORKER_FAILED",
      error: "Social publish worker failed",
    });
  });
});

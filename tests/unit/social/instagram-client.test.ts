import {
  InstagramGraphClient,
  createInstagramClientFromEnv,
} from "@/lib/social/instagram-client";
import { InstagramGraphError } from "@/lib/social/instagram-errors";
import type { RenderedSocialAsset } from "@/lib/social/types";

const TOKEN = "meta-access-token-that-must-never-appear-in-errors";
const baseConfig = {
  origin: "https://graph.facebook.com",
  apiVersion: "v23.0",
  userId: "17841400000000000",
  accessToken: TOKEN,
};

function asset(order: number): RenderedSocialAsset {
  return {
    order,
    url: `https://cdn.opsapp.ca/social/slide-${order}.jpg`,
    alt_text: `Slide ${order} about crew coordination.`,
    sha256: `sha-${order}`,
    width: 1080,
    height: 1350,
    bytes: 1000,
    content_type: "image/jpeg",
    storage_key: `social-media/post/render/slide-${order}.jpg`,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchSequence(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const response = queue.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  });
}

const quota = () =>
  jsonResponse({
    data: [{ quota_usage: 2, config: { quota_total: 50, quota_duration: 86400 } }],
  });

const persistStage = async () => undefined;

describe("Instagram Graph publishing client", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails before a request when required credentials or version are missing", () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "");
    vi.stubEnv("INSTAGRAM_USER_ID", "");
    vi.stubEnv("INSTAGRAM_API_VERSION", "");

    expect(() => createInstagramClientFromEnv()).toThrow(/instagram_access_token/i);
  });

  it("uses configurable API origin and version", async () => {
    const fetcher = fetchSequence(quota(), jsonResponse({ id: "container-1" }), jsonResponse({ status_code: "FINISHED" }), jsonResponse({ id: "media-1" }), jsonResponse({ id: "media-1", permalink: "https://instagram.com/p/one" }));
    const client = new InstagramGraphClient(
      { ...baseConfig, origin: "https://graph.instagram.com", apiVersion: "v24.0" },
      { fetcher, sleep: vi.fn(), maxPollAttempts: 2, pollDelayMs: 1 }
    );

    await client.publish({
      format: "single",
      assets: [asset(1)],
      caption: "One plan. Fewer repeat calls.",
      onStage: persistStage,
    });
    expect(fetcher.mock.calls[0][0].toString()).toContain(
      "https://graph.instagram.com/v24.0/17841400000000000/content_publishing_limit"
    );
  });

  it("checks quota, creates, polls, publishes, and reads a single-image permalink", async () => {
    const fetcher = fetchSequence(
      quota(),
      jsonResponse({ id: "container-1" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "media-1" }),
      jsonResponse({ id: "media-1", permalink: "https://www.instagram.com/p/one/" })
    );
    const client = new InstagramGraphClient(baseConfig, {
      fetcher,
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    const result = await client.publish({
      format: "single",
      assets: [asset(1)],
      caption: "One plan. Fewer repeat calls.",
      onStage: persistStage,
    });

    expect(result).toEqual({
      mediaId: "media-1",
      permalink: "https://www.instagram.com/p/one/",
      quota: { used: 2, total: 50, durationSeconds: 86400 },
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
    const createCall = fetcher.mock.calls[1];
    expect(createCall[0].toString()).toBe(
      "https://graph.facebook.com/v23.0/17841400000000000/media"
    );
    const createBody = createCall[1]?.body as URLSearchParams;
    expect(createBody.get("image_url")).toBe(asset(1).url);
    expect(createBody.get("caption")).toBe("One plan. Fewer repeat calls.");
    expect(createBody.get("alt_text")).toBe(asset(1).alt_text);
    expect(createBody.get("access_token")).toBe(TOKEN);
    expect(createCall[0].toString()).not.toContain(TOKEN);
  });

  it("creates and readies children before publishing a carousel parent", async () => {
    const fetcher = fetchSequence(
      quota(),
      jsonResponse({ id: "child-1" }),
      jsonResponse({ id: "child-2" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "carousel-1" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "media-carousel" }),
      jsonResponse({ id: "media-carousel", permalink: "https://www.instagram.com/p/carousel/" })
    );
    const client = new InstagramGraphClient(baseConfig, {
      fetcher,
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    const result = await client.publish({
      format: "carousel",
      assets: [asset(1), asset(2)],
      caption: "Two moves. One operating plan.",
      onStage: persistStage,
    });

    expect(result.mediaId).toBe("media-carousel");
    const firstChildBody = fetcher.mock.calls[1][1]?.body as URLSearchParams;
    const secondChildBody = fetcher.mock.calls[2][1]?.body as URLSearchParams;
    const parentBody = fetcher.mock.calls[5][1]?.body as URLSearchParams;
    expect(firstChildBody.get("is_carousel_item")).toBe("true");
    expect(secondChildBody.get("is_carousel_item")).toBe("true");
    expect(firstChildBody.get("alt_text")).toBe(asset(1).alt_text);
    expect(secondChildBody.get("alt_text")).toBe(asset(2).alt_text);
    expect(parentBody.get("media_type")).toBe("CAROUSEL");
    expect(parentBody.get("children")).toBe("child-1,child-2");
  });

  it("enforces JPEG assets and carousel size before quota lookup", async () => {
    const fetcher = vi.fn();
    const client = new InstagramGraphClient(baseConfig, { fetcher, sleep: vi.fn() });

    await expect(
      client.publish({
        format: "carousel",
        assets: [asset(1)],
        caption: "Invalid",
        onStage: persistStage,
      })
    ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
    await expect(
      client.publish({
        format: "single",
        assets: [{ ...asset(1), content_type: "image/png" as "image/jpeg" }],
        caption: "Invalid",
        onStage: persistStage,
      })
    ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops before container creation when publishing quota is exhausted", async () => {
    const fetcher = fetchSequence(
      jsonResponse({ data: [{ quota_usage: 50, config: { quota_total: 50, quota_duration: 86400 } }] })
    );
    const client = new InstagramGraphClient(baseConfig, { fetcher, sleep: vi.fn() });

    await expect(
      client.publish({
        format: "single",
        assets: [asset(1)],
        caption: "No capacity",
        onStage: persistStage,
      })
    ).rejects.toMatchObject({ code: "PUBLISHING_QUOTA_EXHAUSTED", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never publishes a container that did not finish processing", async () => {
    const fetcher = fetchSequence(
      quota(),
      jsonResponse({ id: "container-1" }),
      jsonResponse({ status_code: "IN_PROGRESS" }),
      jsonResponse({ status_code: "IN_PROGRESS" })
    );
    const client = new InstagramGraphClient(baseConfig, {
      fetcher,
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    await expect(
      client.publish({
        format: "single",
        assets: [asset(1)],
        caption: "Wait",
        onStage: persistStage,
      })
    ).rejects.toMatchObject({ code: "CONTAINER_TIMEOUT", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    [429, { error: { message: "Rate limited", code: 4 } }],
    [503, { error: { message: "Service unavailable", code: 2 } }],
    [400, { error: { message: "Temporary Meta fault", code: 1, is_transient: true } }],
  ])("classifies retryable Graph failure %s", async (status, body) => {
    const client = new InstagramGraphClient(baseConfig, {
      fetcher: fetchSequence(jsonResponse(body, status)),
      sleep: vi.fn(),
    });

    await expect(client.getPublishingQuota()).rejects.toMatchObject({ retryable: true });
  });

  it("classifies permanent Graph errors without leaking the access token", async () => {
    const client = new InstagramGraphClient(baseConfig, {
      fetcher: fetchSequence(
        jsonResponse({ error: { message: `Invalid token ${TOKEN}`, code: 190 } }, 400)
      ),
      sleep: vi.fn(),
    });

    let caught: unknown;
    try {
      await client.getPublishingQuota();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InstagramGraphError);
    expect(caught).toMatchObject({ retryable: false, graphCode: 190 });
    expect((caught as Error).message).not.toContain(TOKEN);
  });

  it("records the durable boundary around media_publish", async () => {
    const fetcher = fetchSequence(
      quota(),
      jsonResponse({ id: "container-1" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "media-1" }),
      jsonResponse({ id: "media-1" })
    );
    const onStage = vi.fn().mockResolvedValue(undefined);
    const client = new InstagramGraphClient(baseConfig, {
      fetcher,
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    await client.publish({
      format: "single",
      assets: [asset(1)],
      caption: "One plan. Fewer repeat calls.",
      onStage,
    });

    expect(onStage.mock.calls.map(([event]) => event)).toEqual([
      { stage: "container_ready", containerId: "container-1" },
      { stage: "publish_requested", containerId: "container-1" },
      { stage: "publish_succeeded", containerId: "container-1", mediaId: "media-1" },
    ]);
  });

  it("does not call media_publish when the pre-publish boundary cannot be persisted", async () => {
    const fetcher = fetchSequence(
      quota(),
      jsonResponse({ id: "container-1" }),
      jsonResponse({ status_code: "FINISHED" })
    );
    const client = new InstagramGraphClient(baseConfig, {
      fetcher,
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    await expect(
      client.publish({
        format: "single",
        assets: [asset(1)],
        caption: "One plan.",
        onStage: vi.fn().mockRejectedValue(new Error("database unavailable")),
      })
    ).rejects.toMatchObject({ code: "PUBLISH_STAGE_NOT_PERSISTED", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("quarantines a successful publish when its media identity cannot be persisted", async () => {
    const fetcher = fetchSequence(
      quota(),
      jsonResponse({ id: "container-1" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "media-1" })
    );
    const onStage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("database unavailable"));
    const client = new InstagramGraphClient(baseConfig, {
      fetcher,
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    await expect(
      client.publish({
        format: "single",
        assets: [asset(1)],
        caption: "One plan.",
        onStage,
      })
    ).rejects.toMatchObject({ code: "PUBLISHED_ACK_NOT_PERSISTED", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("treats a successful media_publish response without an id as reconciliation-required", async () => {
    const client = new InstagramGraphClient(baseConfig, {
      fetcher: fetchSequence(
        quota(),
        jsonResponse({ id: "container-1" }),
        jsonResponse({ status_code: "FINISHED" }),
        jsonResponse({})
      ),
      sleep: vi.fn(),
      maxPollAttempts: 2,
      pollDelayMs: 1,
    });

    await expect(
      client.publish({
        format: "single",
        assets: [asset(1)],
        caption: "One plan.",
        onStage: persistStage,
      })
    ).rejects.toMatchObject({ code: "PUBLISH_OUTCOME_UNKNOWN", retryable: false });
  });

  it("refuses to contact Instagram without a durable publish ledger", async () => {
    const fetcher = vi.fn();
    const client = new InstagramGraphClient(baseConfig, { fetcher });

    await expect(
      client.publish({
        format: "single",
        assets: [asset(1)],
        caption: "One plan.",
        onStage: undefined as never,
      })
    ).rejects.toMatchObject({ code: "PUBLISH_LEDGER_REQUIRED", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds every Graph request with a timeout signal", async () => {
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return quota();
    });
    const client = new InstagramGraphClient(baseConfig, { fetcher, requestTimeoutMs: 250 });

    await client.getPublishingQuota();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

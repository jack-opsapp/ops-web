import { InstagramGraphError } from "@/lib/social/instagram-errors";
import {
  publishClaimedSocialPost,
  runSocialPublisherBatch,
  type SocialPublisherDependencies,
} from "@/lib/social/publisher";
import { socialPostFixture } from "../helpers/social-fixtures";

function dependencies(
  overrides: Partial<SocialPublisherDependencies> = {}
): SocialPublisherDependencies {
  return {
    now: () => new Date("2026-09-01T20:00:00.000Z"),
    createClaimToken: () => "0749af28-5852-4728-a36c-4f222a3e4b92",
    repository: {
      claimDue: vi.fn().mockResolvedValue([socialPostFixture()]),
      claimById: vi.fn().mockResolvedValue(socialPostFixture()),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    instagram: {
      publish: vi.fn().mockResolvedValue({
        mediaId: "180000000000001",
        permalink: "https://www.instagram.com/p/published/",
        quota: { used: 3, total: 50, durationSeconds: 86400 },
      }),
    },
    resolveReviewNotification: vi.fn().mockResolvedValue(undefined),
    notifyPublished: vi.fn().mockResolvedValue(undefined),
    notifyFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("durable Instagram publisher", () => {
  it("publishes a claimed post and persists the Meta identity with claim ownership", async () => {
    const deps = dependencies();
    const post = socialPostFixture();
    const result = await publishClaimedSocialPost(post, deps);

    expect(result).toMatchObject({ postId: post.id, outcome: "published", mediaId: "180000000000001" });
    expect(deps.instagram.publish).toHaveBeenCalledWith({
      format: post.post_format,
      assets: post.rendered_assets,
      caption: post.caption,
    });
    expect(deps.repository.markPublished).toHaveBeenCalledWith(
      post.id,
      post.claim_token,
      expect.objectContaining({
        mediaId: "180000000000001",
        permalink: "https://www.instagram.com/p/published/",
        publishedAt: "2026-09-01T20:00:00.000Z",
      })
    );
    expect(deps.resolveReviewNotification).toHaveBeenCalledWith(post.id);
    expect(deps.notifyPublished).toHaveBeenCalledWith(
      expect.objectContaining({ id: post.id }),
      "https://www.instagram.com/p/published/"
    );
  });

  it("schedules bounded 5, 15, and 60 minute retries", async () => {
    for (const [attemptCount, expected] of [
      [1, "2026-09-01T20:05:00.000Z"],
      [2, "2026-09-01T20:15:00.000Z"],
      [3, "2026-09-01T21:00:00.000Z"],
    ] as const) {
      const post = socialPostFixture({ attempt_count: attemptCount, max_attempts: 4 });
      const deps = dependencies({
        instagram: {
          publish: vi
            .fn()
            .mockRejectedValue(new InstagramGraphError("META_BUSY", "Meta is busy", true)),
        },
      });

      const result = await publishClaimedSocialPost(post, deps);
      expect(result.outcome).toBe("retry_scheduled");
      expect(deps.repository.markFailed).toHaveBeenCalledWith(
        post.id,
        post.claim_token,
        expect.objectContaining({ retryable: true, nextAttemptAt: expected })
      );
      expect(deps.notifyFailed).not.toHaveBeenCalled();
    }
  });

  it("turns permanent and exhausted failures into an operator action", async () => {
    const permanent = socialPostFixture();
    const exhausted = socialPostFixture({ attempt_count: 3, max_attempts: 3 });

    for (const [post, error] of [
      [permanent, new InstagramGraphError("BAD_TOKEN", "Token expired", false)],
      [exhausted, new InstagramGraphError("META_BUSY", "Meta is busy", true)],
    ] as const) {
      const deps = dependencies({ instagram: { publish: vi.fn().mockRejectedValue(error) } });
      const result = await publishClaimedSocialPost(post, deps);

      expect(result.outcome).toBe("failed");
      expect(deps.repository.markFailed).toHaveBeenCalledWith(
        post.id,
        post.claim_token,
        expect.objectContaining({ retryable: false, nextAttemptAt: null })
      );
      expect(deps.notifyFailed).toHaveBeenCalledWith(post, expect.stringContaining(error.message));
    }
  });

  it("does not downgrade a successful Meta publish when the database acknowledgement fails", async () => {
    const deps = dependencies({
      repository: {
        ...dependencies().repository,
        markPublished: vi.fn().mockRejectedValue(new Error("database unavailable")),
      },
    });

    const result = await publishClaimedSocialPost(socialPostFixture(), deps);

    expect(result.outcome).toBe("persistence_failed");
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
    expect(deps.instagram.publish).toHaveBeenCalledTimes(1);
  });

  it("isolates rows within a batch and reports exact outcomes", async () => {
    const first = socialPostFixture();
    const second = socialPostFixture({
      id: "1e48bfba-27aa-4c85-afb8-23dc12c10024",
      claim_token: first.claim_token,
    });
    const deps = dependencies({
      repository: {
        ...dependencies().repository,
        claimDue: vi.fn().mockResolvedValue([first, second]),
      },
      instagram: {
        publish: vi
          .fn()
          .mockResolvedValueOnce({
            mediaId: "media-1",
            permalink: "https://instagram.com/p/one",
            quota: { used: 1, total: 50, durationSeconds: 86400 },
          })
          .mockRejectedValueOnce(new InstagramGraphError("META_BUSY", "Meta is busy", true)),
      },
    });

    const summary = await runSocialPublisherBatch(deps, { limit: 2 });

    expect(summary).toMatchObject({ claimed: 2, published: 1, retryScheduled: 1, failed: 0 });
    expect(summary.results).toHaveLength(2);
  });

  it("makes duplicate worker delivery harmless through the atomic claim", async () => {
    const claimDue = vi
      .fn()
      .mockResolvedValueOnce([socialPostFixture()])
      .mockResolvedValueOnce([]);
    const deps = dependencies({
      repository: { ...dependencies().repository, claimDue },
    });

    const first = await runSocialPublisherBatch(deps, { limit: 2 });
    const duplicate = await runSocialPublisherBatch(deps, { limit: 2 });

    expect(first.published).toBe(1);
    expect(duplicate.claimed).toBe(0);
    expect(deps.instagram.publish).toHaveBeenCalledTimes(1);
  });
});

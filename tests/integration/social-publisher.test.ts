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
      claimRecoveryNotifications: vi.fn().mockResolvedValue([]),
      claimById: vi.fn().mockResolvedValue(socialPostFixture()),
      recordPublishStage: vi.fn().mockResolvedValue(undefined),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    ensureInstagramConnection: vi.fn().mockResolvedValue(undefined),
    instagram: {
      publish: vi.fn().mockResolvedValue({
        mediaId: "180000000000001",
        permalink: "https://www.instagram.com/p/published/",
        quota: { used: 3, total: 50, durationSeconds: 86400 },
      }),
    },
    resolveReviewNotification: vi.fn().mockResolvedValue(undefined),
    notifyPublished: vi.fn().mockResolvedValue(undefined),
    notifyRecovery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("durable Instagram publisher", () => {
  it("publishes a claimed post and persists the Meta identity with claim ownership", async () => {
    const deps = dependencies();
    const post = socialPostFixture();
    const result = await publishClaimedSocialPost(post, deps);

    expect(result).toMatchObject({
      postId: post.id,
      outcome: "published",
      mediaId: "180000000000001",
    });
    expect(deps.instagram.publish).toHaveBeenCalledWith({
      format: post.post_format,
      assets: post.rendered_assets,
      caption: post.caption,
      onStage: expect.any(Function),
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

  it("persists each external publish stage under the active claim", async () => {
    const deps = dependencies({
      instagram: {
        publish: vi.fn().mockImplementation(async ({ onStage }) => {
          await onStage?.({
            stage: "container_ready",
            containerId: "container-1",
          });
          await onStage?.({
            stage: "publish_requested",
            containerId: "container-1",
          });
          await onStage?.({
            stage: "publish_succeeded",
            containerId: "container-1",
            mediaId: "media-1",
          });
          return {
            mediaId: "media-1",
            permalink: null,
            quota: { used: 3, total: 50, durationSeconds: 86400 },
          };
        }),
      },
    });
    const post = socialPostFixture();

    await publishClaimedSocialPost(post, deps);

    expect(deps.repository.recordPublishStage).toHaveBeenCalledTimes(3);
    expect(deps.repository.recordPublishStage).toHaveBeenLastCalledWith(
      post.id,
      post.claim_token,
      expect.objectContaining({
        stage: "publish_succeeded",
        mediaId: "media-1",
      })
    );
  });

  it("schedules bounded 5, 15, and 60 minute retries", async () => {
    for (const [attemptCount, expected] of [
      [1, "2026-09-01T20:05:00.000Z"],
      [2, "2026-09-01T20:15:00.000Z"],
      [3, "2026-09-01T21:00:00.000Z"],
    ] as const) {
      const post = socialPostFixture({
        attempt_count: attemptCount,
        max_attempts: 4,
      });
      const deps = dependencies({
        instagram: {
          publish: vi
            .fn()
            .mockRejectedValue(
              new InstagramGraphError("META_BUSY", "Meta is busy", true)
            ),
        },
      });

      const result = await publishClaimedSocialPost(post, deps);
      expect(result.outcome).toBe("retry_scheduled");
      expect(deps.repository.markFailed).toHaveBeenCalledWith(
        post.id,
        post.claim_token,
        expect.objectContaining({ retryable: true, nextAttemptAt: expected })
      );
    }
  });

  it("turns permanent and exhausted failures into durable outbox state", async () => {
    const permanent = socialPostFixture();
    const exhausted = socialPostFixture({ attempt_count: 3, max_attempts: 3 });

    for (const [post, error] of [
      [permanent, new InstagramGraphError("BAD_TOKEN", "Token expired", false)],
      [exhausted, new InstagramGraphError("META_BUSY", "Meta is busy", true)],
    ] as const) {
      const deps = dependencies({
        instagram: { publish: vi.fn().mockRejectedValue(error) },
      });
      const result = await publishClaimedSocialPost(post, deps);

      expect(result.outcome).toBe("failed");
      expect(deps.repository.markFailed).toHaveBeenCalledWith(
        post.id,
        post.claim_token,
        expect.objectContaining({ retryable: false, nextAttemptAt: null })
      );
    }
  });

  it("does not downgrade a successful Meta publish when the database acknowledgement fails", async () => {
    const deps = dependencies({
      repository: {
        ...dependencies().repository,
        markPublished: vi
          .fn()
          .mockRejectedValue(new Error("database unavailable")),
      },
    });

    const result = await publishClaimedSocialPost(socialPostFixture(), deps);

    expect(result.outcome).toBe("persistence_failed");
    expect(deps.repository.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        code: "PUBLISHED_ACK_NOT_PERSISTED",
        retryable: false,
      })
    );
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
          .mockRejectedValueOnce(
            new InstagramGraphError("META_BUSY", "Meta is busy", true)
          ),
      },
    });

    const summary = await runSocialPublisherBatch(deps, { limit: 2 });

    expect(summary).toMatchObject({
      claimed: 2,
      published: 1,
      retryScheduled: 1,
      failed: 0,
    });
    expect(summary.results).toHaveLength(2);
  });

  it("validates and refreshes the connection before claiming any launch", async () => {
    const deps = dependencies({
      repository: {
        ...dependencies().repository,
        claimDue: vi.fn().mockResolvedValue([]),
      },
    });

    await runSocialPublisherBatch(deps, { limit: 2 });

    expect(deps.ensureInstagramConnection).toHaveBeenCalledTimes(1);
    expect(deps.repository.claimDue).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(deps.ensureInstagramConnection).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(deps.repository.claimDue).mock.invocationCallOrder[0]
    );
  });

  it("never claims a post when Instagram is disconnected", async () => {
    const deps = dependencies({
      ensureInstagramConnection: vi
        .fn()
        .mockRejectedValue(new Error("Instagram is not connected")),
    });

    await expect(runSocialPublisherBatch(deps, { limit: 2 })).rejects.toThrow(
      /not connected/i
    );
    expect(deps.repository.claimDue).not.toHaveBeenCalled();
    expect(deps.instagram.publish).not.toHaveBeenCalled();
  });

  it("delivers database-recovered failures through the durable notification outbox", async () => {
    const recovered = socialPostFixture({
      status: "failed",
      publish_stage: "idle",
      claim_token: null,
      claim_expires_at: null,
      last_error_code: "PUBLISH_ATTEMPTS_EXHAUSTED",
      last_error_message:
        "The final publishing lease expired before Instagram was called.",
      last_error_retryable: false,
      recovery_notification_pending: true,
      recovery_notification_claim_token: "0749af28-5852-4728-a36c-4f222a3e4b92",
      recovery_notification_claim_expires_at: "2026-09-01T20:03:00.000Z",
    });
    const deps = dependencies({
      repository: {
        ...dependencies().repository,
        claimDue: vi.fn().mockResolvedValue([]),
        claimRecoveryNotifications: vi.fn().mockResolvedValue([recovered]),
      },
    });

    const summary = await runSocialPublisherBatch(deps, { limit: 2 });

    expect(deps.notifyRecovery).toHaveBeenCalledWith(
      recovered,
      recovered.recovery_notification_claim_token
    );
    expect(deps.instagram.publish).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      claimed: 0,
      recoveryNotifications: 1,
      published: 0,
      persistenceFailed: 0,
    });
    expect(summary.results).toContainEqual({
      postId: recovered.id,
      outcome: "recovery_notified",
      code: "PUBLISH_ATTEMPTS_EXHAUSTED",
    });
  });

  it("keeps a recovery notification leased for replay when delivery is not persisted", async () => {
    const recovered = socialPostFixture({
      status: "failed",
      publish_stage: "reconciliation_required",
      claim_token: null,
      claim_expires_at: null,
      last_error_code: "PUBLISH_OUTCOME_UNKNOWN",
      recovery_notification_pending: true,
      recovery_notification_claim_token: "0749af28-5852-4728-a36c-4f222a3e4b92",
      recovery_notification_claim_expires_at: "2026-09-01T20:03:00.000Z",
    });
    const deps = dependencies({
      repository: {
        ...dependencies().repository,
        claimDue: vi.fn().mockResolvedValue([]),
        claimRecoveryNotifications: vi.fn().mockResolvedValue([recovered]),
      },
      notifyRecovery: vi
        .fn()
        .mockRejectedValue(new Error("notification database unavailable")),
    });

    const summary = await runSocialPublisherBatch(deps, { limit: 2 });

    expect(summary.recoveryNotifications).toBe(0);
    expect(summary.persistenceFailed).toBe(1);
    expect(summary.results).toContainEqual({
      postId: recovered.id,
      outcome: "persistence_failed",
      code: "RECOVERY_NOTIFICATION_NOT_PERSISTED",
    });
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

import "server-only";

import { randomUUID } from "node:crypto";
import {
  createInstagramClientFromEnv,
  type InstagramPublishResult,
  type InstagramPublishStageEvent,
} from "./instagram-client";
import { InstagramGraphError } from "./instagram-errors";
import {
  createPublisherSocialRepository,
  type PublisherSocialRepository,
} from "./publisher-repository";
import {
  createSocialPublishedNotification,
  createSocialRecoveryNotification,
  resolveSocialReviewNotification,
} from "./notification-service";
import type { SocialAuditEvent, SocialPostRecord } from "./types";

const CLAIM_TTL_SECONDS = 180;
const RETRY_MINUTES = [5, 15, 60] as const;

interface InstagramPublisher {
  publish(input: {
    format: SocialPostRecord["post_format"];
    assets: SocialPostRecord["rendered_assets"];
    caption: string;
    onStage: (event: InstagramPublishStageEvent) => Promise<void>;
  }): Promise<InstagramPublishResult>;
}

export interface SocialPublisherDependencies {
  now: () => Date;
  createClaimToken: () => string;
  repository: PublisherSocialRepository;
  instagram: InstagramPublisher;
  resolveReviewNotification: (postId: string) => Promise<void>;
  notifyPublished: (post: SocialPostRecord, permalink: string | null) => Promise<void>;
  notifyRecovery: (post: SocialPostRecord, recoveryClaimToken: string | null) => Promise<void>;
}

function defaultDependencies(): SocialPublisherDependencies {
  return {
    now: () => new Date(),
    createClaimToken: randomUUID,
    repository: createPublisherSocialRepository(),
    instagram: createInstagramClientFromEnv(),
    resolveReviewNotification: resolveSocialReviewNotification,
    notifyPublished: createSocialPublishedNotification,
    notifyRecovery: createSocialRecoveryNotification,
  };
}

export type SocialPublishOutcome =
  | { postId: string; outcome: "published"; mediaId: string; permalink: string | null }
  | { postId: string; outcome: "retry_scheduled"; nextAttemptAt: string }
  | { postId: string; outcome: "failed"; code: string }
  | { postId: string; outcome: "recovery_notified"; code: string }
  | { postId: string; outcome: "persistence_failed"; code: string };

function safeFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (error instanceof InstagramGraphError) {
    return {
      code: error.code,
      message: error.message.slice(0, 500),
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    };
  }
  return {
    code: "INSTAGRAM_PUBLISH_FAILED",
    message: error instanceof Error ? error.message.slice(0, 500) : "Instagram publish failed",
    retryable: true,
  };
}

async function bestEffort(label: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`[social] ${label}:`, error instanceof Error ? error.message : "unknown error");
  }
}

export async function publishClaimedSocialPost(
  post: SocialPostRecord,
  dependencies: SocialPublisherDependencies = defaultDependencies()
): Promise<SocialPublishOutcome> {
  if (post.status !== "publishing" || !post.claim_token) {
    return { postId: post.id, outcome: "persistence_failed", code: "CLAIM_NOT_OWNED" };
  }

  let published: InstagramPublishResult;
  try {
    published = await dependencies.instagram.publish({
      format: post.post_format,
      assets: post.rendered_assets,
      caption: post.caption,
      onStage: (event) =>
        dependencies.repository.recordPublishStage(post.id, post.claim_token, event),
    });
  } catch (error) {
    const failure = safeFailure(error);
    const canRetry = failure.retryable && post.attempt_count < post.max_attempts;
    const defaultRetryMs =
      RETRY_MINUTES[Math.min(Math.max(post.attempt_count - 1, 0), RETRY_MINUTES.length - 1)] *
      60_000;
    const retryMs = failure.retryAfterMs ?? defaultRetryMs;
    const nextAttemptAt = canRetry
      ? new Date(dependencies.now().getTime() + retryMs).toISOString()
      : null;
    const failedAt = dependencies.now().toISOString();
    const auditLog: SocialAuditEvent[] = [
      ...post.audit_log,
      {
        at: failedAt,
        actor: "system:publisher",
        from: "publishing",
        to: "failed",
        event: canRetry ? "publish_retry_scheduled" : "publish_failed",
        metadata: {
          code: failure.code,
          attempt: post.attempt_count,
          next_attempt_at: nextAttemptAt,
        },
      },
    ];

    try {
      await dependencies.repository.markFailed(post.id, post.claim_token, {
        code: failure.code,
        message: failure.message,
        retryable: canRetry,
        nextAttemptAt,
        auditLog,
      });
    } catch {
      return {
        postId: post.id,
        outcome: "persistence_failed",
        code: "FAILURE_STATE_NOT_PERSISTED",
      };
    }

    if (nextAttemptAt) {
      return { postId: post.id, outcome: "retry_scheduled", nextAttemptAt };
    }
    return { postId: post.id, outcome: "failed", code: failure.code };
  }

  const publishedAt = dependencies.now().toISOString();
  const auditLog: SocialAuditEvent[] = [
    ...post.audit_log,
    {
      at: publishedAt,
      actor: "system:publisher",
      from: "publishing",
      to: "published",
      event: "published",
      metadata: {
        instagram_media_id: published.mediaId,
        quota_used: published.quota.used,
        quota_total: published.quota.total,
      },
    },
  ];

  try {
    await dependencies.repository.markPublished(post.id, post.claim_token, {
      mediaId: published.mediaId,
      permalink: published.permalink,
      publishedAt,
      auditLog,
    });
  } catch {
    await bestEffort("Post-publish reconciliation state failed", () =>
      dependencies.repository.markFailed(post.id, post.claim_token, {
        code: "PUBLISHED_ACK_NOT_PERSISTED",
        message:
          "Instagram accepted the post, but OPS could not persist the acknowledgement. Reconcile before retrying.",
        retryable: false,
        nextAttemptAt: null,
        auditLog: [
          ...auditLog,
          {
            at: dependencies.now().toISOString(),
            actor: "system:publisher",
            from: "publishing",
            to: "failed",
            event: "publish_reconciliation_required",
            metadata: { code: "PUBLISHED_ACK_NOT_PERSISTED" },
          },
        ],
      })
    );
    return {
      postId: post.id,
      outcome: "persistence_failed",
      code: "PUBLISHED_ACK_NOT_PERSISTED",
    };
  }

  const publishedPost: SocialPostRecord = {
    ...post,
    status: "published",
    publish_stage: "publish_succeeded",
    instagram_media_id: published.mediaId,
    instagram_permalink: published.permalink,
    published_at: publishedAt,
    audit_log: auditLog,
  };
  await bestEffort("Review notification resolution failed", () =>
    dependencies.resolveReviewNotification(post.id)
  );
  await bestEffort("Published notification failed", () =>
    dependencies.notifyPublished(publishedPost, published.permalink)
  );
  return {
    postId: post.id,
    outcome: "published",
    mediaId: published.mediaId,
    permalink: published.permalink,
  };
}

export interface SocialPublisherBatchSummary {
  claimToken: string;
  claimed: number;
  recoveryNotifications: number;
  published: number;
  retryScheduled: number;
  failed: number;
  persistenceFailed: number;
  results: SocialPublishOutcome[];
}

export async function runSocialPublisherBatch(
  dependencies: SocialPublisherDependencies = defaultDependencies(),
  options: { limit?: number } = {}
): Promise<SocialPublisherBatchSummary> {
  const claimToken = dependencies.createClaimToken();
  const limit = Math.max(1, Math.min(options.limit ?? 2, 5));
  const posts = await dependencies.repository.claimDue(claimToken, limit, CLAIM_TTL_SECONDS);
  const results: SocialPublishOutcome[] = [];

  for (const post of posts) {
    try {
      results.push(await publishClaimedSocialPost(post, dependencies));
    } catch {
      results.push({
        postId: post.id,
        outcome: "persistence_failed",
        code: "UNHANDLED_PUBLISHER_ERROR",
      });
    }
  }

  const recoveryPosts = await dependencies.repository.claimRecoveryNotifications(
    claimToken,
    10,
    CLAIM_TTL_SECONDS
  );
  for (const post of recoveryPosts) {
    try {
      await dependencies.notifyRecovery(post, post.recovery_notification_claim_token);
      results.push({
        postId: post.id,
        outcome: "recovery_notified",
        code: post.last_error_code ?? "SOCIAL_RECOVERY_REQUIRED",
      });
    } catch {
      results.push({
        postId: post.id,
        outcome: "persistence_failed",
        code: "RECOVERY_NOTIFICATION_NOT_PERSISTED",
      });
    }
  }

  return {
    claimToken,
    claimed: posts.length,
    recoveryNotifications: results.filter(
      (result) => result.outcome === "recovery_notified"
    ).length,
    published: results.filter((result) => result.outcome === "published").length,
    retryScheduled: results.filter((result) => result.outcome === "retry_scheduled").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    persistenceFailed: results.filter((result) => result.outcome === "persistence_failed").length,
    results,
  };
}

export async function publishSocialPostNow(
  postId: string,
  dependencies: SocialPublisherDependencies = defaultDependencies()
): Promise<SocialPublishOutcome | null> {
  const claimToken = dependencies.createClaimToken();
  const post = await dependencies.repository.claimById(postId, claimToken, CLAIM_TTL_SECONDS);
  return post ? publishClaimedSocialPost(post, dependencies) : null;
}

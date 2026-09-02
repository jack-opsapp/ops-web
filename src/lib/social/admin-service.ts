import "server-only";

import { socialContentSchema, socialSubmissionSchema, type SocialContent } from "./contract";
import {
  createAdminSocialRepository,
  type AdminSocialRepository,
} from "./admin-repository";
import { createSocialReviewNotification, resolveSocialReviewNotification } from "./notification-service";
import { publishSocialPostNow, type SocialPublishOutcome } from "./publisher";
import { renderSocialPost, SOCIAL_RENDER_VERSION } from "./render/render-social-post";
import { selectSocialTemplate } from "./template-selector";
import type { RenderedSocialAsset, SocialPostRecord, SocialPostStatus } from "./types";
import { validateSocialVoice } from "./voice-profile";

const REVIEW_MS = 10 * 60 * 1000;

export class AdminSocialError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AdminSocialError";
  }
}

export interface AdminSocialServiceDependencies {
  now: () => Date;
  repository: AdminSocialRepository;
  render: (input: Parameters<typeof renderSocialPost>[0]) => Promise<RenderedSocialAsset[]>;
  publishNow: (postId: string) => Promise<SocialPublishOutcome | null>;
  notifyReview: (post: SocialPostRecord) => Promise<void>;
  resolveReview: (postId: string) => Promise<void>;
}

function defaultDependencies(): AdminSocialServiceDependencies {
  return {
    now: () => new Date(),
    repository: createAdminSocialRepository(),
    render: (input) => renderSocialPost(input),
    publishNow: (postId) => publishSocialPostNow(postId),
    notifyReview: createSocialReviewNotification,
    resolveReview: resolveSocialReviewNotification,
  };
}

function actor(email: string): string {
  return `admin:${email.toLowerCase()}`;
}

async function requiredPost(
  postId: string,
  repository: AdminSocialRepository
): Promise<SocialPostRecord> {
  const post = await repository.getById(postId);
  if (!post) throw new AdminSocialError("SOCIAL_POST_NOT_FOUND", "Social post was not found", 404);
  return post;
}

function requireStatus(post: SocialPostRecord, allowed: SocialPostStatus[]): void {
  if (!allowed.includes(post.status)) {
    throw new AdminSocialError(
      "SOCIAL_POST_IMMUTABLE",
      `Social post cannot be changed from ${post.status}`,
      409
    );
  }
}

async function bestEffort(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch {
    // Notification delivery never changes the durable publishing state.
  }
}

export async function listSocialPosts(
  input: { statuses: SocialPostStatus[]; limit: number },
  dependencies: AdminSocialServiceDependencies = defaultDependencies()
): Promise<SocialPostRecord[]> {
  return dependencies.repository.list(input);
}

export async function editSocialPostCopy(
  postId: string,
  contentInput: SocialContent,
  adminEmail: string,
  dependencies: AdminSocialServiceDependencies = defaultDependencies()
): Promise<{ post: SocialPostRecord }> {
  const post = await requiredPost(postId, dependencies.repository);
  requireStatus(post, ["review", "failed"]);
  const parsedContent = socialContentSchema.safeParse(contentInput);
  if (!parsedContent.success) {
    throw new AdminSocialError(
      "INVALID_SOCIAL_COPY",
      "Edited social copy is invalid",
      400,
      parsedContent.error.issues
    );
  }
  const voice = validateSocialVoice(parsedContent.data);
  if (!voice.ok) {
    throw new AdminSocialError(
      "SOCIAL_VOICE_REJECTED",
      "Edited copy does not meet the OPS voice contract",
      422,
      voice.issues
    );
  }

  const reconstructed = socialSubmissionSchema.safeParse({
    contract_version: post.contract_version,
    source: {
      type: post.source_type,
      ...(post.source_id ? { id: post.source_id } : {}),
      ...(post.source_url ? { url: post.source_url } : {}),
    },
    content: parsedContent.data,
    preferences: post.agent_preferences,
  });
  if (!reconstructed.success) {
    throw new AdminSocialError(
      "SOCIAL_POST_CORRUPT",
      "Stored social source data can no longer be rendered safely",
      500
    );
  }

  const recentPosts = await dependencies.repository.listRecentPosts(12);
  const selection = selectSocialTemplate({
    submission: reconstructed.data,
    recentPosts,
    idempotencyKey: `${post.idempotency_key}:edit:${post.updated_at}`,
  });
  const now = dependencies.now();
  const adminActor = actor(adminEmail);
  const renderVersion = `${SOCIAL_RENDER_VERSION}-edit-${now.getTime()}`;
  const editStartedAudit = [
    ...post.audit_log,
    {
      at: now.toISOString(),
      actor: adminActor,
      from: post.status,
      to: "rendering" as const,
      event: "edit_started",
      metadata: { previous_assets: post.rendered_assets },
    },
  ];
  const renderingPost = await dependencies.repository.beginEdit(post.id, {
    content: parsedContent.data,
    caption: parsedContent.data.caption,
    alt_text: parsedContent.data.alt_text,
    story_type: selection.storyType,
    visual_treatment: selection.visualTreatment,
    post_format: selection.postFormat,
    selection_metadata: selection as unknown as Record<string, unknown>,
    selector_version: selection.selectorVersion,
    render_version: renderVersion,
    audit_log: editStartedAudit,
    updated_by: adminActor,
  });

  try {
    const assets = await dependencies.render({
      postId: post.id,
      submission: reconstructed.data,
      selection,
      renderVersion,
    });
    const renderedAt = dependencies.now();
    const reviewAt = new Date(renderedAt.getTime() + REVIEW_MS).toISOString();
    const completed = await dependencies.repository.completeEdit(post.id, {
      rendered_assets: assets,
      rendered_at: renderedAt.toISOString(),
      publish_after: reviewAt,
      updated_by: adminActor,
      audit_log: [
        ...editStartedAudit,
        {
          at: renderedAt.toISOString(),
          actor: adminActor,
          from: "rendering",
          to: "review",
          event: "edit_rendered",
          metadata: { asset_count: assets.length },
        },
      ],
    });
    await bestEffort(() => dependencies.notifyReview(completed));
    return { post: completed };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Social edit render failed";
    await dependencies.repository.failEdit(post.id, {
      message,
      actor: adminActor,
      priorAssets: post.rendered_assets,
      auditLog: [
        ...editStartedAudit,
        {
          at: dependencies.now().toISOString(),
          actor: adminActor,
          from: "rendering",
          to: "failed",
          event: "edit_render_failed",
        },
      ],
    });
    throw new AdminSocialError("SOCIAL_EDIT_RENDER_FAILED", message, 500);
  }
}

export async function cancelSocialPost(
  postId: string,
  adminEmail: string,
  dependencies: AdminSocialServiceDependencies = defaultDependencies()
): Promise<{ post: SocialPostRecord }> {
  const post = await requiredPost(postId, dependencies.repository);
  requireStatus(post, ["review", "failed"]);
  const at = dependencies.now().toISOString();
  const adminActor = actor(adminEmail);
  const cancelled = await dependencies.repository.cancel(post.id, {
    cancelled_at: at,
    updated_by: adminActor,
    audit_log: [
      ...post.audit_log,
      { at, actor: adminActor, from: post.status, to: "cancelled", event: "cancelled" },
    ],
  });
  await bestEffort(() => dependencies.resolveReview(post.id));
  return { post: cancelled };
}

export async function publishSocialPostImmediately(
  postId: string,
  adminEmail: string,
  dependencies: AdminSocialServiceDependencies = defaultDependencies()
): Promise<SocialPublishOutcome> {
  const post = await requiredPost(postId, dependencies.repository);
  requireStatus(post, ["review", "failed"]);
  const at = dependencies.now().toISOString();
  const adminActor = actor(adminEmail);
  await dependencies.repository.recordPublishRequest(post.id, {
    updated_by: adminActor,
    audit_log: [
      ...post.audit_log,
      { at, actor: adminActor, from: post.status, to: post.status, event: "publish_now_requested" },
    ],
  });
  const outcome = await dependencies.publishNow(post.id);
  if (!outcome) {
    throw new AdminSocialError(
      "SOCIAL_POST_CLAIM_CONFLICT",
      "Social post is already being published or changed",
      409
    );
  }
  return outcome;
}

export async function retrySocialPostImmediately(
  postId: string,
  adminEmail: string,
  dependencies: AdminSocialServiceDependencies = defaultDependencies()
): Promise<SocialPublishOutcome> {
  const post = await requiredPost(postId, dependencies.repository);
  requireStatus(post, ["failed"]);
  const at = dependencies.now().toISOString();
  const adminActor = actor(adminEmail);
  await dependencies.repository.resetForRetry(post.id, {
    attempt_count: 0,
    max_attempts: 3,
    publish_after: at,
    updated_by: adminActor,
    audit_log: [
      ...post.audit_log,
      { at, actor: adminActor, from: "failed", to: "review", event: "retry_requested" },
    ],
  });
  const outcome = await dependencies.publishNow(post.id);
  if (!outcome) {
    throw new AdminSocialError(
      "SOCIAL_POST_CLAIM_CONFLICT",
      "Social post could not be claimed for retry",
      409
    );
  }
  return outcome;
}

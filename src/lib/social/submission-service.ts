import "server-only";

import { randomUUID } from "node:crypto";
import type { SocialSubmission } from "./contract";
import {
  createSubmissionSocialRepository,
  type SubmissionSocialRepository,
} from "./repository";
import { renderSocialPost, SOCIAL_RENDER_VERSION } from "./render/render-social-post";
import { selectSocialTemplate } from "./template-selector";
import type { RenderedSocialAsset, SocialPostRecord } from "./types";
import {
  SOCIAL_VOICE_REFERENCE_VERSION,
  validateSocialVoice,
} from "./voice-profile";
import { createSocialReviewNotification } from "./notification-service";

const MINIMUM_REVIEW_MS = 10 * 60 * 1000;
const SOCIAL_ACTOR = "agent:social";

export class SocialSubmissionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "SocialSubmissionError";
  }
}

export interface SocialSubmissionServiceDependencies {
  now: () => Date;
  createId: () => string;
  repository: SubmissionSocialRepository;
  render: (
    input: Parameters<typeof renderSocialPost>[0]
  ) => Promise<RenderedSocialAsset[]>;
  notifyReview: (post: SocialPostRecord) => Promise<void>;
}

function defaultDependencies(): SocialSubmissionServiceDependencies {
  return {
    now: () => new Date(),
    createId: randomUUID,
    repository: createSubmissionSocialRepository(),
    render: (input) => renderSocialPost(input),
    notifyReview: createSocialReviewNotification,
  };
}

function canonicalBlogUrl(slug: string): string {
  return `https://opsapp.ca/blog/${slug}`;
}

async function enrichAuthoritativeSource(
  submission: SocialSubmission,
  repository: SubmissionSocialRepository
): Promise<SocialSubmission> {
  if (submission.source.type !== "blog") return submission;

  const source = await repository.findLiveBlogSource(submission.source.id!);
  if (!source?.is_live) {
    throw new SocialSubmissionError(
      "BLOG_SOURCE_NOT_LIVE",
      "The referenced blog post does not exist or is not live",
      422
    );
  }

  const slides = submission.content.slides.map((slide, index) =>
    index === 0 && !slide.image_url && source.thumbnail_url
      ? { ...slide, image_url: source.thumbnail_url }
      : slide
  );

  return {
    ...submission,
    source: {
      ...submission.source,
      url: canonicalBlogUrl(source.slug),
      published_at: source.published_at ?? submission.source.published_at,
    },
    content: { ...submission.content, slides },
  };
}

export async function submitSocialPost(
  {
    idempotencyKey,
    submission,
  }: { idempotencyKey: string; submission: SocialSubmission },
  dependencies: SocialSubmissionServiceDependencies = defaultDependencies()
): Promise<{ created: boolean; post: SocialPostRecord }> {
  const replay = await dependencies.repository.findByIdempotencyKey(idempotencyKey);
  if (replay) return { created: false, post: replay };

  const enriched = await enrichAuthoritativeSource(submission, dependencies.repository);
  const voice = validateSocialVoice(enriched.content);
  if (!voice.ok) {
    throw new SocialSubmissionError(
      "SOCIAL_VOICE_REJECTED",
      "The social package does not meet the OPS voice contract",
      422,
      voice.issues
    );
  }

  const recentPosts = await dependencies.repository.listRecentPosts(12);
  const selection = selectSocialTemplate({
    submission: enriched,
    recentPosts,
    idempotencyKey,
  });
  const now = dependencies.now();
  const minimumPublishAt = new Date(now.getTime() + MINIMUM_REVIEW_MS);
  const requestedPublishAt = enriched.publish_at ? new Date(enriched.publish_at) : null;
  const publishAt =
    requestedPublishAt && requestedPublishAt > minimumPublishAt
      ? requestedPublishAt
      : minimumPublishAt;
  const postId = dependencies.createId();
  const initialAudit = [
    {
      at: now.toISOString(),
      actor: SOCIAL_ACTOR,
      from: null,
      to: "rendering" as const,
      event: "submitted",
      metadata: {
        selector_version: selection.selectorVersion,
        voice_reference_version: SOCIAL_VOICE_REFERENCE_VERSION,
      },
    },
  ];

  const reservation = await dependencies.repository.reserveRenderingPost({
    id: postId,
    idempotency_key: idempotencyKey,
    contract_version: enriched.contract_version,
    source_type: enriched.source.type,
    source_id: enriched.source.id ?? null,
    source_url: enriched.source.url ?? null,
    story_type: selection.storyType,
    visual_treatment: selection.visualTreatment,
    post_format: selection.postFormat,
    content: enriched.content,
    caption: enriched.content.caption,
    alt_text: enriched.content.alt_text,
    agent_preferences: enriched.preferences ?? {},
    selection_metadata: selection as unknown as Record<string, unknown>,
    rendered_assets: [],
    status: "rendering",
    publish_after: publishAt.toISOString(),
    requested_publish_at: requestedPublishAt?.toISOString() ?? null,
    render_version: SOCIAL_RENDER_VERSION,
    selector_version: selection.selectorVersion,
    voice_reference_version: SOCIAL_VOICE_REFERENCE_VERSION,
    created_by: SOCIAL_ACTOR,
    updated_by: SOCIAL_ACTOR,
    audit_log: initialAudit,
  });
  if (!reservation.created) return reservation;

  try {
    const renderedAssets = await dependencies.render({
      postId: reservation.post.id,
      submission: enriched,
      selection,
      renderVersion: SOCIAL_RENDER_VERSION,
    });
    const renderedAt = dependencies.now().toISOString();
    const reviewPost = await dependencies.repository.markReview(reservation.post.id, {
      rendered_assets: renderedAssets,
      rendered_at: renderedAt,
      publish_after: publishAt.toISOString(),
      updated_by: SOCIAL_ACTOR,
      audit_log: [
        ...initialAudit,
        {
          at: renderedAt,
          actor: "system:renderer",
          from: "rendering",
          to: "review",
          event: "rendered",
          metadata: { asset_count: renderedAssets.length },
        },
      ],
    });

    try {
      await dependencies.notifyReview(reviewPost);
    } catch (error) {
      console.error(
        "[social] Review notification failed after post entered review:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
    return { created: true, post: reviewPost };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Social render failed";
    await dependencies.repository.markFailed(reservation.post.id, {
      code: "RENDER_FAILED",
      message,
      retryable: false,
      actor: "system:renderer",
    });
    throw new SocialSubmissionError("RENDER_FAILED", message, 500);
  }
}

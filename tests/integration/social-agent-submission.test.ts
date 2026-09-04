import { NextRequest } from "next/server";
import type { SocialSubmission } from "@/lib/social/contract";
import { createSocialSubmissionHandler } from "@/lib/social/agent-submission-handler";
import {
  SocialSubmissionError,
  submitSocialPost,
  type SocialSubmissionServiceDependencies,
} from "@/lib/social/submission-service";
import type { SocialPostRecord } from "@/lib/social/types";
import { secureTokenEquals } from "@/lib/social/auth";

const SECRET = "social-automation-secret-with-at-least-32-characters";

function payload(): SocialSubmission {
  return {
    contract_version: "2026-09-01",
    source: {
      type: "blog",
      id: "9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30",
      url: "https://incorrect.example.com/not-canonical",
    },
    content: {
      title: "The two-hour leak in your week",
      hook: "Your crew is waiting on an answer you already gave once.",
      angle: "Show the cost of repeated coordination and the practical fix.",
      caption:
        "Every repeated answer costs attention. Put the plan where the crew works.",
      alt_text: "A field note about repeated crew coordination.",
      slides: [
        {
          headline: "The two-hour leak in your week",
          body: "Every repeated answer costs attention, time, and margin.",
        },
      ],
    },
  };
}

function postRecord(
  overrides: Partial<SocialPostRecord> = {}
): SocialPostRecord {
  const now = new Date("2026-09-01T20:00:00.000Z").toISOString();
  return {
    id: "d88f06bd-985a-4c66-a609-1e85f9dc6803",
    idempotency_key: "blog-9d5fd8b8-v1",
    contract_version: "2026-09-01",
    source_type: "blog",
    source_id: payload().source.id ?? null,
    source_url: "https://opsapp.co/journal/the-two-hour-leak",
    story_type: "blog_signal",
    visual_treatment: "operator_brief",
    post_format: "single",
    content: payload().content,
    caption: payload().content.caption,
    alt_text: payload().content.alt_text,
    agent_preferences: {},
    selection_metadata: {},
    rendered_assets: [],
    status: "rendering",
    publish_after: new Date("2026-09-01T20:10:00.000Z").toISOString(),
    requested_publish_at: null,
    rendered_at: null,
    published_at: null,
    cancelled_at: null,
    attempt_count: 0,
    max_attempts: 4,
    next_attempt_at: null,
    last_attempt_at: null,
    claim_token: null,
    claim_expires_at: null,
    publish_stage: "idle",
    publish_attempts: [],
    last_error_code: null,
    last_error_message: null,
    last_error_retryable: null,
    instagram_media_id: null,
    instagram_permalink: null,
    render_version: "social-render-2026-09-01-v1",
    selector_version: "feed-cycle-2026-09-01",
    voice_reference_version: "ops-social-parr-2026-09-01",
    created_by: "agent:social",
    updated_by: "agent:social",
    audit_log: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function request(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/internal/social/posts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("scheduled-agent route boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the automation secret is absent", async () => {
    vi.stubEnv("SOCIAL_AUTOMATION_SECRET", "");
    const handler = createSocialSubmissionHandler({ submit: vi.fn() });
    const response = await handler(request(payload()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SOCIAL_AUTH_NOT_CONFIGURED",
    });
  });

  it("rejects invalid bearer tokens and missing idempotency keys", async () => {
    vi.stubEnv("SOCIAL_AUTOMATION_SECRET", SECRET);
    const handler = createSocialSubmissionHandler({ submit: vi.fn() });
    const unauthorized = await handler(
      request(payload(), {
        authorization: "Bearer wrong-token",
        "idempotency-key": "blog-1-v1",
      })
    );
    const missingKey = await handler(
      request(payload(), { authorization: `Bearer ${SECRET}` })
    );

    expect(unauthorized.status).toBe(401);
    expect(missingKey.status).toBe(400);
    expect(secureTokenEquals(SECRET, SECRET)).toBe(true);
    expect(secureTokenEquals(SECRET, `${SECRET}x`)).toBe(false);
  });

  it("returns field-level contract errors before submission", async () => {
    vi.stubEnv("SOCIAL_AUTOMATION_SECRET", SECRET);
    const submit = vi.fn();
    const handler = createSocialSubmissionHandler({ submit });
    const response = await handler(
      request(
        { ...payload(), content: { ...payload().content, hook: "" } },
        { authorization: `Bearer ${SECRET}`, "idempotency-key": "blog-1-v1" }
      )
    );

    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_SOCIAL_PACKAGE",
    });
  });

  it("returns 201 for creation and 200 for an idempotent replay", async () => {
    vi.stubEnv("SOCIAL_AUTOMATION_SECRET", SECRET);
    const createdPost = postRecord({
      status: "review",
      rendered_assets: [
        {
          order: 1,
          url: "https://cdn.opsapp.ca/social/slide-1.jpg",
          alt_text: payload().content.alt_text,
          sha256: "abc",
          width: 1080,
          height: 1350,
          bytes: 123,
          content_type: "image/jpeg",
          storage_key: "social-media/post/render/slide-01.jpg",
        },
      ],
    });
    const results = [
      { created: true, post: createdPost },
      { created: false, post: createdPost },
    ];
    const handler = createSocialSubmissionHandler({
      submit: vi.fn().mockImplementation(async () => results.shift()!),
    });
    const headers = {
      authorization: `Bearer ${SECRET}`,
      "idempotency-key": "blog-1-v1",
    };
    const created = await handler(request(payload(), headers));
    const replayed = await handler(request(payload(), headers));

    expect(created.status).toBe(201);
    expect(replayed.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      created: true,
      post_id: createdPost.id,
      status: "review",
      admin_url: `/admin/social?post=${createdPost.id}`,
    });
  });
});

describe("scheduled-agent submission orchestration", () => {
  function serviceDependencies(
    overrides: Partial<SocialSubmissionServiceDependencies> = {}
  ): SocialSubmissionServiceDependencies {
    const reserved = postRecord();
    return {
      now: () => new Date("2026-09-01T20:00:00.000Z"),
      createId: () => reserved.id,
      repository: {
        findByIdempotencyKey: vi.fn().mockResolvedValue(null),
        findLiveBlogSource: vi.fn().mockResolvedValue({
          id: payload().source.id!,
          title: "The canonical article title",
          slug: "the-two-hour-leak",
          thumbnail_url: "https://images.opsapp.ca/blog/two-hour-leak.jpg",
          published_at: "2026-09-01T18:00:00.000Z",
          is_live: true,
        }),
        listRecentPosts: vi.fn().mockResolvedValue([]),
        reserveRenderingPost: vi
          .fn()
          .mockResolvedValue({ created: true, post: reserved }),
        markReview: vi
          .fn()
          .mockImplementation(async (_id, updates) =>
            postRecord({ ...updates, status: "review" })
          ),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      render: vi.fn().mockResolvedValue([
        {
          order: 1,
          url: "https://cdn.opsapp.ca/social/slide-1.jpg",
          alt_text: payload().content.alt_text,
          sha256: "abc",
          width: 1080,
          height: 1350,
          bytes: 123,
          content_type: "image/jpeg",
          storage_key: "social-media/post/render/slide-01.jpg",
        },
      ]),
      notifyReview: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("verifies and enriches a live blog before selection and rendering", async () => {
    const deps = serviceDependencies();
    const result = await submitSocialPost(
      { idempotencyKey: "blog-9d5fd8b8-v1", submission: payload() },
      deps
    );

    expect(result.created).toBe(true);
    expect(deps.repository.reserveRenderingPost).toHaveBeenCalledWith(
      expect.objectContaining({
        source_url: "https://opsapp.co/journal/the-two-hour-leak",
        content: expect.objectContaining({
          slides: [
            expect.objectContaining({
              image_url: "https://images.opsapp.ca/blog/two-hour-leak.jpg",
            }),
          ],
        }),
        voice_reference_version: "ops-social-parr-2026-09-01",
      })
    );
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(deps.repository.markReview).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        publish_after: "2026-09-01T20:10:00.000Z",
        rendered_at: "2026-09-01T20:00:00.000Z",
      })
    );
    expect(deps.notifyReview).toHaveBeenCalledWith(
      expect.objectContaining({ status: "review" })
    );
  });

  it("returns the original post before source lookup or rendering on replay", async () => {
    const original = postRecord({ status: "review" });
    const deps = serviceDependencies({
      repository: {
        ...serviceDependencies().repository,
        findByIdempotencyKey: vi.fn().mockResolvedValue(original),
      },
    });

    const result = await submitSocialPost(
      { idempotencyKey: original.idempotency_key, submission: payload() },
      deps
    );

    expect(result).toEqual({ created: false, post: original });
    expect(deps.repository.findLiveBlogSource).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-live blog source", async () => {
    const deps = serviceDependencies();
    vi.mocked(deps.repository.findLiveBlogSource).mockResolvedValue(null);

    await expect(
      submitSocialPost(
        { idempotencyKey: "missing-blog", submission: payload() },
        deps
      )
    ).rejects.toMatchObject({ code: "BLOG_SOURCE_NOT_LIVE", status: 422 });
  });

  it("rejects voice violations with exact issue paths", async () => {
    const deps = serviceDependencies();
    const bad = payload();
    bad.content.caption = "A revolutionary platform for contractors 🚀";

    await expect(
      submitSocialPost({ idempotencyKey: "bad-voice", submission: bad }, deps)
    ).rejects.toMatchObject({ code: "SOCIAL_VOICE_REJECTED", status: 422 });
    expect(deps.repository.reserveRenderingPost).not.toHaveBeenCalled();
  });

  it("marks a reserved row failed when rendering fails", async () => {
    const deps = serviceDependencies({
      render: vi.fn().mockRejectedValue(new Error("render exploded")),
    });

    await expect(
      submitSocialPost(
        { idempotencyKey: "render-failure", submission: payload() },
        deps
      )
    ).rejects.toBeInstanceOf(SocialSubmissionError);
    expect(deps.repository.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "RENDER_FAILED", retryable: false })
    );
  });

  it("honors a later requested publication time without shortening the veto", async () => {
    const deps = serviceDependencies();
    const later = payload();
    later.publish_at = "2026-09-01T23:00:00.000Z";

    await submitSocialPost(
      { idempotencyKey: "later", submission: later },
      deps
    );
    expect(deps.repository.markReview).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ publish_after: later.publish_at })
    );
  });

  it("starts the ten-minute veto only after rendering finishes", async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-09-01T20:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-09-01T20:04:00.000Z"));
    const deps = serviceDependencies({ now });

    await submitSocialPost(
      { idempotencyKey: "slow-render", submission: payload() },
      deps
    );

    expect(deps.repository.markReview).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ publish_after: "2026-09-01T20:14:00.000Z" })
    );
  });
});

import { NextRequest, NextResponse } from "next/server";
import type { SocialContent } from "@/lib/social/contract";
import {
  createAdminSocialPostActionHandler,
  type AdminSocialPostActionHandlerDependencies,
} from "@/app/api/admin/social/posts/[id]/route";
import {
  createAdminSocialPostsListHandler,
  type AdminSocialPostsListHandlerDependencies,
} from "@/app/api/admin/social/posts/route";
import {
  cancelSocialPost,
  editSocialPostCopy,
  publishSocialPostImmediately,
  retrySocialPostImmediately,
  type AdminSocialServiceDependencies,
} from "@/lib/social/admin-service";
import { socialPostFixture } from "../helpers/social-fixtures";

const USER = { email: "operator@opsapp.ca", uid: "firebase-admin-1" };
const POST_ID = socialPostFixture().id;

function request(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("admin social route boundary", () => {
  it("runs the admin gate before listing queue rows", async () => {
    const dependencies: AdminSocialPostsListHandlerDependencies = {
      authenticate: vi.fn().mockRejectedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 })),
      list: vi.fn(),
    };
    const response = await createAdminSocialPostsListHandler(dependencies)(
      request("GET", "http://localhost/api/admin/social/posts")
    );

    expect(response.status).toBe(401);
    expect(dependencies.list).not.toHaveBeenCalled();
  });

  it("passes bounded status filters to the list service", async () => {
    const posts = [socialPostFixture({ status: "review" })];
    const dependencies: AdminSocialPostsListHandlerDependencies = {
      authenticate: vi.fn().mockResolvedValue(USER),
      list: vi.fn().mockResolvedValue(posts),
    };
    const response = await createAdminSocialPostsListHandler(dependencies)(
      request("GET", "http://localhost/api/admin/social/posts?status=review,failed&limit=25")
    );

    expect(response.status).toBe(200);
    expect(dependencies.list).toHaveBeenCalledWith({ statuses: ["review", "failed"], limit: 25 });
    await expect(response.json()).resolves.toEqual({ posts });
  });

  it("rejects unknown actions and invalid structured edits", async () => {
    const dependencies: AdminSocialPostActionHandlerDependencies = {
      authenticate: vi.fn().mockResolvedValue(USER),
      edit: vi.fn(),
      cancel: vi.fn(),
      publishNow: vi.fn(),
      retryNow: vi.fn(),
    };
    const handler = createAdminSocialPostActionHandler(dependencies);
    const context = { params: Promise.resolve({ id: POST_ID }) };
    const unknown = await handler(
      request("PATCH", `http://localhost/api/admin/social/posts/${POST_ID}`, { action: "explode" }),
      context
    );
    const invalidEdit = await handler(
      request("PATCH", `http://localhost/api/admin/social/posts/${POST_ID}`, {
        action: "edit",
        content: { title: "Missing everything else" },
      }),
      context
    );

    expect(unknown.status).toBe(400);
    expect(invalidEdit.status).toBe(400);
    expect(dependencies.edit).not.toHaveBeenCalled();
  });

  it.each(["cancel", "publish_now", "retry"] as const)(
    "routes %s with the authenticated admin identity",
    async (action) => {
      const dependencies: AdminSocialPostActionHandlerDependencies = {
        authenticate: vi.fn().mockResolvedValue(USER),
        edit: vi.fn(),
        cancel: vi.fn().mockResolvedValue({ post: socialPostFixture({ status: "cancelled" }) }),
        publishNow: vi.fn().mockResolvedValue({ outcome: "published", postId: POST_ID, mediaId: "m1", permalink: null }),
        retryNow: vi.fn().mockResolvedValue({ outcome: "retry_scheduled", postId: POST_ID, nextAttemptAt: "later" }),
      };
      const response = await createAdminSocialPostActionHandler(dependencies)(
        request("PATCH", `http://localhost/api/admin/social/posts/${POST_ID}`, { action }),
        { params: Promise.resolve({ id: POST_ID }) }
      );

      expect(response.status).toBe(200);
      const target =
        action === "cancel"
          ? dependencies.cancel
          : action === "publish_now"
            ? dependencies.publishNow
            : dependencies.retryNow;
      expect(target).toHaveBeenCalledWith(POST_ID, "operator@opsapp.ca");
    }
  );
});

describe("admin social mutation service", () => {
  function serviceDependencies(
    overrides: Partial<AdminSocialServiceDependencies> = {}
  ): AdminSocialServiceDependencies {
    const review = socialPostFixture({ status: "review", claim_token: null, claim_expires_at: null });
    return {
      now: () => new Date("2026-09-01T20:00:00.000Z"),
      repository: {
        list: vi.fn().mockResolvedValue([review]),
        getById: vi.fn().mockResolvedValue(review),
        listRecentPosts: vi.fn().mockResolvedValue([]),
        beginEdit: vi.fn().mockImplementation(async (_id, update) => ({
          ...review,
          ...update,
          status: "rendering",
        })),
        completeEdit: vi.fn().mockImplementation(async (_id, update) => ({
          ...review,
          ...update,
          status: "review",
        })),
        failEdit: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockImplementation(async (_id, update) => ({
          ...review,
          ...update,
          status: "cancelled",
        })),
        recordPublishRequest: vi.fn().mockResolvedValue(undefined),
        resetForRetry: vi.fn().mockImplementation(async () => ({
          ...review,
          status: "review",
          attempt_count: 0,
        })),
      },
      render: vi.fn().mockResolvedValue(review.rendered_assets),
      publishNow: vi.fn().mockResolvedValue({
        postId: review.id,
        outcome: "published",
        mediaId: "media-1",
        permalink: "https://instagram.com/p/one",
      }),
      notifyReview: vi.fn().mockResolvedValue(undefined),
      resolveReview: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function editedContent(): SocialContent {
    return {
      ...socialPostFixture().content,
      title: "The five-minute close that saves Friday",
      hook: "Friday does not go sideways at 4:30. It starts Monday.",
      slides: [
        {
          ...socialPostFixture().content.slides[0],
          headline: "The five-minute close that saves Friday",
        },
      ],
    };
  }

  it("reselects, re-renders, preserves prior asset evidence, and restarts ten minutes", async () => {
    const deps = serviceDependencies();
    const result = await editSocialPostCopy(POST_ID, editedContent(), USER.email, deps);

    expect(deps.repository.beginEdit).toHaveBeenCalledWith(
      POST_ID,
      expect.objectContaining({
        content: editedContent(),
        render_version: expect.stringContaining("edit-"),
        audit_log: expect.arrayContaining([
          expect.objectContaining({
            event: "edit_started",
            metadata: expect.objectContaining({ previous_assets: socialPostFixture().rendered_assets }),
          }),
        ]),
      })
    );
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(deps.repository.completeEdit).toHaveBeenCalledWith(
      POST_ID,
      expect.objectContaining({ publish_after: "2026-09-01T20:10:00.000Z" })
    );
    expect(result.post.status).toBe("review");
    expect(deps.notifyReview).toHaveBeenCalled();
  });

  it("marks an edit failed without discarding the prior rendered assets", async () => {
    const deps = serviceDependencies({ render: vi.fn().mockRejectedValue(new Error("render failed")) });

    await expect(editSocialPostCopy(POST_ID, editedContent(), USER.email, deps)).rejects.toMatchObject({
      code: "SOCIAL_EDIT_RENDER_FAILED",
    });
    expect(deps.repository.failEdit).toHaveBeenCalledWith(
      POST_ID,
      expect.objectContaining({ priorAssets: socialPostFixture().rendered_assets })
    );
  });

  it("cancels only reviewable posts and resolves the veto notification", async () => {
    const deps = serviceDependencies();
    const result = await cancelSocialPost(POST_ID, USER.email, deps);

    expect(result.post.status).toBe("cancelled");
    expect(deps.repository.cancel).toHaveBeenCalledWith(
      POST_ID,
      expect.objectContaining({ cancelled_at: "2026-09-01T20:00:00.000Z" })
    );
    expect(deps.resolveReview).toHaveBeenCalledWith(POST_ID);
  });

  it("uses the shared atomic publisher for publish-now", async () => {
    const deps = serviceDependencies();
    const result = await publishSocialPostImmediately(POST_ID, USER.email, deps);

    expect(result.outcome).toBe("published");
    expect(deps.publishNow).toHaveBeenCalledWith(POST_ID);
  });

  it("resets exhausted attempts before an explicit operator retry", async () => {
    const failed = socialPostFixture({ status: "failed", attempt_count: 3, max_attempts: 3, claim_token: null });
    const deps = serviceDependencies({
      repository: {
        ...serviceDependencies().repository,
        getById: vi.fn().mockResolvedValue(failed),
      },
    });

    await retrySocialPostImmediately(POST_ID, USER.email, deps);
    expect(deps.repository.resetForRetry).toHaveBeenCalledWith(
      POST_ID,
      expect.objectContaining({ attempt_count: 0, max_attempts: 3 })
    );
    expect(deps.publishNow).toHaveBeenCalledWith(POST_ID);
  });

  it("keeps published and cancelled posts immutable", async () => {
    for (const status of ["published", "cancelled"] as const) {
      const deps = serviceDependencies({
        repository: {
          ...serviceDependencies().repository,
          getById: vi.fn().mockResolvedValue(socialPostFixture({ status })),
        },
      });
      await expect(editSocialPostCopy(POST_ID, editedContent(), USER.email, deps)).rejects.toMatchObject({
        code: "SOCIAL_POST_IMMUTABLE",
        status: 409,
      });
    }
  });
});

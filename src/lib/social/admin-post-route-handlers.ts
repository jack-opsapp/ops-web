import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/api-auth";
import { socialContentSchema } from "@/lib/social/contract";
import {
  AdminSocialError,
  cancelSocialPost,
  editSocialPostCopy,
  listSocialPosts,
  publishSocialPostImmediately,
  retrySocialPostImmediately,
} from "@/lib/social/admin-service";
import {
  SOCIAL_POST_STATUSES,
  type SocialPostStatus,
} from "@/lib/social/types";

type RouteContext = { params: Promise<{ id: string }> };
const bodySchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("edit"), content: socialContentSchema })
    .strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("publish_now") }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);

export interface AdminSocialPostsListHandlerDependencies {
  authenticate: typeof requireAdmin;
  list: typeof listSocialPosts;
}

const listDefaults: AdminSocialPostsListHandlerDependencies = {
  authenticate: requireAdmin,
  list: (input) => listSocialPosts(input),
};

export function createAdminSocialPostsListHandler(
  dependencies: AdminSocialPostsListHandlerDependencies = listDefaults
) {
  return async function handleList(
    request: NextRequest
  ): Promise<NextResponse> {
    try {
      await dependencies.authenticate(request);
      const rawStatuses =
        request.nextUrl.searchParams.get("status") ??
        SOCIAL_POST_STATUSES.join(",");
      const statuses = rawStatuses
        .split(",")
        .filter(Boolean) as SocialPostStatus[];
      if (
        statuses.length === 0 ||
        statuses.some((status) => !SOCIAL_POST_STATUSES.includes(status))
      ) {
        return NextResponse.json(
          { error: "Invalid status filter" },
          { status: 400 }
        );
      }
      const rawLimit = Number(
        request.nextUrl.searchParams.get("limit") ?? "50"
      );
      const limit = Number.isInteger(rawLimit)
        ? Math.max(1, Math.min(rawLimit, 100))
        : 50;
      const posts = await dependencies.list({ statuses, limit });
      return NextResponse.json({ posts });
    } catch (error) {
      if (error instanceof NextResponse) return error;
      console.error("[admin-social] List failed");
      return NextResponse.json(
        { error: "Social queue could not be loaded" },
        { status: 500 }
      );
    }
  };
}

export interface AdminSocialPostActionHandlerDependencies {
  authenticate: typeof requireAdmin;
  edit: typeof editSocialPostCopy;
  cancel: typeof cancelSocialPost;
  publishNow: typeof publishSocialPostImmediately;
  retryNow: typeof retrySocialPostImmediately;
}

const actionDefaults: AdminSocialPostActionHandlerDependencies = {
  authenticate: requireAdmin,
  edit: (id, content, email) => editSocialPostCopy(id, content, email),
  cancel: (id, email) => cancelSocialPost(id, email),
  publishNow: (id, email) => publishSocialPostImmediately(id, email),
  retryNow: (id, email) => retrySocialPostImmediately(id, email),
};

export function createAdminSocialPostActionHandler(
  dependencies: AdminSocialPostActionHandlerDependencies = actionDefaults
) {
  return async function handleAction(
    request: NextRequest,
    context: RouteContext
  ): Promise<NextResponse> {
    try {
      const user = await dependencies.authenticate(request);
      const { id } = await context.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return NextResponse.json(
          { error: "Invalid social post ID" },
          { status: 400 }
        );
      }
      const parsed = bodySchema.safeParse(
        await request.json().catch(() => null)
      );
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Invalid social action",
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 400 }
        );
      }
      const email = user.email!;
      switch (parsed.data.action) {
        case "edit":
          return NextResponse.json(
            await dependencies.edit(id, parsed.data.content, email)
          );
        case "cancel":
          return NextResponse.json(await dependencies.cancel(id, email));
        case "publish_now":
          return NextResponse.json(await dependencies.publishNow(id, email));
        case "retry":
          return NextResponse.json(await dependencies.retryNow(id, email));
      }
    } catch (error) {
      if (error instanceof NextResponse) return error;
      if (error instanceof AdminSocialError) {
        return NextResponse.json(
          { error: error.message, code: error.code, details: error.details },
          { status: error.status }
        );
      }
      console.error("[admin-social] Mutation failed");
      return NextResponse.json(
        { error: "Social action failed" },
        { status: 500 }
      );
    }
  };
}

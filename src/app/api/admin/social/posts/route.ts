import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import { listSocialPosts } from "@/lib/social/admin-service";
import { SOCIAL_POST_STATUSES, type SocialPostStatus } from "@/lib/social/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminSocialPostsListHandlerDependencies {
  authenticate: typeof requireAdmin;
  list: typeof listSocialPosts;
}

const defaults: AdminSocialPostsListHandlerDependencies = {
  authenticate: requireAdmin,
  list: (input) => listSocialPosts(input),
};

export function createAdminSocialPostsListHandler(
  dependencies: AdminSocialPostsListHandlerDependencies = defaults
) {
  return async function handleList(request: NextRequest): Promise<NextResponse> {
    try {
      await dependencies.authenticate(request);
      const rawStatuses = request.nextUrl.searchParams.get("status") ?? SOCIAL_POST_STATUSES.join(",");
      const statuses = rawStatuses.split(",").filter(Boolean) as SocialPostStatus[];
      if (
        statuses.length === 0 ||
        statuses.some((status) => !SOCIAL_POST_STATUSES.includes(status))
      ) {
        return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
      }
      const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
      const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
      const posts = await dependencies.list({ statuses, limit });
      return NextResponse.json({ posts });
    } catch (error) {
      if (error instanceof NextResponse) return error;
      console.error("[admin-social] List failed");
      return NextResponse.json({ error: "Social queue could not be loaded" }, { status: 500 });
    }
  };
}

export const GET = createAdminSocialPostsListHandler();

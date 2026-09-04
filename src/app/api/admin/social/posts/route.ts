import { createAdminSocialPostsListHandler } from "@/lib/social/admin-post-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createAdminSocialPostsListHandler();

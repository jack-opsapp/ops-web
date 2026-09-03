import { createAdminSocialPostActionHandler } from "@/lib/social/admin-post-route-handlers";

export const runtime = "nodejs";
export const maxDuration = 300;

export const PATCH = createAdminSocialPostActionHandler();

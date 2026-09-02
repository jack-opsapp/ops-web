import { createAdminSocialInstagramHandlers } from "@/lib/social/admin-instagram-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createAdminSocialInstagramHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/api-auth";
import { socialContentSchema } from "@/lib/social/contract";
import {
  AdminSocialError,
  cancelSocialPost,
  editSocialPostCopy,
  publishSocialPostImmediately,
  retrySocialPostImmediately,
} from "@/lib/social/admin-service";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), content: socialContentSchema }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("publish_now") }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);

export interface AdminSocialPostActionHandlerDependencies {
  authenticate: typeof requireAdmin;
  edit: typeof editSocialPostCopy;
  cancel: typeof cancelSocialPost;
  publishNow: typeof publishSocialPostImmediately;
  retryNow: typeof retrySocialPostImmediately;
}

const defaults: AdminSocialPostActionHandlerDependencies = {
  authenticate: requireAdmin,
  edit: (id, content, email) => editSocialPostCopy(id, content, email),
  cancel: (id, email) => cancelSocialPost(id, email),
  publishNow: (id, email) => publishSocialPostImmediately(id, email),
  retryNow: (id, email) => retrySocialPostImmediately(id, email),
};

export function createAdminSocialPostActionHandler(
  dependencies: AdminSocialPostActionHandlerDependencies = defaults
) {
  return async function handleAction(
    request: NextRequest,
    context: RouteContext
  ): Promise<NextResponse> {
    try {
      const user = await dependencies.authenticate(request);
      const { id } = await context.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return NextResponse.json({ error: "Invalid social post ID" }, { status: 400 });
      }
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
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
          return NextResponse.json(await dependencies.edit(id, parsed.data.content, email));
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
      return NextResponse.json({ error: "Social action failed" }, { status: 500 });
    }
  };
}

export const PATCH = createAdminSocialPostActionHandler();

import { NextRequest, NextResponse } from "next/server";
import { socialSubmissionSchema } from "@/lib/social/contract";
import {
  readBearerToken,
  secureTokenEquals,
  validateIdempotencyKey,
} from "@/lib/social/auth";
import {
  SocialSubmissionError,
  submitSocialPost,
} from "@/lib/social/submission-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export interface SocialSubmissionHandlerDependencies {
  submit: typeof submitSocialPost;
}

const defaultDependencies: SocialSubmissionHandlerDependencies = {
  submit: (input) => submitSocialPost(input),
};

function responseBody(result: Awaited<ReturnType<typeof submitSocialPost>>) {
  const post = result.post;
  return {
    created: result.created,
    post_id: post.id,
    status: post.status,
    story_type: post.story_type,
    visual_treatment: post.visual_treatment,
    format: post.post_format,
    assets: post.rendered_assets,
    publish_after: post.publish_after,
    admin_url: `/admin/social?post=${post.id}`,
  };
}

export function createSocialSubmissionHandler(
  dependencies: SocialSubmissionHandlerDependencies = defaultDependencies
) {
  return async function handleSocialSubmission(request: NextRequest): Promise<NextResponse> {
    const configuredSecret = process.env.SOCIAL_AUTOMATION_SECRET?.trim() ?? "";
    if (configuredSecret.length < 32) {
      return NextResponse.json(
        {
          error: "Social automation authentication is not configured",
          code: "SOCIAL_AUTH_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const providedSecret = readBearerToken(request.headers.get("authorization"));
    if (!providedSecret || !secureTokenEquals(providedSecret, configuredSecret)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "SOCIAL_AUTH_INVALID" },
        { status: 401 }
      );
    }

    const idempotencyKey = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!idempotencyKey) {
      return NextResponse.json(
        {
          error: "A valid Idempotency-Key header is required",
          code: "INVALID_IDEMPOTENCY_KEY",
        },
        { status: 400 }
      );
    }

    const declaredBytes = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredBytes) && declaredBytes > 100_000) {
      return NextResponse.json(
        { error: "Social package exceeds 100 KB", code: "SOCIAL_PACKAGE_TOO_LARGE" },
        { status: 413 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const parsed = socialSubmissionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Social package is invalid",
          code: "INVALID_SOCIAL_PACKAGE",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    try {
      const result = await dependencies.submit({ idempotencyKey, submission: parsed.data });
      return NextResponse.json(responseBody(result), { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof SocialSubmissionError) {
        return NextResponse.json(
          { error: error.message, code: error.code, details: error.details },
          { status: error.status }
        );
      }
      console.error(
        "[social-agent] Submission failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return NextResponse.json(
        { error: "Social submission failed", code: "SOCIAL_SUBMISSION_FAILED" },
        { status: 500 }
      );
    }
  };
}

export const POST = createSocialSubmissionHandler();

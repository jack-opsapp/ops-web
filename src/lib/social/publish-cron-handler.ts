import { NextRequest, NextResponse } from "next/server";
import { readBearerToken, secureTokenEquals } from "@/lib/social/auth";
import {
  InstagramConnectionError,
} from "@/lib/social/instagram-connection-service";
import { runSocialPublisherBatch } from "@/lib/social/publisher";

interface SocialPublishCronDependencies {
  runBatch: (options: {
    limit: number;
  }) => ReturnType<typeof runSocialPublisherBatch>;
}

const defaultDependencies: SocialPublishCronDependencies = {
  runBatch: (options) => runSocialPublisherBatch(undefined, options),
};

export function createSocialPublishCronHandler(
  dependencies: SocialPublishCronDependencies = defaultDependencies
) {
  return async function handleSocialPublishCron(
    request: NextRequest
  ): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    if (cronSecret.length < 32) {
      return NextResponse.json(
        {
          ok: false,
          code: "CRON_AUTH_NOT_CONFIGURED",
          error: "Cron authentication is not configured",
        },
        { status: 503 }
      );
    }
    const provided = readBearerToken(request.headers.get("authorization"));
    if (!provided || !secureTokenEquals(provided, cronSecret)) {
      return NextResponse.json(
        { ok: false, code: "CRON_AUTH_INVALID", error: "Unauthorized" },
        { status: 401 }
      );
    }

    try {
      const summary = await dependencies.runBatch({ limit: 2 });
      return NextResponse.json({
        ok: true,
        claimed: summary.claimed,
        recovery_notifications: summary.recoveryNotifications,
        published: summary.published,
        retry_scheduled: summary.retryScheduled,
        failed: summary.failed,
        persistence_failed: summary.persistenceFailed,
        results: summary.results,
      });
    } catch (error) {
      if (
        error instanceof InstagramConnectionError &&
        error.code === "INSTAGRAM_NOT_CONNECTED"
      ) {
        return NextResponse.json({
          ok: true,
          skipped: "instagram_not_connected",
          claimed: 0,
          recovery_notifications: 0,
          published: 0,
          retry_scheduled: 0,
          failed: 0,
          persistence_failed: 0,
          results: [],
        });
      }
      console.error("[social-publish-cron] Worker failed");
      return NextResponse.json(
        {
          ok: false,
          code: "SOCIAL_PUBLISH_WORKER_FAILED",
          error: "Social publish worker failed",
        },
        { status: 500 }
      );
    }
  };
}

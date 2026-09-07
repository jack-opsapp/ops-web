import { NextResponse } from "next/server";

import type {
  CronWorkloadControlClient,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { readBearerToken, secureTokenEquals } from "@/lib/social/auth";
import { InstagramConnectionError } from "@/lib/social/instagram-connection-service";
import type { SocialPublisherBatchSummary } from "@/lib/social/publisher";

const WORKLOAD_KEY = "social-publish";
// maxDuration (300s) plus the shared crash-safety margin, like the accounting
// push-queue lanes; the service clamps anything shorter up to this anyway.
const LEASE_SECONDS = 360;
const BATCH_LIMIT = 2;

export interface SocialPublishCronDependencies {
  readonly runBatch: (options: {
    limit: number;
  }) => Promise<SocialPublisherBatchSummary>;
  readonly loadRuntime: () => {
    readonly supabase: CronWorkloadControlClient;
  };
  readonly runWithControl: typeof runWithCronWorkloadControl;
}

function idleSummary() {
  return {
    ok: true,
    skipped: "instagram_not_connected",
    claimed: 0,
    recovery_notifications: 0,
    published: 0,
    retry_scheduled: 0,
    failed: 0,
    persistence_failed: 0,
    results: [],
  };
}

export async function handleSocialPublishCron(
  request: Request,
  dependencies: SocialPublishCronDependencies
): Promise<Response> {
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
    const runtime = dependencies.loadRuntime();
    const controlled = await dependencies.runWithControl({
      supabase: runtime.supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: LEASE_SECONDS,
      work: async () => {
        try {
          const summary = await dependencies.runBatch({ limit: BATCH_LIMIT });
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
          // No connected account is an idle state, not a failed run: the
          // lease completes as a success so the workload ledger stays honest.
          if (
            error instanceof InstagramConnectionError &&
            error.code === "INSTAGRAM_NOT_CONNECTED"
          ) {
            return NextResponse.json(idleSummary());
          }
          throw error;
        }
      },
    });

    if (controlled.status === "completed") return controlled.value;
    const alreadyRunning = controlled.reason === "lease_held";
    return NextResponse.json(
      {
        ok: alreadyRunning,
        ran: false,
        reason: alreadyRunning ? "already_running" : controlled.reason,
      },
      { status: alreadyRunning ? 200 : 503 }
    );
  } catch {
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
}

import { NextResponse } from "next/server";

import type {
  CronWorkloadControlClient,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { readBearerToken, secureTokenEquals } from "@/lib/social/auth";
import type { runCloudEditorial } from "@/lib/social/editorial/runtime";

const WORKLOAD_KEY = "social-editorial";
// maxDuration (300s) plus the shared crash-safety margin, like the
// social-publish lane; the service clamps anything shorter up to this anyway.
const LEASE_SECONDS = 360;

export type SocialEditorialRunResult = Awaited<
  ReturnType<typeof runCloudEditorial>
>;

export interface SocialEditorialCronDependencies {
  readonly run: () => Promise<SocialEditorialRunResult>;
  readonly loadRuntime: () => {
    readonly supabase: CronWorkloadControlClient;
  };
  readonly runWithControl: typeof runWithCronWorkloadControl;
}

// Every response is uncacheable: the release runbook verifies that
// unauthenticated calls answer 401 with no-store.
function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleSocialEditorialCron(
  request: Request,
  dependencies: SocialEditorialCronDependencies
): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (cronSecret.length < 32) {
    return json({ code: "CRON_AUTH_NOT_CONFIGURED" }, 503);
  }
  const provided = readBearerToken(request.headers.get("authorization"));
  if (!provided || !secureTokenEquals(provided, cronSecret)) {
    return json({ code: "UNAUTHORIZED" }, 401);
  }

  try {
    const runtime = dependencies.loadRuntime();
    const controlled = await dependencies.runWithControl({
      supabase: runtime.supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: LEASE_SECONDS,
      // An off-mode or no-slot tick resolves to an idle result instead of
      // throwing, so it completes the lease as a success and the workload
      // ledger stays honest.
      work: async () => json(await dependencies.run()),
    });

    if (controlled.status === "completed") return controlled.value;
    const alreadyRunning = controlled.reason === "lease_held";
    return json(
      {
        ok: alreadyRunning,
        ran: false,
        reason: alreadyRunning ? "already_running" : controlled.reason,
      },
      alreadyRunning ? 200 : 503
    );
  } catch {
    console.error("[social-editorial-cron] Worker failed");
    return json({ code: "EDITORIAL_WORKER_FAILED" }, 500);
  }
}

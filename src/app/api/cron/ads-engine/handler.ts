import { NextResponse } from "next/server";

import type {
  CronWorkloadControlClient,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { readBearerToken, secureTokenEquals } from "@/lib/social/auth";
import type { runAdsEngineTick } from "@/lib/ads/engine/worker-runtime";

const WORKLOAD_KEY = "ads-engine";
// maxDuration (300s) plus the shared crash-safety margin, like the
// social-editorial lane; the service clamps anything shorter up to this anyway.
const LEASE_SECONDS = 360;

export type AdsEngineTickResult = Awaited<ReturnType<typeof runAdsEngineTick>>;

export interface AdsEngineCronDependencies {
  readonly run: () => Promise<AdsEngineTickResult>;
  readonly loadRuntime: () => {
    readonly supabase: CronWorkloadControlClient;
  };
  readonly runWithControl: typeof runWithCronWorkloadControl;
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleAdsEngineCron(
  request: Request,
  dependencies: AdsEngineCronDependencies
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
  } catch (error) {
    console.error("[ads-engine-cron] Worker failed", error);
    return json({ code: "ADS_ENGINE_WORKER_FAILED" }, 500);
  }
}

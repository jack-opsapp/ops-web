/**
 * OPS Admin — Google Ads backfill chunk dispatch (shared)
 *
 * SERVER ONLY. One job: hand the backfill baton to a fresh chunk-worker
 * invocation and make absolutely sure a dropped baton cannot go unnoticed.
 * A non-2xx response counts as a failed attempt (the original chain died
 * silently because a fetch that "succeeded" with a 5xx was never checked).
 * After all retries fail, the run is marked `failed` with a descriptive
 * error — never left frozen at `running`.
 */
import { updateSyncStatus } from "./ads-history-queries";

const RETRY_DELAYS_MS = [1_000, 3_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DispatchResult {
  ok: boolean;
  attempts: number;
  lastError?: string;
}

/**
 * POST the chunk-worker URL with CRON_SECRET auth, retrying on network
 * errors and non-2xx responses. On total failure, marks the backfill run
 * `failed` so the UI surfaces it instead of an eternally frozen bar.
 */
export async function dispatchBackfillChunk(
  chunkUrl: string,
  cronSecret: string
): Promise<DispatchResult> {
  let lastError = "";

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    try {
      const response = await fetch(chunkUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cronSecret}`,
          "Content-Type": "application/json",
        },
      });
      if (response.ok) {
        return { ok: true, attempts: attempt + 1 };
      }
      const body = await response.text().catch(() => "");
      lastError = `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    console.error(
      `[ads-backfill] chunk dispatch attempt ${attempt + 1} failed: ${lastError}`
    );
  }

  try {
    await updateSyncStatus("backfill", {
      status: "failed",
      error: `Failed to dispatch chunk worker after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastError}`,
    });
  } catch (statusErr) {
    console.error("[ads-backfill] could not mark run failed:", statusErr);
  }

  return { ok: false, attempts: RETRY_DELAYS_MS.length + 1, lastError };
}

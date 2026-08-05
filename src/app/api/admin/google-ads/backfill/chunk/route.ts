/**
 * OPS Admin — Google Ads Backfill Chunk Worker
 *
 * Processes as many ~30-day chunks as fit inside a time budget, writing
 * progress after every chunk, then hands off to a fresh invocation for the
 * remainder. A 2-year backfill needs ~25 chunks; with the in-invocation loop
 * that is 1–3 invocations instead of 25 fragile handoffs.
 *
 * Handoffs are verified and retried (see ads-backfill-dispatch); if every
 * attempt fails the run is marked `failed` loudly — a broken chain must never
 * leave the status frozen at `running`. The daily ads-sync cron additionally
 * acts as a watchdog: a `running` run with a stale heartbeat is re-dispatched
 * from where it stopped (see /api/cron/ads-sync).
 *
 * Auth: CRON_SECRET (same pattern as /api/cron/*). Not callable by end users.
 */
import { NextRequest, NextResponse, after } from "next/server";
import { syncChunk } from "@/lib/admin/ads-history-sync";
import { getSyncStatus, updateSyncStatus } from "@/lib/admin/ads-history-queries";
import { dispatchBackfillChunk } from "@/lib/admin/ads-backfill-dispatch";

export const maxDuration = 300;

const CHUNK_DAYS = 30;

/**
 * Stop starting new chunks once this much of the invocation has elapsed,
 * leaving headroom under maxDuration for the final status write + handoff.
 * Env override exists for tests (0 forces one chunk per invocation).
 */
function budgetMs(): number {
  const raw = process.env.ADS_BACKFILL_BUDGET_MS;
  if (raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return 240_000;
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDate(s: string): Date {
  // Force UTC midnight to avoid local-TZ drift.
  return new Date(`${s}T00:00:00.000Z`);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let chunksProcessed = 0;

  for (;;) {
    // Re-read state every iteration: a cancel, a restart, or a concurrent
    // worker (e.g. the watchdog re-dispatching a run that is actually alive)
    // must stop this loop instead of double-writing progress.
    const status = await getSyncStatus("backfill");
    if (!status || status.status !== "running" || !status.backfill_progress) {
      return NextResponse.json({ stopped: true, reason: "not running", chunksProcessed });
    }

    const progress = status.backfill_progress;
    const overallEnd = parseDate(progress.endDate);
    const chunkStart = parseDate(progress.currentDate);

    if (chunkStart > overallEnd) {
      await updateSyncStatus("backfill", {
        status: "complete",
        last_synced_date: progress.endDate,
        error: null,
        backfill_progress: {
          ...progress,
          currentDate: progress.endDate,
          completedDays: progress.totalDays,
        },
      });
      return NextResponse.json({ status: "complete", completedDays: progress.totalDays });
    }

    let chunkEnd = addDays(chunkStart, CHUNK_DAYS - 1);
    if (chunkEnd > overallEnd) chunkEnd = overallEnd;

    try {
      await syncChunk(chunkStart, chunkEnd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-chunk] ${fmt(chunkStart)}→${fmt(chunkEnd)} failed:`, err);
      await updateSyncStatus("backfill", {
        status: "failed",
        error: `Chunk ${fmt(chunkStart)}→${fmt(chunkEnd)} failed: ${message}`,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    chunksProcessed += 1;

    const chunkDays =
      Math.ceil((chunkEnd.getTime() - chunkStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const newCompleted = Math.min(progress.completedDays + chunkDays, progress.totalDays);
    const nextStart = addDays(chunkEnd, 1);
    const done = nextStart > overallEnd;

    if (done) {
      await updateSyncStatus("backfill", {
        status: "complete",
        last_synced_date: progress.endDate,
        error: null,
        backfill_progress: {
          ...progress,
          currentDate: progress.endDate,
          completedDays: progress.totalDays,
        },
      });
      return NextResponse.json({ status: "complete", completedDays: progress.totalDays });
    }

    // Heartbeat: progress lands after every chunk so the UI bar moves and the
    // watchdog can distinguish alive from stalled.
    await updateSyncStatus("backfill", {
      status: "running",
      last_synced_date: fmt(chunkEnd),
      error: null,
      backfill_progress: {
        ...progress,
        currentDate: fmt(nextStart),
        completedDays: newCompleted,
      },
    });

    if (Date.now() - startedAt >= budgetMs()) {
      // Budget spent — hand the remainder to a fresh invocation.
      const chunkUrl = new URL("/api/admin/google-ads/backfill/chunk", req.url).toString();
      after(async () => {
        await dispatchBackfillChunk(chunkUrl, secret);
      });
      return NextResponse.json({
        status: "running",
        handedOff: true,
        nextStart: fmt(nextStart),
        completedDays: newCompleted,
        totalDays: progress.totalDays,
        chunksProcessed,
      });
    }
  }
}

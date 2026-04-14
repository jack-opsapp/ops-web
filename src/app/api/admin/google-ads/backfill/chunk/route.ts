/**
 * OPS Admin — Google Ads Backfill Chunk Worker
 *
 * Processes ONE ~30-day chunk per invocation, then self-schedules the next
 * chunk via `after(fetch(...))`. This turns a multi-minute backfill into a
 * chain of short function invocations, each with its own fresh timeout.
 *
 * Auth: CRON_SECRET (same pattern as /api/cron/*). Not callable by end users.
 */
import { NextRequest, NextResponse, after } from "next/server";
import { syncChunk } from "@/lib/admin/ads-history-sync";
import { getSyncStatus, updateSyncStatus } from "@/lib/admin/ads-history-queries";

export const maxDuration = 300;

const CHUNK_DAYS = 30;

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

  const status = await getSyncStatus("backfill");
  if (!status || status.status !== "running" || !status.backfill_progress) {
    // Someone canceled, restarted, or state got cleared — stop the chain.
    return NextResponse.json({ stopped: true, reason: "not running" });
  }

  const progress = status.backfill_progress;
  const overallEnd = parseDate(progress.endDate);
  const chunkStart = parseDate(progress.currentDate);

  if (chunkStart > overallEnd) {
    await updateSyncStatus("backfill", {
      status: "complete",
      last_synced_date: progress.endDate,
      error: null,
    });
    return NextResponse.json({ stopped: true, reason: "already complete" });
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

  // Schedule the next chunk as a fresh function invocation after we respond.
  const chunkUrl = new URL("/api/admin/google-ads/backfill/chunk", req.url).toString();
  after(async () => {
    try {
      await fetch(chunkUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      console.error("[backfill-chunk] failed to dispatch next chunk:", err);
      await updateSyncStatus("backfill", {
        status: "failed",
        error: `Failed to dispatch next chunk: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  return NextResponse.json({
    status: "running",
    chunkStart: fmt(chunkStart),
    chunkEnd: fmt(chunkEnd),
    nextStart: fmt(nextStart),
    completedDays: newCompleted,
    totalDays: progress.totalDays,
  });
}

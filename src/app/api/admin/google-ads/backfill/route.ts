import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import { getSyncStatus, updateSyncStatus } from "@/lib/admin/ads-history-queries";

export const maxDuration = 60;

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Stale-run detection (10 min)
  const current = await getSyncStatus("backfill");
  if (current?.status === "running") {
    const updatedAt = new Date(current.updated_at).getTime();
    const isStale = Date.now() - updatedAt > 10 * 60 * 1000;
    if (!isStale) {
      return NextResponse.json({ error: "Backfill already in progress" }, { status: 409 });
    }
    await updateSyncStatus("backfill", { status: "failed", error: "Previous run timed out" });
  }

  // Default: 2 years ago → yesterday
  const body = await req.json().catch(() => ({}));
  const yesterday = new Date();
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const twoYearsAgo = new Date();
  twoYearsAgo.setUTCHours(0, 0, 0, 0);
  twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);

  const startDate = body.startDate ? new Date(body.startDate) : twoYearsAgo;
  const endDate = body.endDate ? new Date(body.endDate) : yesterday;

  if (!(startDate <= endDate)) {
    return NextResponse.json({ error: "startDate must be <= endDate" }, { status: 400 });
  }

  const totalDays =
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  await updateSyncStatus("backfill", {
    status: "running",
    error: null,
    backfill_progress: {
      currentDate: fmt(startDate),
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      totalDays,
      completedDays: 0,
    },
  });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    await updateSyncStatus("backfill", {
      status: "failed",
      error: "Missing CRON_SECRET env var (required to dispatch chunk worker)",
    });
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET not set" },
      { status: 500 }
    );
  }

  const chunkUrl = new URL("/api/admin/google-ads/backfill/chunk", req.url).toString();

  // Fire-and-forget the first chunk after the response is sent.
  // Each chunk worker self-schedules the next chunk, so this one HTTP call
  // starts a chain of independent function invocations, bypassing the 60s
  // function limit that would kill a single long-running request.
  after(async () => {
    try {
      await fetch(chunkUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cronSecret}`,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      console.error("[backfill] failed to dispatch first chunk:", err);
      await updateSyncStatus("backfill", {
        status: "failed",
        error: `Failed to dispatch chunk worker: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  return NextResponse.json(
    {
      status: "queued",
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      totalDays,
    },
    { status: 202 }
  );
}

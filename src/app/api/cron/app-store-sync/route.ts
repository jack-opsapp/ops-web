import { NextRequest, NextResponse } from "next/server";
import { isAppStoreConfigured } from "@/lib/analytics/app-store-client";
import { bootstrapIfNeeded, runSync } from "@/lib/admin/app-store-sync";
import {
  getAscSyncStatus,
  updateAscSyncStatus,
} from "@/lib/admin/app-store-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

// The sync loops bounded steps under a 240s budget so the walk can reach the
// commerce category and drain Apple's instance backlog in one invocation. The
// workload lease enforces a >=360s effective lease with watchdog renewal, so a
// 300s run stays fenced.
export const maxDuration = 300;

/**
 * Flatten an error and its `cause` chain into one persisted line. The App Store
 * pipeline wraps Postgres failures in CronDatabaseOperationError, so the wrapper
 * message alone ("... fact upsert failed") hides the actual cause — which is the
 * only thing that makes a wedged sync diagnosable.
 */
function describeFailure(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const detail = ["message", "details", "hint", "code"]
        .map((key) => record[key])
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" | ");
      parts.push(detail || JSON.stringify(record).slice(0, 200));
      current = record.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.filter(Boolean).join(" <- ").slice(0, 800);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAppStoreConfigured()) {
    return NextResponse.json({ skipped: true, reason: "App Store Connect not configured" });
  }

  const supabase = getAdminSupabase();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "app-store-sync",
      leaseSeconds: 90,
      work: async (lease) => {
        try {
          const previous = await getAscSyncStatus("app-store-sync");
          await updateAscSyncStatus(
            "app-store-sync",
            { status: "running", error: null },
            supabase
          );
          await bootstrapIfNeeded(supabase);
          const result = await runSync(supabase, lease);
          // Monotonic: a restatement segment reports an OLDER processing date,
          // and a no-op run reports none. Omitting the column preserves the
          // stored value (PostgREST upsert only SETs provided columns).
          const newestDate =
            [previous?.last_synced_date ?? null, result.lastDate]
              .filter((d): d is string => Boolean(d))
              .sort()
              .pop() ?? null;
          const completePatch: Parameters<typeof updateAscSyncStatus>[1] = {
            status: "complete",
            error: null,
          };
          if (newestDate) completePatch.last_synced_date = newestDate;
          await updateAscSyncStatus(
            "app-store-sync",
            completePatch,
            supabase
          );
          return result;
        } catch (error) {
          if (isDatabasePressureError(error)) throw error;

          await updateAscSyncStatus(
            "app-store-sync",
            { status: "failed", error: describeFailure(error) },
            supabase
          );
          throw error;
        }
      },
    });

    if (controlled.status === "skipped") {
      if (controlled.reason === "lease_held") {
        return NextResponse.json({
          ok: true,
          ran: false,
          reason: "already_running",
        });
      }
      return NextResponse.json(
        { ok: false, ran: false, reason: controlled.reason },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: "synced",
      ...controlled.value,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

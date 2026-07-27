import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { runExternalIntakeMaintenance } from "@/lib/external-api/uploads/attachment-runtime";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

function authorized(request: NextRequest, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(
    request.headers.get("authorization") ?? "",
    "utf8"
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Maintenance unavailable" },
      { status: 500 }
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "external-api-maintenance",
      leaseSeconds: 300,
      work: () =>
        runExternalIntakeMaintenance(supabase, {
          eventLimit: 10,
          inspectionLimit: 5,
          cleanupLimit: 5,
          leaseSeconds: 360,
        }),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning
            ? "already_running"
            : "temporarily_unavailable",
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    const value = controlled.value;
    const ok = value.errors.length === 0;
    return NextResponse.json(
      {
        ok,
        ran: true,
        eventsRecorded: value.eventsRecorded,
        inspectionsClaimed: value.inspectionsClaimed,
        accepted: value.accepted,
        rejected: value.rejected,
        retrying: value.retrying,
        cleanupsClaimed: value.cleanupsClaimed,
        cleanupsCompleted: value.cleanupsCompleted,
        cleanupRetrying: value.cleanupRetrying,
        expired: value.expired,
        credentialsRetired: value.credentialsRetired,
      },
      { status: ok ? 200 : 503 }
    );
  } catch {
    console.error("[cron/external-api-maintenance] maintenance failed");
    return NextResponse.json(
      { ok: false, error: "Maintenance unavailable" },
      { status: 500 }
    );
  }
}

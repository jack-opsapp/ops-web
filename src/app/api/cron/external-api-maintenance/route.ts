import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { processExternalIntakeOutboxBatch } from "@/lib/external-api/intake/outbox-worker";
import { runExternalApiOperationsMaintenance } from "@/lib/external-api/security/security-alerts";
import { purgeExpiredExternalApiRateLimitWindows } from "@/lib/external-api/security/strict-rate-limit";
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
      work: async () => {
        const operations = await runExternalApiOperationsMaintenance(supabase, {
          limit: 100,
        });
        const rateLimitWindowsPurged =
          await purgeExpiredExternalApiRateLimitWindows(
            supabase,
            { limit: 1000 }
          );
        const maintenance = await runExternalIntakeMaintenance(supabase, {
          eventLimit: 10,
          inspectionLimit: 5,
          cleanupLimit: 5,
          leaseSeconds: 360,
        });
        const outbox = await processExternalIntakeOutboxBatch({
          limit: 10,
          leaseSeconds: 360,
          workerId: "external-api-maintenance",
        });
        return { operations, rateLimitWindowsPurged, maintenance, outbox };
      },
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

    const {
      operations,
      rateLimitWindowsPurged,
      maintenance,
      outbox,
    } = controlled.value;
    const ok = maintenance.errors.length === 0 && outbox.errors.length === 0;
    return NextResponse.json(
      {
        ok,
        ran: true,
        operationsCredentialsRetired: operations.credentialsRetired,
        networkFingerprintsPurged: operations.networkFingerprintsPurged,
        securityEventsPurged: operations.securityEventsPurged,
        projectionVersionsPruned: operations.projectionVersionsPruned,
        rateLimitWindowsPurged,
        securityAlertsCreated: operations.alertsCreated,
        securityRecipientsNotified: operations.recipientsNotified,
        operationsHealth: operations.health,
        eventsRecorded: maintenance.eventsRecorded,
        inspectionsClaimed: maintenance.inspectionsClaimed,
        accepted: maintenance.accepted,
        rejected: maintenance.rejected,
        retrying: maintenance.retrying,
        cleanupsClaimed: maintenance.cleanupsClaimed,
        cleanupsCompleted: maintenance.cleanupsCompleted,
        cleanupRetrying: maintenance.cleanupRetrying,
        expired: maintenance.expired,
        credentialsRetired: maintenance.credentialsRetired,
        projectFilesClaimed: maintenance.projectFilesClaimed,
        projectFilesCompleted: maintenance.projectFilesCompleted,
        projectFilesRetrying: maintenance.projectFilesRetrying,
        erasuresClaimed: maintenance.erasuresClaimed,
        erasuresCompleted: maintenance.erasuresCompleted,
        erasuresRetrying: maintenance.erasuresRetrying,
        outboxClaimed: outbox.claimed,
        outboxCompleted: outbox.completed,
        outboxRetrying: outbox.requeued,
      },
      { status: ok ? 200 : 503 }
    );
  } catch {
    console.error("[cron/external-api-maintenance] maintenance failed");
    return NextResponse.json(
      { ok: false, error: "Maintenance unavailable" },
      { status: 503 }
    );
  }
}

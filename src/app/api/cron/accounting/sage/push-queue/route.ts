import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";
import { AccountingSyncQueueService } from "@/lib/api/services/accounting-sync-queue-service";
import type { AccountingSyncQueueRow } from "@/lib/api/services/accounting-sync-queue-types";
import {
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import {
  AcceptedWriteDurabilityError,
  createSageQueueProcessorDependencies,
  processSageQueueRow,
  type SageQueueResult,
} from "@/lib/api/services/sage-queue-processor";
import {
  isSupplierBillQueueEntity,
  processSupplierBillQueueRow,
  type SupplierBillQueueRow,
  type SupplierBillQueueResult,
} from "@/lib/api/services/supplier-bill-queue-processor";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_LIMIT = 5;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`
  );
}

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Sage push queue failed.";
}

type SagePushQueueResult = SageQueueResult | SupplierBillQueueResult;

function summary(workerId: string, results: SagePushQueueResult[]) {
  return {
    ok: true,
    workerId,
    claimed: results.length,
    processed: results.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    retry: results.filter((result) => result.status === "retry").length,
    blocked: results.filter((result) => result.status === "blocked").length,
    needsReview: results.filter((result) => result.status === "needs_review")
      .length,
    results,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    process.env.ACCOUNTING_WRITE_ENABLED !== "true" ||
    process.env.SAGE_WRITE_ENABLED !== "true"
  ) {
    return NextResponse.json(
      { code: "SAGE_WRITE_DISABLED", error: "Sage writes are disabled" },
      { status: 409 }
    );
  }

  const supabase = getServiceRoleClient();
  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "sage-push",
      leaseSeconds: 360,
      work: async () => {
        const queue = new AccountingSyncQueueService(supabase);
        const audit = new AccountingSyncAuditService(supabase);
        const dependencies = createSageQueueProcessorDependencies(supabase);
        const workerId = `sage-push-${Date.now()}-${randomUUID()}`;
        const rows = await queue.claimDue({
          provider: "sage",
          limit: BATCH_LIMIT,
          workerId,
        });
        const results: SagePushQueueResult[] = [];

        // Sage documents may not be created concurrently. A fair batch is
        // claimed together, then every provider mutation runs sequentially.
        for (const row of rows) {
          try {
            if (isSupplierBillQueueEntity(row.entityType)) {
              results.push(
                await processSupplierBillQueueRow({
                  supabase,
                  queue,
                  audit,
                  row: row as unknown as SupplierBillQueueRow,
                  workerId,
                })
              );
            } else {
              results.push(
                await processSageQueueRow({
                  row: row as AccountingSyncQueueRow,
                  workerId,
                  dependencies,
                })
              );
            }
          } catch (error) {
            if (
              error instanceof AcceptedWriteDurabilityError ||
              isDatabasePressureError(error)
            ) {
              throw error;
            }
            throw new Error(
              `Sage batch stopped after queue ${row.id}: ${message(error)}`,
              { cause: error }
            );
          }
        }

        return NextResponse.json(summary(workerId, results));
      },
    });

    if (controlled.status === "skipped") {
      const held = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: held,
          ran: false,
          reason: held ? "already_running" : controlled.reason,
        },
        { status: held ? 200 : 503 }
      );
    }
    return controlled.value;
  } catch (error) {
    const detail = message(error);
    console.error("[cron/sage-push]", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

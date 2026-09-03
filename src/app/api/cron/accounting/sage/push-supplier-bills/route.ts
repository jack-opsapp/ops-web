import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";
import { AccountingSyncQueueService } from "@/lib/api/services/accounting-sync-queue-service";
import type { SupplierBillSyncEntityType } from "@/lib/api/services/accounting-sync-queue-types";
import { processSupplierBillQueueRow } from "@/lib/api/services/supplier-bill-queue-processor";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.ACCOUNTING_WRITE_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled", processed: 0 });
  }

  const supabase = getServiceRoleClient();
  const queue = new AccountingSyncQueueService(supabase);
  const audit = new AccountingSyncAuditService(supabase);
  const workerId = `sage-ap-${randomUUID()}`;
  const rows = await queue.claimDue<SupplierBillSyncEntityType>({
    provider: "sage",
    limit: 5,
    workerId,
  });
  const results = [];
  for (const row of rows) {
    results.push(
      await processSupplierBillQueueRow({
        supabase,
        queue,
        audit,
        row,
        workerId,
      })
    );
  }
  return NextResponse.json({
    status: "ok",
    processed: results.length,
    results,
  });
}

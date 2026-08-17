import { NextRequest, NextResponse } from "next/server";

import {
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { runEmailSendReconciliationRecovery } from "@/lib/api/services/email-send-reconciliation-recovery-service";
import { runApprovedActionEmailReconciliationRecovery } from "@/lib/api/services/approved-action-email-reconciliation-recovery-service";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = getServiceRoleClient();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "send-reconciliation",
      leaseSeconds: 240,
      work: () =>
        runWithSupabase(supabase, async () => {
          const options = {
            limit: 5,
            failureCooldownSeconds: 60,
            leaseSeconds: 180,
          };
          const emailSend = await runEmailSendReconciliationRecovery(
            supabase,
            options
          );
          const emailSendPressure = emailSend.errors.find(
            isDatabasePressureError
          );
          if (emailSendPressure) {
            throw emailSendPressure;
          }

          const approvedAction =
            await runApprovedActionEmailReconciliationRecovery(
              supabase,
              options
            );
          const errors = [...emailSend.errors, ...approvedAction.errors];
          const pressureError = errors.find(isDatabasePressureError);
          if (pressureError) {
            // Preserve the exact classified value. Re-wrapping it as a plain
            // Error can discard code/status/cause evidence before the shared
            // circuit records the failure.
            throw pressureError;
          }
          return {
            claimed: emailSend.claimed + approvedAction.claimed,
            reconciled: emailSend.reconciled + approvedAction.reconciled,
            failed: emailSend.failed + approvedAction.failed,
            exhausted: approvedAction.exhausted,
            errors,
            emailSend,
            approvedAction,
          };
        }),
    });

    if (controlled.status === "skipped") {
      const reason =
        controlled.reason === "lease_held"
          ? "already_running"
          : controlled.reason;
      return NextResponse.json(
        {
          ok: controlled.reason === "lease_held",
          ran: false,
          reason,
        },
        { status: controlled.reason === "lease_held" ? 200 : 503 }
      );
    }

    const result = controlled.value;
    const ok = result.failed === 0;
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503 });
  } catch (error) {
    const failure =
      error instanceof Error
        ? error.message
        : "Unknown email send reconciliation error";
    console.error("[cron/email-send-reconciliation]", failure);
    return NextResponse.json({ ok: false, error: failure }, { status: 500 });
  }
}

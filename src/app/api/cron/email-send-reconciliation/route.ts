import { NextRequest, NextResponse } from "next/server";

import {
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import {
  runEmailSendReconciliationRecovery,
  type EmailSendReconciliationRecoveryResult,
} from "@/lib/api/services/email-send-reconciliation-recovery-service";
import {
  runApprovedActionEmailReconciliationRecovery,
  type ApprovedActionEmailReconciliationRecoveryResult,
} from "@/lib/api/services/approved-action-email-reconciliation-recovery-service";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_LOGGED_RECONCILIATION_ERRORS = 10;
const MAX_LOGGED_RECONCILIATION_ERROR_LENGTH = 500;

type EmailSendReconciliationRunResult = {
  claimed: number;
  reconciled: number;
  failed: number;
  exhausted: number;
  errors: string[];
  emailSend: EmailSendReconciliationRecoveryResult;
  approvedAction: ApprovedActionEmailReconciliationRecoveryResult;
};

class EmailSendReconciliationRunError extends Error {
  constructor(readonly result: EmailSendReconciliationRunResult) {
    super(
      `Email send reconciliation failed for ${result.failed} operation${
        result.failed === 1 ? "" : "s"
      }`
    );
    this.name = "EmailSendReconciliationRunError";
  }
}

function boundedFailureLog(result: EmailSendReconciliationRunResult) {
  const errors = [
    ...result.emailSend.errors.map((message) => ({
      source: "email_send",
      message,
    })),
    ...result.approvedAction.errors.map((message) => ({
      source: "approved_action",
      message,
    })),
  ];
  const reportedErrors = errors
    .slice(0, MAX_LOGGED_RECONCILIATION_ERRORS)
    .map(({ source, message }) => ({
      source,
      message: message
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_LOGGED_RECONCILIATION_ERROR_LENGTH),
    }));

  return {
    event: "email_send_reconciliation_failed",
    claimed: result.claimed,
    reconciled: result.reconciled,
    failed: result.failed,
    exhausted: result.exhausted,
    errors: reportedErrors,
    omittedErrorCount: errors.length - reportedErrors.length,
  };
}

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
          const result: EmailSendReconciliationRunResult = {
            claimed: emailSend.claimed + approvedAction.claimed,
            reconciled: emailSend.reconciled + approvedAction.reconciled,
            failed: emailSend.failed + approvedAction.failed,
            exhausted: approvedAction.exhausted,
            errors,
            emailSend,
            approvedAction,
          };
          if (result.failed > 0) {
            // The workload guard records failure only when work rejects.
            // Returning this result would publish an HTTP 503 after the guard
            // had already persisted a false success.
            throw new EmailSendReconciliationRunError(result);
          }
          return result;
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

    return NextResponse.json({ ok: true, ...controlled.value });
  } catch (error) {
    if (error instanceof EmailSendReconciliationRunError) {
      console.error(
        "[cron/email-send-reconciliation]",
        JSON.stringify(boundedFailureLog(error.result))
      );
      return NextResponse.json({ ok: false, ...error.result }, { status: 503 });
    }

    const failure =
      error instanceof Error
        ? error.message
        : "Unknown email send reconciliation error";
    console.error("[cron/email-send-reconciliation]", failure);
    return NextResponse.json({ ok: false, error: failure }, { status: 500 });
  }
}

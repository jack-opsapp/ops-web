/**
 * GET /api/cron/payment-reminders
 * Vercel cron: runs daily at 10am UTC.
 * Detects overdue invoices, proposes payment reminders, flags late payors.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { PaymentReminderService } from "@/lib/api/services/payment-reminder-service";
import { runBoundedPhaseCCompanyFanout } from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 300;

const WORKLOAD_KEY = "payment-reminders";
const COMPANY_LIMIT = 5;

type ReminderResult = {
  companyId: string;
  remindersProposed: number;
  clientsFlagged: number;
  error?: string;
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: (lease) =>
        runBoundedPhaseCCompanyFanout<ReminderResult>({
          supabase,
          workloadKey: WORKLOAD_KEY,
          lease,
          companyLimit: COMPANY_LIMIT,
          processCompany: async (companyId) => {
            const remindersProposed =
              await PaymentReminderService.scheduleReminders(companyId);
            const clientsFlagged =
              await PaymentReminderService.flagRepeatLatePayors(companyId);
            return { companyId, remindersProposed, clientsFlagged };
          },
          onCompanyError: (companyId, error) => ({
            companyId,
            remindersProposed: 0,
            clientsFlagged: 0,
            error:
              error instanceof Error ? error.message : "Unknown error",
          }),
        }),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    const results = controlled.value.results.filter(
      (result) =>
        result.remindersProposed > 0 ||
        result.clientsFlagged > 0 ||
        result.error
    );
    const totalReminders = results.reduce((s, r) => s + r.remindersProposed, 0);
    const totalFlagged = results.reduce((s, r) => s + r.clientsFlagged, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: controlled.value.companyIds.length,
      totalReminders,
      totalFlagged,
      errors: errors.length,
      details: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/payment-reminders]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}

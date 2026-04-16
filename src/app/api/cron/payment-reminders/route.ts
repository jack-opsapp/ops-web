/**
 * GET /api/cron/payment-reminders
 * Vercel cron: runs daily at 10am UTC.
 * Detects overdue invoices, proposes payment reminders, flags late payors.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { PaymentReminderService } from "@/lib/api/services/payment-reminder-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export const maxDuration = 300;

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
    // Find all companies
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id")
      .limit(500);

    if (error) throw error;

    // Filter to phase_c companies — batch check in parallel
    const allCompanyIds = (companies ?? []).map((c) => c.id as string);
    const phaseCChecks = await Promise.allSettled(
      allCompanyIds.map(async (companyId) => {
        const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
          companyId,
          "phase_c"
        );
        return { companyId, enabled };
      })
    );
    const phaseCCompanyIds = phaseCChecks
      .filter(
        (r): r is PromiseFulfilledResult<{ companyId: string; enabled: boolean }> =>
          r.status === "fulfilled" && r.value.enabled
      )
      .map((r) => r.value.companyId);

    type ReminderResult = {
      companyId: string;
      remindersProposed: number;
      clientsFlagged: number;
      error?: string;
    };

    // Process in parallel batches of 10 to avoid timeout
    const CHUNK_SIZE = 10;
    const results: ReminderResult[] = [];

    for (let i = 0; i < phaseCCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = phaseCCompanyIds.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (companyId): Promise<ReminderResult> => {
          const [remindersProposed, clientsFlagged] = await Promise.all([
            PaymentReminderService.scheduleReminders(companyId),
            PaymentReminderService.flagRepeatLatePayors(companyId),
          ]);
          return { companyId, remindersProposed, clientsFlagged };
        })
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const r = chunkResults[j];
        if (r.status === "fulfilled") {
          if (r.value.remindersProposed > 0 || r.value.clientsFlagged > 0) {
            results.push(r.value);
          }
        } else {
          results.push({
            companyId: chunk[j],
            remindersProposed: 0,
            clientsFlagged: 0,
            error: r.reason?.message ?? "Unknown error",
          });
        }
      }
    }

    const totalReminders = results.reduce((s, r) => s + r.remindersProposed, 0);
    const totalFlagged = results.reduce((s, r) => s + r.clientsFlagged, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: phaseCCompanyIds.length,
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

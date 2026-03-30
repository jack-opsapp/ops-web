/**
 * POST /api/cron/duplicate-scan
 * Vercel cron: runs daily at 5am UTC.
 * Scans all active-subscription companies for duplicate entities
 * (clients, opportunities, projects, tasks).
 * Creates notifications for admin/owner/office users when duplicates are found.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { getSubscriptionInfo } from "@/lib/subscription";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import type { Company } from "@/lib/types/models";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
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
    // Fetch all companies with subscription info
    const { data: companies, error: companyErr } = await supabase
      .from("companies")
      .select(
        "id, subscriptionPlan, subscriptionStatus, trialEndDate, seatedEmployeeIds, adminIds, maxSeats"
      );

    if (companyErr) {
      throw new Error(`Failed to fetch companies: ${companyErr.message}`);
    }

    const results: Array<{
      companyId: string;
      newDuplicates: number;
      error?: string;
    }> = [];
    let skippedInactive = 0;

    for (const row of companies ?? []) {
      const subInfo = getSubscriptionInfo(
        row as unknown as Pick<
          Company,
          | "subscriptionPlan"
          | "subscriptionStatus"
          | "trialEndDate"
          | "seatedEmployeeIds"
          | "adminIds"
          | "maxSeats"
        >
      );
      if (!subInfo.isActive) {
        skippedInactive++;
        continue;
      }

      try {
        const newDuplicates = await DuplicateDetectionService.scanCompany(
          row.id as string
        );
        results.push({ companyId: row.id as string, newDuplicates });

        // Send notifications if new duplicates found
        if (newDuplicates > 0) {
          const { data: users } = await supabase
            .from("users")
            .select("id")
            .eq("company_id", row.id)
            .in("role", ["admin", "owner", "office"])
            .is("deleted_at", null);

          for (const user of users ?? []) {
            await NotificationService.create({
              userId: user.id as string,
              companyId: row.id as string,
              type: "duplicates_found",
              title: "Potential duplicates found",
              body: `${newDuplicates} potential duplicate record${newDuplicates === 1 ? "" : "s"} detected`,
              persistent: false,
              actionLabel: "Review",
            });
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[DuplicateScan] Company ${row.id} failed:`,
          message
        );
        results.push({
          companyId: row.id as string,
          newDuplicates: 0,
          error: message,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: results.length,
      skippedInactive,
      totalNewDuplicates: results.reduce(
        (sum, r) => sum + r.newDuplicates,
        0
      ),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateScan] Fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}

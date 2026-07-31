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
import { checkPermissionByIdStrict } from "@/lib/supabase/check-permission";
import { getSubscriptionInfo } from "@/lib/subscription";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import type { Company } from "@/lib/types/models";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 300;
const COMPANY_BATCH_SIZE = 5;
const NOTIFICATION_RECIPIENT_LIMIT = 100;

async function checkedDatabaseResult<T>(
  operation: string,
  pending: PromiseLike<{ data: T; error: unknown }>
): Promise<T> {
  let result: { data: T; error: unknown };
  try {
    result = await pending;
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `Duplicate scan ${operation} was unreachable`,
      { cause }
    );
  }
  if (result.error) {
    throw new CronDatabaseOperationError(
      `Duplicate scan ${operation} failed`,
      { cause: result.error }
    );
  }
  return result.data;
}

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
      workloadKey: "duplicate-scan",
      leaseSeconds: 360,
      work: async (lease) => {
        const expectedCursor = await readCronWorkloadCursor(
          supabase,
          "duplicate-scan",
          lease
        );
        let companyQuery = supabase
          .from("companies")
          .select(
            "id, subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
          );
        if (expectedCursor) {
          companyQuery = companyQuery.gt("id", expectedCursor);
        }
        const companies = await checkedDatabaseResult<
          Array<Record<string, unknown>> | null
        >(
          "company page read",
          companyQuery
            .order("id", { ascending: true })
            .limit(COMPANY_BATCH_SIZE)
        );
        const companyBatch = (companies ?? []).slice(
          0,
          COMPANY_BATCH_SIZE
        );

        const results: Array<{
          companyId: string;
          newDuplicates: number;
          error?: string;
        }> = [];
        let skippedInactive = 0;

        for (const row of companyBatch) {
          const companyId = row.id as string;
          const companyForSub = {
            subscriptionPlan: row.subscription_plan,
            subscriptionStatus: row.subscription_status,
            trialEndDate: row.trial_end_date
              ? new Date(row.trial_end_date as string)
              : undefined,
            seatedEmployeeIds: row.seated_employee_ids,
            adminIds: row.admin_ids,
            maxSeats: row.max_seats,
          } as Pick<
            Company,
            | "subscriptionPlan"
            | "subscriptionStatus"
            | "trialEndDate"
            | "seatedEmployeeIds"
            | "adminIds"
            | "maxSeats"
          >;
          const subInfo = getSubscriptionInfo(companyForSub);
          if (!subInfo.isActive) {
            skippedInactive += 1;
            continue;
          }

          try {
            const newDuplicates =
              await DuplicateDetectionService.scanCompany(companyId);
            results.push({ companyId, newDuplicates });

            if (newDuplicates > 0) {
              const users = await checkedDatabaseResult<
                Array<{ id: string }> | null
              >(
                "notification-recipient read",
                supabase
                  .from("users")
                  .select("id")
                  .eq("company_id", companyId)
                  .is("deleted_at", null)
                  .order("id", { ascending: true })
                  .limit(NOTIFICATION_RECIPIENT_LIMIT)
              );

              for (const user of users ?? []) {
                const canManage = await checkPermissionByIdStrict(
                  user.id,
                  "pipeline.manage"
                );
                if (!canManage) continue;

                await NotificationService.createOrThrow({
                  userId: user.id,
                  companyId,
                  type: "duplicates_found",
                  title: "Potential duplicates found",
                  body: `${newDuplicates} potential duplicate record${newDuplicates === 1 ? "" : "s"} detected`,
                  persistent: true,
                  actionLabel: "Review",
                });
              }
            }
          } catch (error) {
            if (isDatabasePressureError(error)) throw error;
            const message =
              error instanceof Error ? error.message : "Unknown error";
            console.error(
              `[DuplicateScan] Company ${companyId} failed:`,
              message
            );
            results.push({
              companyId,
              newDuplicates: 0,
              error: message,
            });
          }
        }

        const nextCursor =
          companyBatch.length === COMPANY_BATCH_SIZE
            ? (companyBatch.at(-1)?.id as string)
            : null;
        await advanceCronWorkloadCursor(
          supabase,
          "duplicate-scan",
          lease,
          expectedCursor,
          nextCursor
        );

        return {
          ok: true,
          scanned: results.length,
          skippedInactive,
          totalNewDuplicates: results.reduce(
            (sum, result) => sum + result.newDuplicates,
            0
          ),
          results,
        };
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

    return NextResponse.json(controlled.value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[DuplicateScan] Fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}

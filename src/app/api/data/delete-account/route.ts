/**
 * POST /api/data/delete-account
 *
 * Identity, authorization, company-admin standing, Stripe cancellation, and
 * the API contract stay in this server route. The destructive company-data
 * cascade runs inside public.purge_company_data as one PostgreSQL statement.
 * PostgreSQL therefore commits every manifest step together or rolls every
 * step back together.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { eraseSiteVisitPrefix } from "@/lib/s3/site-visit-prefix-erasure";
import {
  COMPANY_DATA_PURGE_FUNCTION,
  MANIFEST_VERSION,
  transactionalPurgePlan,
} from "@/lib/data/company-data-manifest";

export const maxDuration = 300;

interface DatabaseFailure {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface TransactionalPurgeResult {
  manifest_version: string;
  deleted_counts: Record<string, number>;
  completed_steps: number;
  total_steps: number;
}

interface FailedStep {
  index: number;
  table: string;
  operation: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function describeDatabaseFailure(error: DatabaseFailure): string {
  const parts = [error.message, error.details, error.hint]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const description = parts.join(" ");
  if (error.code?.trim()) {
    return description
      ? `${description} [${error.code.trim()}]`
      : `Database error ${error.code.trim()}`;
  }
  return description || "The database did not return an error message.";
}

function parseFailedStep(
  error: DatabaseFailure,
  total: number
): FailedStep | null {
  const match = error.message?.match(
    /purge_company_data: step (\d+)\/(\d+) \((soft-delete|purge) ([a-z0-9_]+)\) failed:/
  );
  if (!match) return null;

  const index = Number(match[1]);
  const reportedTotal = Number(match[2]);
  if (
    !Number.isInteger(index) ||
    index < 1 ||
    reportedTotal !== total
  ) {
    return null;
  }

  return {
    index,
    table: match[4],
    operation: match[3],
    message: describeDatabaseFailure(error),
    ...(error.code?.trim() ? { code: error.code.trim() } : {}),
    ...(error.details?.trim() ? { details: error.details.trim() } : {}),
    ...(error.hint?.trim() ? { hint: error.hint.trim() } : {}),
  };
}

function isPostgresRollback(error: DatabaseFailure): boolean {
  return Boolean(
    error.message?.startsWith("purge_company_data:") &&
      error.code &&
      /^[0-9A-Z]{5}$/.test(error.code)
  );
}

function isCompletePurgeResult(
  value: unknown,
  expectedTables: readonly string[]
): value is TransactionalPurgeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<TransactionalPurgeResult>;
  if (
    result.manifest_version !== MANIFEST_VERSION ||
    result.completed_steps !== expectedTables.length ||
    result.total_steps !== expectedTables.length ||
    !result.deleted_counts ||
    typeof result.deleted_counts !== "object" ||
    Array.isArray(result.deleted_counts)
  ) {
    return false;
  }

  const returnedTables = Object.keys(result.deleted_counts).sort();
  if (
    returnedTables.length !== expectedTables.length ||
    returnedTables.some((table, index) => table !== [...expectedTables].sort()[index])
  ) {
    return false;
  }

  return Object.values(result.deleted_counts).every(
    (count) => Number.isSafeInteger(count) && count >= 0
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const purgePlan = transactionalPurgePlan();
  const expectedTables = purgePlan.steps.map((entry) => entry.table);

  try {
    const { idToken, companyId, confirmText } = await req.json();

    if (!idToken || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, companyId" },
        { status: 400 }
      );
    }

    if (confirmText !== "DELETE") {
      return NextResponse.json(
        { error: "Type DELETE to confirm account deletion." },
        { status: 400 }
      );
    }

    const firebaseUser = await verifyAuthToken(idToken);
    const allowed = await checkPermission(
      firebaseUser.uid,
      "settings.company",
      firebaseUser.email
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "You don't have permission to delete this account." },
        { status: 403 }
      );
    }

    const db = getServiceRoleClient();
    const user = await findUserByAuth(
      firebaseUser.uid,
      firebaseUser.email,
      "id, company_id, is_company_admin"
    );

    if (!user || user.company_id !== companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: company, error: companyError } = await db
      .from("companies")
      .select("id, admin_ids, stripe_customer_id")
      .eq("id", companyId)
      .is("deleted_at", null)
      .single();

    if (companyError && companyError.code !== "PGRST116") {
      throw new Error(describeDatabaseFailure(companyError));
    }
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const adminIds = (company.admin_ids as string[]) ?? [];
    const isAdmin =
      user.is_company_admin || adminIds.includes(user.id as string);
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only company admins can delete the account." },
        { status: 403 }
      );
    }

    const { data: purgeData, error: purgeError } = await db.rpc(
      COMPANY_DATA_PURGE_FUNCTION,
      {
        p_company_id: companyId,
        p_plan: purgePlan,
      }
    );

    if (purgeError) {
      const failedStep = parseFailedStep(purgeError, expectedTables.length);
      const rolledBack = isPostgresRollback(purgeError);
      console.error(
        `[delete-account] Transaction failed for company ${companyId}: ` +
          describeDatabaseFailure(purgeError)
      );

      return NextResponse.json(
        {
          success: false,
          manifestVersion: MANIFEST_VERSION,
          companyId,
          error: rolledBack
            ? "Account deletion failed. No company data was deleted. Try again."
            : "Account deletion could not be confirmed. Contact support before trying again.",
          ...(failedStep ? { failedStep } : {}),
          steps: { completed: 0, total: expectedTables.length },
          completedSteps: [],
          deletedCounts: {},
          transaction: rolledBack ? "rolled_back" : "unknown",
        },
        { status: 500 }
      );
    }

    if (!isCompletePurgeResult(purgeData, expectedTables)) {
      console.error(
        `[delete-account] Transaction returned an invalid receipt for company ${companyId}`,
        purgeData
      );
      return NextResponse.json(
        {
          success: false,
          manifestVersion: MANIFEST_VERSION,
          companyId,
          error:
            "Account deletion finished, but OPS could not verify the result. Contact support before trying again.",
          databaseCommitted: true,
          steps: { completed: 0, total: expectedTables.length },
          completedSteps: [],
          deletedCounts: {},
        },
        { status: 500 }
      );
    }

    const warnings: Array<{ step: string; message: string }> = [];
    let stripeSummary: { cancelledSubscriptions: number } | null = null;

    try {
      await eraseSiteVisitPrefix(companyId);
    } catch (storageError) {
      const message =
        storageError instanceof Error
          ? storageError.message
          : String(storageError);
      console.error(
        `[delete-account] Site-visit storage erasure failed for company ${companyId}: ${message}`
      );
      warnings.push({
        step: "storage:erase-site-visits",
        message:
          "Company data was deleted. Visit media cleanup is still running and will retry automatically.",
      });
    }

    if (company.stripe_customer_id) {
      try {
        const stripe = getStripe();
        const subscriptions = await stripe.subscriptions.list({
          customer: company.stripe_customer_id as string,
          status: "active",
        });

        for (const subscription of subscriptions.data) {
          await stripe.subscriptions.cancel(subscription.id);
        }
        stripeSummary = { cancelledSubscriptions: subscriptions.data.length };
      } catch (stripeError) {
        const message =
          stripeError instanceof Error ? stripeError.message : String(stripeError);
        console.error(
          `[delete-account] Stripe cancellation failed for company ${companyId}: ${message}`
        );
        warnings.push({
          step: "stripe:cancel-subscriptions",
          message: `Company data was deleted, but billing could not be cancelled: ${message}. Cancel it manually.`,
        });
      }
    }

    console.warn(
      `[delete-account] Company ${companyId} closed atomically — ` +
        `${purgeData.completed_steps} steps, ` +
        `${Object.values(purgeData.deleted_counts).reduce((a, b) => a + b, 0)} rows`
    );

    return NextResponse.json({
      success: true,
      manifestVersion: MANIFEST_VERSION,
      companyId,
      steps: {
        completed: purgeData.completed_steps,
        total: purgeData.total_steps,
      },
      deletedCounts: purgeData.deleted_counts,
      warnings,
      ...(stripeSummary ? { stripe: stripeSummary } : {}),
    });
  } catch (error) {
    console.error("[delete-account] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Couldn't delete the account. Try again.",
        steps: { completed: 0, total: expectedTables.length },
        deletedCounts: {},
      },
      { status: 500 }
    );
  }
}

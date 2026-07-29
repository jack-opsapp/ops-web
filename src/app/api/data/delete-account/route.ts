/**
 * POST /api/data/delete-account
 *
 * Closes a company account: cascades across every table in the company-data
 * manifest, tombstones the company row last, then cancels its Stripe
 * subscriptions.
 *
 * Requires Firebase auth token + settings.company permission + company
 * membership + company-admin standing + a literal "DELETE" confirmation.
 *
 * Body: { idToken: string, companyId: string, confirmText: string }
 *
 * ── Honesty contract (bug 241830b2) ────────────────────────────────────────
 * The previous implementation carried its own eleven-table list — two of those
 * tables did not exist — and logged-and-continued on every per-table error, so
 * it answered `success: true` while leaving virtually all of a company's data
 * in place. This route now guarantees the opposite:
 *
 *   • every table comes from `COMPANY_DATA_MANIFEST`; none is named here;
 *   • any failing step aborts the run immediately and returns 500 naming the
 *     step, the table and the underlying database message;
 *   • `deletedCounts` contains an entry ONLY for a step that actually
 *     completed, so nothing is ever reported deleted that was not;
 *   • because these are sequential PostgREST calls with no cross-table
 *     transaction, a partial deletion is possible — the failure payload
 *     therefore lists exactly how many steps completed out of how many, and
 *     the company row is NOT tombstoned when the cascade did not finish;
 *   • a Stripe cancellation failure no longer disappears into the logs: it is
 *     returned as an explicit, non-fatal `warnings` entry.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import {
  FK_CYCLE_BREAKERS,
  MANIFEST_VERSION,
  deletionPlan,
  type ManifestEntry,
} from "@/lib/data/company-data-manifest";
import {
  CompanyDataScope,
  CompanyDataStepError,
  forEachParentChunk,
} from "@/lib/data/company-data-scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The cascade is ~210 sequential steps. Ordering is load-bearing (a hard
// DELETE fails while a referencing row survives), so the steps cannot be
// parallelised away — give the run the full Vercel ceiling.
export const maxDuration = 300;

type Db = ReturnType<typeof getServiceRoleClient>;

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function operationFor(entry: ManifestEntry): string {
  return entry.deleteStrategy === "soft" ? "soft-delete" : "purge";
}

/** Apply the tombstone filter only where the column actually exists. */
function withSoftFilter(query: any, entry: ManifestEntry): any {
  return entry.deleteStrategy === "soft" ? query.is("deleted_at", null) : query;
}

/**
 * Null the nullable side of each mutual foreign-key cycle. Every row touched
 * is deleted moments later, so this destroys nothing — it only turns a cycle
 * that no delete order can satisfy into an ordinary chain.
 */
async function breakForeignKeyCycles(db: Db, companyId: string): Promise<void> {
  for (const breaker of FK_CYCLE_BREAKERS) {
    const { error } = await (db as any)
      .from(breaker.table)
      .update({ [breaker.column]: null })
      .eq(breaker.companyColumn, companyId)
      .not(breaker.column, "is", null);

    if (error) {
      throw new CompanyDataStepError(
        breaker.table,
        `break foreign-key cycle on ${breaker.column} of`,
        error
      );
    }
  }
}

/** Count, then act. Returns the number of rows the step actually removed. */
async function executeStep(
  db: Db,
  scope: CompanyDataScope,
  entry: ManifestEntry,
  now: string,
  companyId: string
): Promise<number> {
  const operation = operationFor(entry);
  const mutate = (query: any) =>
    entry.deleteStrategy === "soft"
      ? query.update({ deleted_at: now })
      : query.delete();

  if (entry.scope === "company") {
    const applyScope = (query: any) =>
      withSoftFilter(query.eq(entry.companyColumn, companyId), entry);

    const { count, error: countError } = await applyScope(
      (db as any).from(entry.table).select("*", { count: "exact", head: true })
    );
    if (countError) {
      throw new CompanyDataStepError(entry.table, `count rows to ${operation} in`, countError);
    }

    const { error } = await applyScope(mutate((db as any).from(entry.table)));
    if (error) throw new CompanyDataStepError(entry.table, operation, error);

    return count ?? 0;
  }

  const counts = await forEachParentChunk(
    scope,
    entry.parentTable,
    async (chunk) => {
      const applyScope = (query: any) =>
        withSoftFilter(query.in(entry.parentColumn, chunk), entry);

      const { count, error: countError } = await applyScope(
        (db as any).from(entry.table).select("*", { count: "exact", head: true })
      );
      if (countError) {
        throw new CompanyDataStepError(entry.table, `count rows to ${operation} in`, countError);
      }

      const { error } = await applyScope(mutate((db as any).from(entry.table)));
      if (error) throw new CompanyDataStepError(entry.table, operation, error);

      return count ?? 0;
    }
  );

  return counts.reduce((total, n) => total + n, 0);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deletedCounts: Record<string, number> = {};
  const plan = deletionPlan();

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
        { error: "Please type DELETE to confirm account deletion" },
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
        { error: "You don't have permission to delete accounts" },
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

    const { data: company } = await db
      .from("companies")
      .select("id, admin_ids, stripe_customer_id")
      .eq("id", companyId)
      .is("deleted_at", null)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const adminIds = (company.admin_ids as string[]) ?? [];
    const isAdmin =
      user.is_company_admin || adminIds.includes(user.id as string);

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only company admins can delete the account" },
        { status: 403 }
      );
    }

    // ─── Cascade ─────────────────────────────────────────────────────────────

    const now = new Date().toISOString();
    const scope = new CompanyDataScope(db, companyId);

    try {
      // Parent ids first, while every parent is still readable. A tombstoned or
      // purged parent can no longer name its children.
      for (const entry of plan) {
        if (entry.scope === "parent") await scope.idsFor(entry.parentTable);
      }

      await breakForeignKeyCycles(db, companyId);

      for (const entry of plan) {
        deletedCounts[entry.table] = await executeStep(
          db,
          scope,
          entry,
          now,
          companyId
        );
      }
    } catch (stepError) {
      if (!(stepError instanceof CompanyDataStepError)) throw stepError;

      const completed = Object.keys(deletedCounts).length;
      console.error(
        `[delete-account] Cascade stopped for company ${companyId} at step ` +
          `${completed + 1}/${plan.length} (${stepError.operation} ${stepError.table}): ` +
          `${stepError.databaseMessage}`
      );

      return NextResponse.json(
        {
          success: false,
          manifestVersion: MANIFEST_VERSION,
          companyId,
          error:
            `Account deletion stopped at step ${completed + 1} of ${plan.length}: ` +
            `${stepError.operation} ${stepError.table} — ${stepError.databaseMessage}. ` +
            `${completed} step(s) had already completed and were NOT rolled back; ` +
            `the company has not been closed.`,
          failedStep: {
            index: completed + 1,
            table: stepError.table,
            operation: stepError.operation,
            message: stepError.databaseMessage,
            ...(stepError.code ? { code: stepError.code } : {}),
            ...(stepError.details ? { details: stepError.details } : {}),
          },
          steps: { completed, total: plan.length },
          completedSteps: Object.keys(deletedCounts),
          deletedCounts,
        },
        { status: 500 }
      );
    }

    // ─── Stripe ──────────────────────────────────────────────────────────────

    const warnings: Array<{ step: string; message: string }> = [];
    let stripeSummary: { cancelledSubscriptions: number } | null = null;

    if (company.stripe_customer_id) {
      try {
        const stripe = getStripe();
        const subscriptions = await stripe.subscriptions.list({
          customer: company.stripe_customer_id as string,
          status: "active",
        });

        for (const sub of subscriptions.data) {
          await stripe.subscriptions.cancel(sub.id);
        }

        stripeSummary = { cancelledSubscriptions: subscriptions.data.length };
      } catch (stripeError) {
        const message =
          stripeError instanceof Error
            ? stripeError.message
            : String(stripeError);
        console.error(
          `[delete-account] Stripe cancellation failed for company ${companyId}: ${message}`
        );
        warnings.push({
          step: "stripe:cancel-subscriptions",
          message: `Company data was deleted, but the Stripe subscriptions could not be cancelled: ${message}. Cancel them manually.`,
        });
      }
    }

    // Warn level deliberately: closing an account is irreversible and worth
    // surfacing in log aggregation alongside the failures, not buried in info.
    console.warn(
      `[delete-account] Company ${companyId} closed — ${plan.length} steps, ` +
        `${Object.values(deletedCounts).reduce((a, b) => a + b, 0)} rows`
    );

    return NextResponse.json({
      success: true,
      manifestVersion: MANIFEST_VERSION,
      companyId,
      steps: { completed: Object.keys(deletedCounts).length, total: plan.length },
      deletedCounts,
      warnings,
      ...(stripeSummary ? { stripe: stripeSummary } : {}),
    });
  } catch (error) {
    console.error("[delete-account] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Deletion failed",
        steps: {
          completed: Object.keys(deletedCounts).length,
          total: plan.length,
        },
        deletedCounts,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/data/export
 *
 * Streams everything a company owns as a JSON file download.
 * Requires Firebase auth token + settings.company permission + membership.
 *
 * Body: { idToken: string, companyId: string }
 *
 * ── Honesty contract (bug 241830b2) ────────────────────────────────────────
 * The previous implementation fetched eleven hardcoded entities, three of
 * which named tables that do not exist (`tasks`, `estimate_line_items`,
 * `invoice_line_items`), and turned every fetch error into an empty array — so
 * every export ever produced was missing tasks and all line items, silently.
 *
 * The export now runs off `COMPANY_DATA_MANIFEST`, the same inventory the
 * deletion cascade uses. It carries the customer's own records and deliberately
 * leaves out internal machinery — queues, outboxes, staging, telemetry — and
 * anything holding a credential. A failing table returns 500 naming it; no
 * partial file is ever streamed.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import {
  MANIFEST_VERSION,
  exportPlan,
  type ManifestEntry,
} from "@/lib/data/company-data-manifest";
import {
  CompanyDataScope,
  CompanyDataStepError,
  forEachParentChunk,
} from "@/lib/data/company-data-scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ~100 sequential reads across a company's whole history.
export const maxDuration = 300;

type Db = ReturnType<typeof getServiceRoleClient>;

/** Apply the tombstone filter only where the column actually exists. */
function withSoftFilter(query: any, entry: ManifestEntry): any {
  return entry.softDeletable ? query.is("deleted_at", null) : query;
}

async function fetchEntry(
  db: Db,
  scope: CompanyDataScope,
  entry: ManifestEntry,
  companyId: string
): Promise<unknown[]> {
  if (entry.scope === "company") {
    const { data, error } = await withSoftFilter(
      (db as any)
        .from(entry.table)
        .select("*")
        .eq(entry.companyColumn, companyId),
      entry
    );
    if (error) throw new CompanyDataStepError(entry.table, "export", error);
    return (data as unknown[]) ?? [];
  }

  const pages = await forEachParentChunk(
    scope,
    entry.parentTable,
    async (chunk) => {
      const { data, error } = await withSoftFilter(
        (db as any).from(entry.table).select("*").in(entry.parentColumn, chunk),
        entry
      );
      if (error) throw new CompanyDataStepError(entry.table, "export", error);
      return (data as unknown[]) ?? [];
    }
  );

  return pages.flat();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { idToken, companyId } = await req.json();

    if (!idToken || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, companyId" },
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
        { error: "You don't have permission to export data" },
        { status: 403 }
      );
    }

    const db = getServiceRoleClient();

    const user = await findUserByAuth(
      firebaseUser.uid,
      firebaseUser.email,
      "id, company_id"
    );

    if (!user || user.company_id !== companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: company } = await db
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .is("deleted_at", null)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const plan = exportPlan();
    const scope = new CompanyDataScope(db, companyId);
    const tables: Record<string, unknown[]> = {};

    try {
      for (const entry of plan) {
        tables[entry.table] = await fetchEntry(db, scope, entry, companyId);
      }
    } catch (stepError) {
      if (!(stepError instanceof CompanyDataStepError)) throw stepError;

      console.error(
        `[data/export] Export aborted for company ${companyId} at ${stepError.table}: ` +
          `${stepError.databaseMessage}`
      );

      return NextResponse.json(
        {
          error:
            `Export failed while reading ${stepError.table} — ` +
            `${stepError.databaseMessage}. No file was produced.`,
          failedStep: {
            table: stepError.table,
            operation: stepError.operation,
            message: stepError.databaseMessage,
            ...(stepError.code ? { code: stepError.code } : {}),
          },
        },
        { status: 500 }
      );
    }

    const json = JSON.stringify(
      {
        manifestVersion: MANIFEST_VERSION,
        exportedAt: new Date().toISOString(),
        companyId,
        tableCount: plan.length,
        tables,
      },
      null,
      2
    );

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="ops-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error("[data/export] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}

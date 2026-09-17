/**
 * GET /api/expenses/batches/[batchId]/export
 *
 * Downloads one person's expenses for one period as a branded .xlsx — the
 * document the crew used to build by hand in a spreadsheet template and email
 * to the office.
 *
 * Read-only. Gated on the permission model, never on a role name: the office
 * (`expenses.approve`) can export anyone's envelope; everyone else can export
 * only their own, and only if they can see expenses at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getCompanyLocale } from "@/i18n/server-render";
import { loadExpenseExportSource } from "@/lib/expenses/export/expense-export-source";
import { resolveExportLabels } from "@/lib/expenses/export/expense-export-labels";
import { fetchExportLogo } from "@/lib/expenses/export/expense-export-logo";
import { buildExpenseExportDocument } from "@/lib/expenses/export/expense-export-model";
import { writeExpenseWorkbook } from "@/lib/expenses/export/expense-workbook";

export const maxDuration = 30;

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** RFC 5987 — keeps accented names intact without breaking older clients. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await context.params;

    const user = await verifyAdminAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRow = await findUserByAuth(user.uid, user.email, "id, company_id");
    if (!userRow?.company_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = String(userRow.id);
    const companyId = String(userRow.company_id);

    // Company-scoped: a batch from another company is simply not found.
    const source = await loadExpenseExportSource(batchId, companyId);
    if (!source) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const canReviewAll = await checkPermissionById(userId, "expenses.approve", "all");
    const isOwnBatch = source.submittedBy === userId;
    const canSeeOwn = isOwnBatch
      ? await checkPermissionById(userId, "expenses.view", "own")
      : false;

    if (!canReviewAll && !canSeeOwn) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The company's locale, not the exporter's — two admins reading the app in
    // different languages must not produce different copies of one record.
    const locale = await getCompanyLocale(companyId);
    const [labels, logo] = await Promise.all([
      resolveExportLabels(locale),
      fetchExportLogo(source.company.logoUrl),
    ]);

    const document = buildExpenseExportDocument({
      batch: source.batch,
      lines: source.lines,
      company: source.company,
      person: source.person,
      accentColor: source.accentColor,
      labels,
      locale,
    });

    const workbook = await writeExpenseWorkbook(document, logo);

    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": contentDisposition(document.filename),
        "Content-Length": String(workbook.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[expenses/export] failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

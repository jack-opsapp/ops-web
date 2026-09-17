/**
 * Loads everything the export document needs, server-side.
 *
 * Deliberately does NOT reuse the console's line loader: that one collapses a
 * split expense to `allocations[0]` (expense-approval-service.ts), which is
 * fine for a scan row but would silently hide half of a split job on a document
 * the office files. This reads every allocation.
 *
 * Read-only. Nothing here writes.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  ExportBatchInput,
  ExportCompanyInput,
  ExportLineInput,
  ExportPersonInput,
} from "./expense-export-model";

export interface ExpenseExportSource {
  batch: ExportBatchInput;
  lines: ExportLineInput[];
  company: ExportCompanyInput;
  person: ExportPersonInput;
  accentColor: string;
  /** Who the batch belongs to — the permission check needs it. */
  submittedBy: string | null;
}

const DEFAULT_ACCENT = "#417394";

function num(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function str(value: unknown): string | null {
  return value == null ? null : String(value);
}

/**
 * Load a batch scoped to its company. `batch_number` is not unique across
 * companies and neither is anything else here — every read is company-scoped.
 */
export async function loadExpenseExportSource(
  batchId: string,
  companyId: string
): Promise<ExpenseExportSource | null> {
  const db = getServiceRoleClient();

  const { data: batchRow } = await db
    .from("expense_batches")
    .select(
      "id, company_id, batch_number, period_start, period_end, status, submitted_by, total_amount, approved_amount, reimbursement_amount"
    )
    .eq("id", batchId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!batchRow) return null;
  const batchData = batchRow as Record<string, unknown>;

  const [expenseRes, companyRes, brandingRes, personRes] = await Promise.all([
    db
      .from("expenses")
      .select(
        "id, expense_date, merchant_name, description, amount, tax_amount, currency, status, payment_method, recurring_reimbursement_id, receipt_missing_reason, receipt_missing_note, rejection_reason"
      )
      .eq("batch_id", batchId)
      .eq("company_id", companyId)
      .is("deleted_at", null),
    db
      .from("companies")
      .select("name, address, physical_address, phone, email, website, logo_url")
      .eq("id", companyId)
      .maybeSingle(),
    db
      .from("portal_branding")
      .select("accent_color, logo_url")
      .eq("company_id", companyId)
      .maybeSingle(),
    batchData.submitted_by
      ? db
          .from("users")
          .select("first_name, last_name, email, phone, home_address")
          .eq("id", batchData.submitted_by as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const expenseRows = (expenseRes.data ?? []) as Record<string, unknown>[];
  const allocationsByExpense = await loadAllocations(
    expenseRows.map((e) => e.id as string)
  );

  const companyData = (companyRes.data ?? {}) as Record<string, unknown>;
  const brandingData = (brandingRes.data ?? {}) as Record<string, unknown>;
  const personData = (personRes.data ?? {}) as Record<string, unknown> | null;

  const company: ExportCompanyInput = {
    name: str(companyData.name),
    // physical_address is the street the business actually operates from; the
    // mailing address is the fallback.
    address: str(companyData.physical_address) ?? str(companyData.address),
    phone: str(companyData.phone),
    email: str(companyData.email),
    website: str(companyData.website),
    // The same resolution the estimate/invoice PDFs use — one brand source.
    logoUrl: str(brandingData.logo_url) ?? str(companyData.logo_url),
  };

  return {
    batch: {
      batchNumber: String(batchData.batch_number ?? ""),
      periodStart: str(batchData.period_start),
      periodEnd: str(batchData.period_end),
      status: String(batchData.status ?? ""),
      totalAmount: num(batchData.total_amount),
      approvedAmount: num(batchData.approved_amount),
      reimbursementAmount: num(batchData.reimbursement_amount),
    },
    lines: expenseRows.map((row) => ({
      id: String(row.id),
      expenseDate: str(row.expense_date),
      merchantName: str(row.merchant_name),
      description: str(row.description),
      amount: Number(row.amount ?? 0),
      taxAmount: num(row.tax_amount),
      currency: str(row.currency),
      status: str(row.status),
      paymentMethod: str(row.payment_method),
      isRecurring: row.recurring_reimbursement_id != null,
      receiptMissingReason: str(row.receipt_missing_reason),
      receiptMissingNote: str(row.receipt_missing_note),
      rejectionReason: str(row.rejection_reason),
      allocations: allocationsByExpense.get(String(row.id)) ?? [],
    })),
    company,
    person: {
      firstName: str(personData?.first_name),
      lastName: str(personData?.last_name),
      email: str(personData?.email),
      phone: str(personData?.phone),
      homeAddress: str(personData?.home_address),
    },
    accentColor: str(brandingData.accent_color) ?? DEFAULT_ACCENT,
    submittedBy: str(batchData.submitted_by),
  };
}

/**
 * `expense_project_allocations.project_id` is TEXT with no foreign key, so
 * PostgREST cannot join it — collect the ids and resolve titles in one query,
 * exactly as the console's service does.
 */
async function loadAllocations(
  expenseIds: string[]
): Promise<Map<string, ExportLineInput["allocations"]>> {
  const byExpense = new Map<string, ExportLineInput["allocations"]>();
  if (expenseIds.length === 0) return byExpense;

  const db = getServiceRoleClient();
  const { data: allocationRows } = await db
    .from("expense_project_allocations")
    .select("expense_id, project_id, percentage")
    .in("expense_id", expenseIds);

  const rows = (allocationRows ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return byExpense;

  const projectIds = [...new Set(rows.map((r) => String(r.project_id)))];
  const { data: projectRows } = await db
    .from("projects")
    .select("id, title")
    .in("id", projectIds);

  const titleById = new Map<string, string>();
  for (const project of (projectRows ?? []) as Record<string, unknown>[]) {
    if (project.id != null && project.title != null) {
      titleById.set(String(project.id), String(project.title));
    }
  }

  for (const row of rows) {
    const expenseId = String(row.expense_id);
    const projectId = String(row.project_id);
    const list = byExpense.get(expenseId) ?? [];
    list.push({
      projectId,
      projectTitle: titleById.get(projectId) ?? null,
      percentage: Number(row.percentage ?? 0),
    });
    byExpense.set(expenseId, list);
  }

  // Biggest share first, so a split reads as its dominant job then the rest.
  for (const list of byExpense.values()) {
    list.sort((a, b) => b.percentage - a.percentage);
  }
  return byExpense;
}

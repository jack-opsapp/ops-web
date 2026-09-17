/**
 * OPS Web - Recurring Reimbursement Service
 *
 * A recurring reimbursement is a fixed monthly amount the office pays a crew
 * member with their expenses (e.g. vehicle advertising). The database owns the
 * whole lifecycle: it files one pre-approved line per month into the person's
 * envelope, and every change goes through a SECURITY DEFINER command that
 * checks `expenses.approve`, locks the company's expenses and notifies the
 * crew member. This service only reads the setups and calls those commands.
 *
 * Every change carries the setup's `updated_at` as an optimistic-concurrency
 * token; a stale form is refused rather than overwriting newer work.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ExpenseBatchUser,
  ExpenseRecurringReimbursement,
  RecurringLineSummary,
  RecurringReimbursementsSnapshot,
} from "@/lib/types/expense-approval";

/** A refused command. `message` is the server's; `code` is the SQLSTATE. */
export class RecurringReimbursementError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "RecurringReimbursementError";
    this.code = code;
  }
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export function mapRecurringReimbursementFromDb(row: Record<string, unknown>): ExpenseRecurringReimbursement {
  const lines = Array.isArray(row.lines)
    ? (row.lines as Record<string, unknown>[]).map(mapRecurringLineFromReceipt)
    : [];
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    userId: row.user_id as string,
    name: row.name as string,
    amount: Number(row.amount),
    currency: row.currency as string,
    categoryId: (row.category_id as string) ?? null,
    firstPeriod: row.first_period as string,
    lastPeriod: (row.last_period as string) ?? null,
    nextPeriod: row.next_period as string,
    createdBy: row.created_by as string,
    updatedBy: row.updated_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
    lines: sortLines(lines),
  };
}

function mapRecurringLineFromReceipt(row: Record<string, unknown>): RecurringLineSummary {
  return {
    expenseId: row.expense_id as string,
    period: row.period as string,
    batchId: (row.batch_id as string) ?? null,
    status: row.status as string,
    amount: Number(row.amount),
    deleted: row.deleted === true,
  };
}

function mapRecurringLineFromExpense(row: Record<string, unknown>): RecurringLineSummary {
  return {
    expenseId: row.id as string,
    period: row.recurring_period as string,
    batchId: (row.batch_id as string) ?? null,
    status: row.status as string,
    amount: Number(row.amount),
    deleted: row.deleted_at != null,
  };
}

function sortLines(lines: RecurringLineSummary[]): RecurringLineSummary[] {
  return [...lines].sort((a, b) => a.period.localeCompare(b.period));
}

function mapUser(row: Record<string, unknown>): ExpenseBatchUser {
  return {
    id: row.id as string,
    firstName: (row.first_name as string) ?? null,
    lastName: (row.last_name as string) ?? null,
    email: (row.email as string) ?? null,
    profileImageUrl: (row.profile_image_url as string) ?? null,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface CreateRecurringReimbursementInput {
  userId: string;
  name: string;
  amount: number;
  /** Any date in the first month; the database normalises to its first day. */
  firstPeriod: string;
  categoryId: string | null;
}

export interface UpdateRecurringReimbursementInput {
  id: string;
  name: string;
  amount: number;
  categoryId: string | null;
  expectedUpdatedAt: string;
}

async function command(name: string, args: Record<string, unknown>): Promise<ExpenseRecurringReimbursement> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw new RecurringReimbursementError(error.message, (error as { code?: string }).code ?? null);
  }
  return mapRecurringReimbursementFromDb(data as Record<string, unknown>);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ExpenseRecurringReimbursementService = {
  /** Live setups for the company, with every month's line, person and category. */
  async fetchCompany(companyId: string): Promise<RecurringReimbursementsSnapshot> {
    const supabase = requireSupabase();

    const [{ data: company, error: companyError }, { data: setupRows, error }] = await Promise.all([
      supabase.from("companies").select("currency_code, timezone").eq("id", companyId).maybeSingle(),
      supabase
        .from("expense_recurring_reimbursements")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
    ]);

    if (error) throw new Error(`Failed to fetch recurring reimbursements: ${error.message}`);
    if (companyError) throw new Error(`Failed to fetch company calendar: ${companyError.message}`);

    const companyRow = (company ?? {}) as Record<string, unknown>;
    const currency = ((companyRow.currency_code as string) || "USD").toUpperCase();
    const timeZone = (companyRow.timezone as string) ?? null;

    const setups = ((setupRows ?? []) as Record<string, unknown>[]).map(mapRecurringReimbursementFromDb);
    if (setups.length === 0) return { setups, currency, timeZone };

    const setupIds = setups.map((s) => s.id);
    const userIds = [...new Set(setups.map((s) => s.userId))];
    const categoryIds = [...new Set(setups.map((s) => s.categoryId).filter((id): id is string => !!id))];

    const [lineResult, userResult, categoryResult] = await Promise.all([
      supabase
        .from("expenses")
        .select("id, recurring_reimbursement_id, recurring_period, batch_id, status, amount, deleted_at")
        .in("recurring_reimbursement_id", setupIds),
      supabase.from("users").select("id, first_name, last_name, email, profile_image_url").in("id", userIds),
      categoryIds.length > 0
        ? supabase.from("expense_categories").select("id, name").in("id", categoryIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (lineResult.error) throw new Error(`Failed to fetch recurring months: ${lineResult.error.message}`);
    // Names are presentation only; a failed join never hides the money.
    if (userResult.error) console.warn(`Failed to resolve recurring reimbursement people: ${userResult.error.message}`);
    if (categoryResult.error) console.warn(`Failed to resolve recurring categories: ${categoryResult.error.message}`);

    const linesBySetup = new Map<string, RecurringLineSummary[]>();
    for (const row of (lineResult.data ?? []) as Record<string, unknown>[]) {
      const setupId = row.recurring_reimbursement_id as string;
      const list = linesBySetup.get(setupId) ?? [];
      list.push(mapRecurringLineFromExpense(row));
      linesBySetup.set(setupId, list);
    }
    const users = new Map(
      ((userResult.data ?? []) as Record<string, unknown>[]).map((row) => [row.id as string, mapUser(row)])
    );
    const categories = new Map(
      ((categoryResult.data ?? []) as Record<string, unknown>[]).map((row) => [row.id as string, row.name as string])
    );

    return {
      currency,
      timeZone,
      setups: setups.map((setup) => ({
        ...setup,
        lines: sortLines(linesBySetup.get(setup.id) ?? []),
        person: users.get(setup.userId) ?? null,
        categoryName: setup.categoryId ? categories.get(setup.categoryId) ?? null : null,
      })),
    };
  },

  create(input: CreateRecurringReimbursementInput) {
    return command("create_expense_recurring_reimbursement", {
      p_user_id: input.userId,
      p_name: input.name,
      p_amount: input.amount,
      p_first_period: input.firstPeriod,
      p_category_id: input.categoryId,
    });
  },

  update(input: UpdateRecurringReimbursementInput) {
    return command("update_expense_recurring_reimbursement", {
      p_id: input.id,
      p_name: input.name,
      p_amount: input.amount,
      p_category_id: input.categoryId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },

  /** Sets the last month paid, or clears it (null) so it runs again from this month. */
  end(id: string, lastPeriod: string | null, expectedUpdatedAt: string) {
    return command("end_expense_recurring_reimbursement", {
      p_id: id,
      p_last_period: lastPeriod,
      p_expected_updated_at: expectedUpdatedAt,
    });
  },

  /** Removes a setup made in error with every month. Refused once a month is paid. */
  remove(id: string, expectedUpdatedAt: string) {
    return command("delete_expense_recurring_reimbursement", {
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
    });
  },

  /** Leaves one unpaid month out. */
  skipLine(expenseId: string) {
    return command("skip_expense_recurring_reimbursement_line", { p_expense_id: expenseId });
  },

  /** Puts a skipped month back at the current amount. */
  restoreLine(expenseId: string) {
    return command("restore_expense_recurring_reimbursement_line", { p_expense_id: expenseId });
  },
};

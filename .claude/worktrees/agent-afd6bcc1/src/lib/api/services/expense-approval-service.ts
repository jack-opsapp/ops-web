/**
 * OPS Web - Expense Approval Service
 *
 * Supabase service for the expense approval workflow: fetching batches,
 * flagging/unflagging line items, approving/rejecting batches, and managing
 * auto-approve rules.
 *
 * IMPORTANT: expense_batches.submitted_by has NO foreign key to users.
 * User data is fetched separately and merged at the application layer.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ExpenseBatch,
  ExpenseBatchUser,
  ExpenseLineItem,
  AutoApproveRule,
  AutoApproveRuleMember,
  CreateAutoApproveRule,
} from "@/lib/types/expense-approval";
import { ExpenseBatchStatus, AutoApproveRuleType } from "@/lib/types/expense-approval";

// ─── Database → TypeScript Mapping ────────────────────────────────────────────

function mapBatchFromDb(row: Record<string, unknown>): ExpenseBatch {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    batchNumber: row.batch_number as string,
    periodStart: (row.period_start as string) ?? null,
    periodEnd: (row.period_end as string) ?? null,
    status: row.status as ExpenseBatchStatus,
    submittedBy: (row.submitted_by as string) ?? null,
    reviewedBy: (row.reviewed_by as string) ?? null,
    reviewedAt: (row.reviewed_at as string) ?? null,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
    approvedAmount: row.approved_amount != null ? Number(row.approved_amount) : null,
    parentBatchId: (row.parent_batch_id as string) ?? null,
    amendmentNumber: row.amendment_number != null ? Number(row.amendment_number) : 0,
    reviewNotes: (row.review_notes as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? undefined,
  };
}

function mapUserFromDb(row: Record<string, unknown>): ExpenseBatchUser {
  return {
    id: row.id as string,
    firstName: (row.first_name as string) ?? null,
    lastName: (row.last_name as string) ?? null,
    email: (row.email as string) ?? null,
    profileImageUrl: (row.profile_image_url as string) ?? null,
  };
}

function mapExpenseFromDb(row: Record<string, unknown>): ExpenseLineItem {
  // Extract joined category name
  const category = row.expense_categories as Record<string, unknown> | null;
  const categoryName = category?.name as string | null ?? null;

  // Extract joined project allocation project_id
  const allocations = row.expense_project_allocations as
    | Record<string, unknown>[]
    | null;
  const projectId =
    allocations && allocations.length > 0
      ? (allocations[0].project_id as string) ?? null
      : null;

  return {
    id: row.id as string,
    companyId: row.company_id as string,
    submittedBy: row.submitted_by as string,
    batchId: (row.batch_id as string) ?? null,
    status: (row.status as string) ?? null,
    categoryId: (row.category_id as string) ?? null,
    merchantName: (row.merchant_name as string) ?? null,
    description: (row.description as string) ?? null,
    amount: Number(row.amount),
    taxAmount: row.tax_amount != null ? Number(row.tax_amount) : null,
    currency: (row.currency as string) ?? null,
    expenseDate: (row.expense_date as string) ?? null,
    paymentMethod: (row.payment_method as string) ?? null,
    receiptImageUrl: (row.receipt_image_url as string) ?? null,
    receiptThumbnailUrl: (row.receipt_thumbnail_url as string) ?? null,
    ocrRawData: row.ocr_raw_data ?? null,
    ocrConfidence: row.ocr_confidence != null ? Number(row.ocr_confidence) : null,
    approvedBy: (row.approved_by as string) ?? null,
    approvedAt: (row.approved_at as string) ?? null,
    rejectedBy: (row.rejected_by as string) ?? null,
    rejectedAt: (row.rejected_at as string) ?? null,
    rejectionReason: (row.rejection_reason as string) ?? null,
    accountingSyncStatus: (row.accounting_sync_status as string) ?? null,
    accountingSyncId: (row.accounting_sync_id as string) ?? null,
    accountingSyncedAt: (row.accounting_synced_at as string) ?? null,
    flagComment: (row.flag_comment as string) ?? null,
    flaggedBy: (row.flagged_by as string) ?? null,
    flaggedAt: (row.flagged_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
    categoryName,
    projectId,
  };
}

function mapAutoApproveRuleFromDb(
  row: Record<string, unknown>,
  members: AutoApproveRuleMember[]
): AutoApproveRule {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    createdBy: row.created_by as string,
    ruleType: row.rule_type as AutoApproveRuleType,
    thresholdAmount: Number(row.threshold_amount),
    appliesToAll: row.applies_to_all as boolean,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    members,
  };
}

function mapRuleMemberFromDb(row: Record<string, unknown>): AutoApproveRuleMember {
  return {
    id: row.id as string,
    ruleId: row.rule_id as string,
    userId: row.user_id as string,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ExpenseApprovalService = {
  // ── Batch Fetching ────────────────────────────────────────────────────────

  /**
   * Fetch all expense batches for a company.
   * Because submitted_by has no FK to users, we fetch users separately and
   * merge them onto each batch as the `submitter` field.
   */
  async fetchBatches(companyId: string): Promise<ExpenseBatch[]> {
    const supabase = requireSupabase();

    // 1. Fetch batches (no user join possible)
    const { data: batchRows, error } = await supabase
      .from("expense_batches")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch expense batches: ${error.message}`);
    if (!batchRows || batchRows.length === 0) return [];

    const batches = batchRows.map((r) => mapBatchFromDb(r as Record<string, unknown>));

    // 2. Collect unique submitted_by UUIDs
    const submitterIds = [
      ...new Set(
        batches
          .map((b) => b.submittedBy)
          .filter((id): id is string => id != null)
      ),
    ];

    if (submitterIds.length === 0) return batches;

    // 3. Fetch user rows
    const { data: userRows, error: userError } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, profile_image_url")
      .in("id", submitterIds);

    if (userError) {
      // Non-fatal: return batches without submitter info
      console.warn(`Failed to fetch submitter users: ${userError.message}`);
      return batches;
    }

    // 4. Build lookup map and merge
    const userMap = new Map<string, ExpenseBatchUser>();
    for (const row of userRows ?? []) {
      const user = mapUserFromDb(row as Record<string, unknown>);
      userMap.set(user.id, user);
    }

    for (const batch of batches) {
      batch.submitter = batch.submittedBy
        ? userMap.get(batch.submittedBy) ?? null
        : null;
    }

    return batches;
  },

  /**
   * Fetch expense line items for a specific batch.
   * Joins expense_categories for name and expense_project_allocations for project_id.
   * Excludes soft-deleted rows.
   */
  async fetchBatchExpenses(batchId: string): Promise<ExpenseLineItem[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("expenses")
      .select(
        "*, expense_categories(name), expense_project_allocations(project_id)"
      )
      .eq("batch_id", batchId)
      .is("deleted_at", null)
      .order("expense_date", { ascending: true });

    if (error) throw new Error(`Failed to fetch batch expenses: ${error.message}`);
    if (!data) return [];

    return data.map((r) => mapExpenseFromDb(r as Record<string, unknown>));
  },

  // ── Flagging ──────────────────────────────────────────────────────────────

  /**
   * Flag an individual expense with a comment.
   */
  async flagExpense(
    expenseId: string,
    flaggedBy: string,
    comment: string
  ): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expenses")
      .update({
        flag_comment: comment,
        flagged_by: flaggedBy,
        flagged_at: new Date().toISOString(),
      })
      .eq("id", expenseId);

    if (error) throw new Error(`Failed to flag expense: ${error.message}`);
  },

  /**
   * Remove the flag from an expense.
   */
  async unflagExpense(expenseId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expenses")
      .update({
        flag_comment: null,
        flagged_by: null,
        flagged_at: null,
      })
      .eq("id", expenseId);

    if (error) throw new Error(`Failed to unflag expense: ${error.message}`);
  },

  // ── Approval / Rejection ──────────────────────────────────────────────────

  /**
   * Approve an entire batch.
   */
  async approveBatch(
    batchId: string,
    reviewedBy: string,
    approvedAmount: number
  ): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expense_batches")
      .update({
        status: ExpenseBatchStatus.Approved,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        approved_amount: approvedAmount,
      })
      .eq("id", batchId);

    if (error) throw new Error(`Failed to approve batch: ${error.message}`);
  },

  /**
   * Bulk-approve individual expenses.
   */
  async approveExpenses(
    expenseIds: string[],
    approvedBy: string
  ): Promise<void> {
    if (expenseIds.length === 0) return;

    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expenses")
      .update({
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .in("id", expenseIds);

    if (error) throw new Error(`Failed to approve expenses: ${error.message}`);
  },

  /**
   * Reject a batch with revisions:
   * 1. Approve clean (unflagged) expenses
   * 2. Mark original batch as partially_approved
   * 3. Create an amendment batch for flagged items
   * 4. Move flagged expenses to the amendment batch
   * 5. Reject flagged expenses with individual comments
   */
  async rejectWithRevisions(
    batchId: string,
    batch: ExpenseBatch,
    reviewedBy: string,
    reviewNotes: string | null,
    flaggedExpenseIds: string[],
    cleanExpenseIds: string[],
    flagComments: Record<string, string>,
    cleanTotal: number,
    flaggedTotal: number
  ): Promise<void> {
    const supabase = requireSupabase();
    const now = new Date().toISOString();

    // 1. Approve clean expenses
    if (cleanExpenseIds.length > 0) {
      const { error: cleanError } = await supabase
        .from("expenses")
        .update({
          status: "approved",
          approved_by: reviewedBy,
          approved_at: now,
        })
        .in("id", cleanExpenseIds);

      if (cleanError) {
        throw new Error(`Failed to approve clean expenses: ${cleanError.message}`);
      }
    }

    // 2. Mark original batch as partially_approved
    const { error: batchError } = await supabase
      .from("expense_batches")
      .update({
        status: ExpenseBatchStatus.PartiallyApproved,
        reviewed_by: reviewedBy,
        reviewed_at: now,
        approved_amount: cleanTotal,
        review_notes: reviewNotes,
      })
      .eq("id", batchId);

    if (batchError) {
      throw new Error(`Failed to update batch status: ${batchError.message}`);
    }

    // 3. Create amendment batch for flagged items
    const amendmentNumber = (batch.amendmentNumber ?? 0) + 1;

    const { data: amendmentData, error: amendmentError } = await supabase
      .from("expense_batches")
      .insert({
        company_id: batch.companyId,
        batch_number: `${batch.batchNumber}-A${amendmentNumber}`,
        period_start: batch.periodStart,
        period_end: batch.periodEnd,
        status: ExpenseBatchStatus.Rejected,
        submitted_by: batch.submittedBy,
        total_amount: flaggedTotal,
        parent_batch_id: batchId,
        amendment_number: amendmentNumber,
      })
      .select("id")
      .single();

    if (amendmentError) {
      throw new Error(`Failed to create amendment batch: ${amendmentError.message}`);
    }

    const amendmentBatchId = (amendmentData as Record<string, unknown>).id as string;

    // 4. Move flagged expenses to amendment batch
    if (flaggedExpenseIds.length > 0) {
      const { error: moveError } = await supabase
        .from("expenses")
        .update({ batch_id: amendmentBatchId })
        .in("id", flaggedExpenseIds);

      if (moveError) {
        throw new Error(`Failed to move flagged expenses: ${moveError.message}`);
      }

      // 5. Reject flagged expenses with individual comments
      for (const expenseId of flaggedExpenseIds) {
        const comment = flagComments[expenseId] ?? "";
        const { error: rejectError } = await supabase
          .from("expenses")
          .update({
            status: "rejected",
            rejected_by: reviewedBy,
            rejected_at: now,
            rejection_reason: comment,
          })
          .eq("id", expenseId);

        if (rejectError) {
          throw new Error(
            `Failed to reject expense ${expenseId}: ${rejectError.message}`
          );
        }
      }
    }
  },

  // ── Auto-Approve Rules ────────────────────────────────────────────────────

  /**
   * Fetch all auto-approve rules for a company, including their member lists.
   */
  async fetchAutoApproveRules(companyId: string): Promise<AutoApproveRule[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("expense_auto_approve_rules")
      .select("*, expense_auto_approve_rule_members(*)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch auto-approve rules: ${error.message}`);
    if (!data) return [];

    return data.map((row) => {
      const r = row as Record<string, unknown>;
      const memberRows = (r.expense_auto_approve_rule_members as Record<string, unknown>[]) ?? [];
      const members = memberRows.map(mapRuleMemberFromDb);
      return mapAutoApproveRuleFromDb(r, members);
    });
  },

  /**
   * Create a new auto-approve rule with optional member assignments.
   */
  async createAutoApproveRule(
    rule: CreateAutoApproveRule,
    memberIds: string[]
  ): Promise<AutoApproveRule> {
    const supabase = requireSupabase();

    // Insert the rule
    const { data, error } = await supabase
      .from("expense_auto_approve_rules")
      .insert({
        company_id: rule.companyId,
        created_by: rule.createdBy,
        rule_type: rule.ruleType,
        threshold_amount: rule.thresholdAmount,
        applies_to_all: rule.appliesToAll,
        is_active: true,
      })
      .select("*, expense_auto_approve_rule_members(*)")
      .single();

    if (error) throw new Error(`Failed to create auto-approve rule: ${error.message}`);

    const ruleRow = data as Record<string, unknown>;
    const ruleId = ruleRow.id as string;

    // Insert members if not applies_to_all
    let members: AutoApproveRuleMember[] = [];
    if (!rule.appliesToAll && memberIds.length > 0) {
      const memberInserts = memberIds.map((userId) => ({
        rule_id: ruleId,
        user_id: userId,
      }));

      const { data: memberData, error: memberError } = await supabase
        .from("expense_auto_approve_rule_members")
        .insert(memberInserts)
        .select("*");

      if (memberError) {
        throw new Error(`Failed to add rule members: ${memberError.message}`);
      }

      members = (memberData ?? []).map((m) =>
        mapRuleMemberFromDb(m as Record<string, unknown>)
      );
    }

    return mapAutoApproveRuleFromDb(ruleRow, members);
  },

  /**
   * Toggle an auto-approve rule active/inactive.
   */
  async toggleAutoApproveRule(
    ruleId: string,
    isActive: boolean
  ): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expense_auto_approve_rules")
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ruleId);

    if (error) throw new Error(`Failed to toggle auto-approve rule: ${error.message}`);
  },

  /**
   * Delete an auto-approve rule. Cascade should handle member cleanup.
   */
  async deleteAutoApproveRule(ruleId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expense_auto_approve_rules")
      .delete()
      .eq("id", ruleId);

    if (error) throw new Error(`Failed to delete auto-approve rule: ${error.message}`);
  },

  /**
   * Replace all member assignments for a rule.
   * Deletes existing members, then inserts the new set.
   */
  async setRuleMembers(ruleId: string, userIds: string[]): Promise<void> {
    const supabase = requireSupabase();

    // Delete existing members
    const { error: deleteError } = await supabase
      .from("expense_auto_approve_rule_members")
      .delete()
      .eq("rule_id", ruleId);

    if (deleteError) {
      throw new Error(`Failed to clear rule members: ${deleteError.message}`);
    }

    // Insert new members
    if (userIds.length > 0) {
      const inserts = userIds.map((userId) => ({
        rule_id: ruleId,
        user_id: userId,
      }));

      const { error: insertError } = await supabase
        .from("expense_auto_approve_rule_members")
        .insert(inserts);

      if (insertError) {
        throw new Error(`Failed to set rule members: ${insertError.message}`);
      }
    }
  },
};

/**
 * OPS Web - Expense Approval Hooks
 *
 * TanStack Query hooks for expense batch review, flagging,
 * approval/rejection, and auto-approve rules.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ExpenseApprovalService } from "../api/services/expense-approval-service";
import {
  dispatchExpenseApproved,
  dispatchExpensePaid,
} from "../api/services/notification-dispatch";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";
import type { ExpenseBatch, CreateAutoApproveRule } from "../types/expense-approval";

// ─── All Expenses (dashboard widgets) ─────────────────────────────────────────

export function useAllExpenses() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const canApprove = usePermissionStore((s) => s.can("expenses.approve"));

  return useQuery({
    queryKey: queryKeys.expenseBatches.allExpenses(companyId),
    queryFn: () => ExpenseApprovalService.fetchAllExpenses(companyId),
    enabled: !!companyId && canApprove,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Batch Queries ────────────────────────────────────────────────────────────

export function useExpenseBatches() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const canApprove = usePermissionStore((s) => s.can("expenses.approve"));

  return useQuery({
    queryKey: queryKeys.expenseBatches.list(companyId),
    queryFn: () => ExpenseApprovalService.fetchBatches(companyId),
    enabled: !!companyId && canApprove,
    staleTime: 2 * 60 * 1000,
  });
}

export function useBatchExpenses(batchId: string | null) {
  return useQuery({
    queryKey: queryKeys.expenseBatches.expenses(batchId ?? ""),
    queryFn: () => ExpenseApprovalService.fetchBatchExpenses(batchId!),
    enabled: !!batchId,
    staleTime: 60 * 1000,
  });
}

// ─── Flagging Mutations ───────────────────────────────────────────────────────

export function useFlagExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      expenseId,
      flaggedBy,
      comment,
    }: {
      expenseId: string;
      flaggedBy: string;
      comment: string;
    }) => ExpenseApprovalService.flagExpense(expenseId, flaggedBy, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

export function useUnflagExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (expenseId: string) =>
      ExpenseApprovalService.unflagExpense(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

// ─── Approval Mutations ───────────────────────────────────────────────────────

export function useApproveBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      batchId,
      expenseIds,
    }: {
      batchId: string;
      /**
       * Reviewer + approved amount are retained on the mutation interface for
       * call-site compatibility, but are no longer sent from the client: the
       * `approve_expense_batch` RPC derives the reviewer from the authenticated
       * session and recalculates the approved amount server-side.
       */
      reviewedBy: string;
      approvedAmount: number;
      expenseIds: string[];
      /** Pass batch metadata for notification dispatch */
      submittedBy?: string | null;
      companyId?: string;
      batchNumber?: string;
    }) => {
      // Single atomic, permission-enforced approval (batch + lines + recalc).
      await ExpenseApprovalService.approveBatch(batchId);

      // Best-effort accounting sync — must never fail/roll back the approval.
      await ExpenseApprovalService.syncExpensesToAccounting(expenseIds);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });

      // Notify the submitter that their batch was approved
      if (variables.submittedBy && variables.companyId) {
        dispatchExpenseApproved({
          expenseDescription: `Batch ${variables.batchNumber ?? variables.batchId}`,
          submitterId: variables.submittedBy,
          companyId: variables.companyId,
          actionUrl: "/expenses",
        });
      }
    },
  });
}

/**
 * Early-clear a single expense line via the `early_clear_expense_line` RPC —
 * approves just that line, leaves the envelope in place, recalculates the
 * total, and notifies the submitter server-side (no client dispatch here).
 */
export function useEarlyClearLine() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (expenseId: string) =>
      ExpenseApprovalService.earlyClearLine(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

/**
 * Record a batch as paid out (`mark_expense_batch_paid` RPC) and tell the
 * submitter their money moved. The RPC stamps paid_at/paid_by and flips the
 * approved lines to `reimbursed` — iOS renders those as "paid" natively.
 */
export function useMarkBatchPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      batchId,
    }: {
      batchId: string;
      /** Batch metadata for the submitter notification */
      submittedBy?: string | null;
      companyId?: string;
      batchNumber?: string;
    }) => ExpenseApprovalService.markBatchPaid(batchId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });

      if (variables.submittedBy && variables.companyId) {
        dispatchExpensePaid({
          batchLabel: variables.batchNumber ?? variables.batchId,
          submitterId: variables.submittedBy,
          companyId: variables.companyId,
        });
      }
    },
  });
}

/** Reverse a payout recording — mis-click recovery. No notification. */
export function useUnmarkBatchPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ batchId }: { batchId: string }) =>
      ExpenseApprovalService.unmarkBatchPaid(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

export function useRejectWithRevisions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      batchId,
      batch,
      reviewedBy,
      reviewNotes,
      flaggedExpenseIds,
      cleanExpenseIds,
      flagComments,
      cleanTotal,
      flaggedTotal,
    }: {
      batchId: string;
      batch: ExpenseBatch;
      reviewedBy: string;
      reviewNotes: string | null;
      flaggedExpenseIds: string[];
      cleanExpenseIds: string[];
      flagComments: Record<string, string>;
      cleanTotal: number;
      flaggedTotal: number;
    }) =>
      ExpenseApprovalService.rejectWithRevisions(
        batchId,
        batch,
        reviewedBy,
        reviewNotes,
        flaggedExpenseIds,
        cleanExpenseIds,
        flagComments,
        cleanTotal,
        flaggedTotal
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

export function useQuickRejectBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      batchId,
      reviewedBy,
      reviewNotes,
    }: {
      batchId: string;
      reviewedBy: string;
      reviewNotes: string;
    }) => ExpenseApprovalService.quickRejectBatch(batchId, reviewedBy, reviewNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

// ─── Auto-Approve Rules ───────────────────────────────────────────────────────

export function useAutoApproveRules() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.expenseBatches.autoApproveRules(companyId),
    queryFn: () => ExpenseApprovalService.fetchAutoApproveRules(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateAutoApproveRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      rule,
      memberIds,
    }: {
      rule: CreateAutoApproveRule;
      memberIds: string[];
    }) => ExpenseApprovalService.createAutoApproveRule(rule, memberIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

export function useToggleAutoApproveRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) =>
      ExpenseApprovalService.toggleAutoApproveRule(ruleId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

export function useDeleteAutoApproveRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId: string) =>
      ExpenseApprovalService.deleteAutoApproveRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

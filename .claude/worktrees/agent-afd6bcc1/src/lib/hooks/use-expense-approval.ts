/**
 * OPS Web - Expense Approval Hooks
 *
 * TanStack Query hooks for expense batch review, flagging,
 * approval/rejection, and auto-approve rules.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ExpenseApprovalService } from "../api/services/expense-approval-service";
import { useAuthStore } from "../store/auth-store";
import type { ExpenseBatch, CreateAutoApproveRule } from "../types/expense-approval";

// ─── Batch Queries ────────────────────────────────────────────────────────────

export function useExpenseBatches() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.expenseBatches.list(companyId),
    queryFn: () => ExpenseApprovalService.fetchBatches(companyId),
    enabled: !!companyId,
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
    mutationFn: ({
      batchId,
      reviewedBy,
      approvedAmount,
      expenseIds,
    }: {
      batchId: string;
      reviewedBy: string;
      approvedAmount: number;
      expenseIds: string[];
    }) =>
      Promise.all([
        ExpenseApprovalService.approveBatch(batchId, reviewedBy, approvedAmount),
        ExpenseApprovalService.approveExpenses(expenseIds, reviewedBy),
      ]),
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

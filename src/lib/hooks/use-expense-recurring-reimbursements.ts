/**
 * OPS Web - Recurring Reimbursement Hooks
 *
 * TanStack Query hooks over ExpenseRecurringReimbursementService. The database
 * files, moves and removes the monthly lines itself, so every command
 * invalidates the whole expense namespace: batches, lines, metrics and the
 * recurring list all refresh together.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  ExpenseRecurringReimbursementService,
  type CreateRecurringReimbursementInput,
  type UpdateRecurringReimbursementInput,
} from "../api/services/expense-recurring-reimbursement-service";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";

export function useRecurringReimbursements() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const canApprove = usePermissionStore((s) => s.can("expenses.approve"));

  return useQuery({
    queryKey: queryKeys.expenseBatches.recurring(companyId),
    queryFn: () => ExpenseRecurringReimbursementService.fetchCompany(companyId),
    enabled: !!companyId && canApprove,
    staleTime: 60 * 1000,
  });
}

function useExpenseCommand<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      // Settled, not success: a refused command (e.g. a stale form) still
      // means the operator should now see the current truth.
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}

export function useCreateRecurringReimbursement() {
  return useExpenseCommand((input: CreateRecurringReimbursementInput) =>
    ExpenseRecurringReimbursementService.create(input)
  );
}

export function useUpdateRecurringReimbursement() {
  return useExpenseCommand((input: UpdateRecurringReimbursementInput) =>
    ExpenseRecurringReimbursementService.update(input)
  );
}

export function useEndRecurringReimbursement() {
  return useExpenseCommand(
    (input: { id: string; lastPeriod: string | null; expectedUpdatedAt: string }) =>
      ExpenseRecurringReimbursementService.end(input.id, input.lastPeriod, input.expectedUpdatedAt)
  );
}

export function useDeleteRecurringReimbursement() {
  return useExpenseCommand((input: { id: string; expectedUpdatedAt: string }) =>
    ExpenseRecurringReimbursementService.remove(input.id, input.expectedUpdatedAt)
  );
}

export function useSkipRecurringLine() {
  return useExpenseCommand((expenseId: string) =>
    ExpenseRecurringReimbursementService.skipLine(expenseId)
  );
}

export function useRestoreRecurringLine() {
  return useExpenseCommand((expenseId: string) =>
    ExpenseRecurringReimbursementService.restoreLine(expenseId)
  );
}

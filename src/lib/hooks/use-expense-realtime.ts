/**
 * OPS Web - Expense Realtime Invalidation
 *
 * Live-wires the expense review console: any change to the company's
 * expense_batches or expenses rows (crew adds a line, an envelope auto-sends,
 * another approver clears a batch) invalidates the expenseBatches query
 * namespace so the queue, detail panel, and instrument row refresh without a
 * manual reload. Both tables are in the `supabase_realtime` publication with
 * REPLICA IDENTITY FULL (added for the iOS review hub).
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase/client";
import { queryKeys } from "../api/query-client";
import { useAuthStore } from "../store/auth-store";

export function useExpenseRealtime(): void {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    };

    const channel = supabase
      .channel(`expense-review-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expense_batches",
          filter: `company_id=eq.${companyId}`,
        },
        invalidate
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `company_id=eq.${companyId}`,
        },
        invalidate
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);
}

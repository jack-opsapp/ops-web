/**
 * useProjectPipeline — workspace ACCOUNTING tab 4-cell aggregate.
 *
 * Wraps the project_pipeline_summary(uuid) RPC and reshapes its row into a
 * camelCased nested structure matching the four cells the UI renders:
 *   QUOTED · INVOICED · RECEIVED · OUTSTANDING
 *
 * NUMERIC columns come back as strings from PostgREST — every total is
 * coerced through Number() before being exposed.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";

export interface ProjectPipelineSummary {
  quoted: {
    total: number;
    recordId: string | null;
  };
  invoiced: {
    total: number;
    recordId: string | null;
    changeOrdersCount: number;
  };
  received: {
    total: number;
    recordId: string | null;
    depositPct: number | null;
  };
  outstanding: {
    total: number;
    dueDate: string | null;
    daysAged: number | null;
  };
}

const EMPTY: ProjectPipelineSummary = {
  quoted: { total: 0, recordId: null },
  invoiced: { total: 0, recordId: null, changeOrdersCount: 0 },
  received: { total: 0, recordId: null, depositPct: null },
  outstanding: { total: 0, dueDate: null, daysAged: null },
};

interface RpcRow {
  quoted_total: string | number | null;
  quoted_record_id: string | null;
  invoiced_total: string | number | null;
  invoiced_record_id: string | null;
  change_orders_count: number | null;
  received_total: string | number | null;
  received_record_id: string | null;
  deposit_pct: number | null;
  outstanding_total: string | number | null;
  outstanding_due_date: string | null;
  days_aged: number | null;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

export function useProjectPipeline(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.pipeline(projectId),
    queryFn: async (): Promise<ProjectPipelineSummary> => {
      if (!projectId) return EMPTY;
      const supabase = requireSupabase();
      const { data, error } = await supabase.rpc("project_pipeline_summary", {
        p_project_id: projectId,
      });
      if (error) throw error;

      const rows = (data ?? []) as RpcRow[];
      const row = rows[0];
      if (!row) return EMPTY;

      return {
        quoted: {
          total: toNumber(row.quoted_total),
          recordId: row.quoted_record_id,
        },
        invoiced: {
          total: toNumber(row.invoiced_total),
          recordId: row.invoiced_record_id,
          changeOrdersCount: row.change_orders_count ?? 0,
        },
        received: {
          total: toNumber(row.received_total),
          recordId: row.received_record_id,
          depositPct: row.deposit_pct,
        },
        outstanding: {
          total: toNumber(row.outstanding_total),
          dueDate: row.outstanding_due_date,
          daysAged: row.days_aged,
        },
      };
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

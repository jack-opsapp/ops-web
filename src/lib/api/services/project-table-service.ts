import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProjectTableDataParams,
  ProjectTableRow,
  ProjectTableSort,
} from "@/lib/types/project-table";
import { buildProjectTableFilterInstructions } from "@/lib/utils/project-filter-to-sql";
import { mapProjectTableRow } from "@/lib/utils/project-table-formatters";

const SORT_FIELD_MAP: Record<string, string> = {
  name: "title",
  status: "status",
  client: "client_name",
  client_email: "client_email",
  client_phone: "client_phone",
  address: "address",
  start_date: "start_date",
  end_date: "end_date",
  duration: "duration",
  progress: "progress",
  next_task: "next_task",
  task_count: "task_count",
  days_in_status: "days_in_status",
  estimate_total: "estimate_total",
  invoice_total: "invoice_total",
  paid_total: "paid_total",
  value: "value",
  project_cost: "project_cost",
  margin: "margin",
  photos: "photo_count",
  updated_at: "updated_at",
};

function normalizeSort(sort: ProjectTableSort[]): { field: string; ascending: boolean } {
  const first = sort[0];
  if (!first) return { field: "updated_at", ascending: false };
  return {
    field: SORT_FIELD_MAP[String(first.field)] ?? "updated_at",
    ascending: first.direction === "asc",
  };
}

function escapeIlikeSearch(value: string): string {
  return value
    .replace(/[(),]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replace(/\s+/g, " ")
    .trim();
}

export const ProjectTableService = {
  async fetchRows(
    params: ProjectTableDataParams & { pageParam?: number },
  ): Promise<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }> {
    const supabase = requireSupabase();
    const page = params.pageParam ?? 0;
    const from = page * params.pageSize;
    const to = from + params.pageSize - 1;
    const sort = normalizeSort(params.sorting.length > 0 ? params.sorting : params.view.sort);

    let query = supabase
      .from("project_table_rows")
      .select("*", { count: "exact" })
      .eq("company_id", params.companyId);

    const instructions = buildProjectTableFilterInstructions(
      params.view.filters,
      params.userId,
      params.search,
    );

    for (const instruction of instructions) {
      if (instruction.type === "contains") {
        query = query.contains(instruction.field, instruction.values);
      } else if (instruction.type === "in") {
        query = query.in(instruction.field, instruction.values);
      } else if (instruction.type === "not_in") {
        query = query.not(instruction.field, "in", `(${instruction.values.join(",")})`);
      } else if (instruction.type === "ilike_any") {
        const escaped = escapeIlikeSearch(instruction.value);
        if (!escaped) continue;
        query = query.or(
          instruction.fields
            .map((field) => `${field}.ilike.%${escaped}%`)
            .join(","),
        );
      }
    }

    const { data, error, count } = await query
      .order(sort.field, { ascending: sort.ascending, nullsFirst: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch project table rows: ${error.message}`);
    }

    const rows = (data ?? []).map(mapProjectTableRow).filter((row): row is ProjectTableRow => row !== null);
    const total = count ?? rows.length;
    const nextPage = to + 1 < total ? page + 1 : null;

    return { rows, count: total, nextPage };
  },
};

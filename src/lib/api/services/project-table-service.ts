import { requireSupabase } from "@/lib/supabase/helpers";
import { ProjectStatus } from "@/lib/types/models";
import type { Database } from "@/lib/types/database.types";
import {
  PROJECT_TABLE_DIRECT_EDIT_FIELD_MAP,
  type ProjectTableBulkOperation,
  type ProjectTableBulkResult,
  type ProjectTableBulkSuccess,
  type ProjectTableBulkFailure,
  type ProjectTableDirectEditColumnId,
  type ProjectTableEditValue,
} from "@/lib/types/project-table";
import type {
  ProjectTableDataParams,
  ProjectTableRow,
  ProjectTableSort,
} from "@/lib/types/project-table";
import { buildProjectTableFilterInstructions } from "@/lib/utils/project-filter-to-sql";
import {
  mapProjectTableRow,
  serializeProjectTableStatus,
} from "@/lib/utils/project-table-formatters";

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

export class ProjectTableMutationError extends Error {
  constructor(
    message: string,
    public readonly code: "P0001" | "42501" | "22023" | "NETWORK" | "UNKNOWN",
  ) {
    super(message);
    this.name = "ProjectTableMutationError";
  }
}

export function normalizeProjectTableMutationError(
  error: { code?: string; message?: string } | null,
): ProjectTableMutationError {
  if (!error) return new ProjectTableMutationError("Project conflict", "P0001");
  if (error.code === "P0001" || error.code === "42501" || error.code === "22023") {
    return new ProjectTableMutationError(error.message ?? "Project edit failed", error.code);
  }
  return new ProjectTableMutationError(error.message ?? "Project edit failed", "UNKNOWN");
}

function normalizeDirectValue(
  columnId: ProjectTableDirectEditColumnId,
  value: ProjectTableEditValue,
): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (columnId === "name" && text.length === 0) {
    throw new ProjectTableMutationError("Project name is required", "22023");
  }
  return text.length === 0 ? null : text;
}

type ProjectUpdatePayload = Database["public"]["Tables"]["projects"]["Update"];
type ProjectTableBulkRpcOperation = Record<string, unknown> & {
  action: string;
  project_id: string;
  expected_updated_at: string;
};

function serializeBulkOperation(operation: ProjectTableBulkOperation): ProjectTableBulkRpcOperation {
  const base = {
    action: operation.action,
    project_id: operation.projectId,
    expected_updated_at: operation.expectedUpdatedAt,
  };

  switch (operation.action) {
    case "status":
      return {
        ...base,
        status: serializeProjectTableStatus(operation.status),
      };
    case "date":
      return {
        ...base,
        field: operation.field,
        value: operation.value,
      };
    case "assign_team":
      return {
        ...base,
        user_id: operation.userId,
        task_ids: operation.taskIds,
      };
    case "remove_team":
      return {
        ...base,
        user_id: operation.userId,
        task_ids: operation.taskIds,
      };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBulkSuccess(value: unknown): ProjectTableBulkSuccess | null {
  if (!isRecord(value)) return null;
  const projectId = typeof value.project_id === "string" ? value.project_id : "";
  if (!projectId) return null;
  return {
    projectId,
    action: typeof value.action === "string" ? value.action : "",
    updatedAt: typeof value.updated_at === "string" ? value.updated_at : null,
  };
}

function normalizeBulkFailure(value: unknown): ProjectTableBulkFailure | null {
  if (!isRecord(value)) return null;
  const projectId = typeof value.project_id === "string" ? value.project_id : "";
  if (!projectId) return null;
  return {
    projectId,
    action: typeof value.action === "string" ? value.action : "",
    code: typeof value.code === "string" ? value.code : "UNKNOWN",
    message: typeof value.message === "string" ? value.message : "Project edit failed",
  };
}

function normalizeBulkResult(data: unknown): ProjectTableBulkResult {
  const record = isRecord(data) ? data : {};
  const success = Array.isArray(record.success)
    ? record.success.map(normalizeBulkSuccess).filter((item): item is ProjectTableBulkSuccess => item !== null)
    : [];
  const failed = Array.isArray(record.failed)
    ? record.failed.map(normalizeBulkFailure).filter((item): item is ProjectTableBulkFailure => item !== null)
    : [];
  const successCount = typeof record.success_count === "number" ? record.success_count : success.length;
  const failedCount = typeof record.failed_count === "number" ? record.failed_count : failed.length;

  return { success, failed, successCount, failedCount };
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

  async updateProjectField(params: {
    projectId: string;
    columnId: ProjectTableDirectEditColumnId;
    value: ProjectTableEditValue;
    expectedUpdatedAt: string;
  }): Promise<{ updatedAt: string }> {
    const supabase = requireSupabase();
    const dbField = PROJECT_TABLE_DIRECT_EDIT_FIELD_MAP[params.columnId];
    const payload = {
      [dbField]: normalizeDirectValue(params.columnId, params.value),
    } satisfies ProjectUpdatePayload;

    const { data, error } = await supabase
      .from("projects")
      .update(payload)
      .eq("id", params.projectId)
      .eq("updated_at", params.expectedUpdatedAt)
      .select("updated_at")
      .maybeSingle();

    if (error) throw normalizeProjectTableMutationError(error);
    if (!data?.updated_at) throw new ProjectTableMutationError("Project conflict", "P0001");
    return { updatedAt: data.updated_at };
  },

  async changeProjectStatus(params: {
    projectId: string;
    status: ProjectStatus;
    expectedUpdatedAt: string;
  }): Promise<{ updatedAt: string }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc("change_project_status", {
      p_project_id: params.projectId,
      p_new_status: serializeProjectTableStatus(params.status),
      p_expected_updated_at: params.expectedUpdatedAt,
    });

    if (error) throw normalizeProjectTableMutationError(error);
    const updatedAt = typeof data === "object" && data && "updated_at" in data
      ? String((data as { updated_at: unknown }).updated_at)
      : "";
    if (!updatedAt) {
      throw new ProjectTableMutationError("Project status response missing updated_at", "UNKNOWN");
    }
    return { updatedAt };
  },

  async bulkUpdateProjects(params: {
    operations: ProjectTableBulkOperation[];
  }): Promise<ProjectTableBulkResult> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc("bulk_update_project_table", {
      p_operations: params.operations.map(serializeBulkOperation),
    });

    if (error) throw normalizeProjectTableMutationError(error);
    return normalizeBulkResult(data);
  },
};

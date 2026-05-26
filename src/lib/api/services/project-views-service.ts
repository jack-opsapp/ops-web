import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProjectTableViewCreateInput,
  ProjectTableViewDefinition,
  ProjectTableViewDefinitionInput,
  ProjectTableViewMutationErrorCode,
  ProjectTableViewOwnerType,
  ProjectTableViewUpdateInput,
  ProjectViewDbRow,
} from "@/lib/types/project-table";
import {
  buildProjectViewDefinitionPayload,
  type ProjectTableViewDefinitionPayload,
} from "@/lib/utils/project-view-defaults";
import { mapProjectView } from "@/lib/utils/project-table-formatters";

type ProjectTableViewRpcError = {
  code?: string;
  message?: string;
};

type ProjectTableViewRpcArgs = {
  create_project_table_view: {
    p_name: string;
    p_source_view_id: string | null;
    p_definition: ProjectTableViewDefinitionPayload;
  };
  rename_project_table_view: {
    p_view_id: string;
    p_name: string;
  };
  archive_project_table_view: {
    p_view_id: string;
  };
  reset_project_table_view: {
    p_view_id: string;
  };
  share_project_table_view: {
    p_view_id: string;
  };
  update_project_table_view_definition: {
    p_view_id: string;
    p_definition: ProjectTableViewDefinitionPayload;
  };
};

type ProjectTableViewRpcName = keyof ProjectTableViewRpcArgs;

type ProjectTableViewRpcClient = {
  rpc: <Name extends ProjectTableViewRpcName>(
    name: Name,
    args: ProjectTableViewRpcArgs[Name],
  ) => Promise<{ data: ProjectViewDbRow | null; error: ProjectTableViewRpcError | null }>;
};

export class ProjectTableViewMutationError extends Error {
  constructor(
    message: string,
    public readonly code: ProjectTableViewMutationErrorCode,
  ) {
    super(message);
    this.name = "ProjectTableViewMutationError";
  }
}

function normalizeProjectTableViewMutationError(
  error: ProjectTableViewRpcError | null,
): ProjectTableViewMutationError {
  if (!error) {
    return new ProjectTableViewMutationError("Project view permission denied", "PERMISSION_DENIED");
  }

  if (error.code === "23505") {
    return new ProjectTableViewMutationError(error.message ?? "Project view name already exists", "DUPLICATE_NAME");
  }

  if (error.code === "42501" || error.code === "PGRST301") {
    return new ProjectTableViewMutationError(error.message ?? "Project view permission denied", "PERMISSION_DENIED");
  }

  if (error.code === "22023") {
    return new ProjectTableViewMutationError(error.message ?? "Project view input is invalid", "INVALID_INPUT");
  }

  return new ProjectTableViewMutationError(error.message ?? "Project view mutation failed", "UNKNOWN");
}

function normalizeOwnerType(value: string): ProjectTableViewOwnerType {
  return value === "company" ? "company" : "user";
}

function mapProjectTableView(row: ProjectViewDbRow): ProjectTableViewDefinition {
  return {
    ...mapProjectView(row),
    ownerType: normalizeOwnerType(row.owner_type),
    ownerId: row.owner_id,
    isArchived: row.is_archived,
  };
}

function mergeDefinitionInput(
  sourceView: ProjectTableViewDefinition | null | undefined,
  definition: ProjectTableViewDefinitionInput | null | undefined,
): ProjectTableViewDefinition | ProjectTableViewDefinitionInput | null | undefined {
  if (!sourceView || !definition) return definition ?? sourceView;
  return {
    columns: definition.columns ?? sourceView.columns,
    filters: definition.filters ?? sourceView.filters,
    sort: definition.sort ?? sourceView.sort,
    density: definition.density ?? sourceView.density,
    zoomLevel: definition.zoomLevel ?? sourceView.zoomLevel,
  };
}

async function callProjectViewRpc<Name extends ProjectTableViewRpcName>(
  name: Name,
  args: ProjectTableViewRpcArgs[Name],
): Promise<ProjectTableViewDefinition> {
  const supabase = requireSupabase() as unknown as ProjectTableViewRpcClient;
  const { data, error } = await supabase.rpc(name, args);

  if (error) throw normalizeProjectTableViewMutationError(error);
  if (!data) throw normalizeProjectTableViewMutationError(null);
  return mapProjectTableView(data);
}

export const ProjectViewsService = {
  async fetchViews(companyId: string): Promise<ProjectTableViewDefinition[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("project_views")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_archived", false)
      .order("sort_position", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch project views: ${error.message}`);
    }

    return (data ?? []).map(mapProjectTableView);
  },

  async createPersonalView(input: ProjectTableViewCreateInput): Promise<ProjectTableViewDefinition> {
    const definition = mergeDefinitionInput(input.sourceView, input.definition);

    return callProjectViewRpc("create_project_table_view", {
      p_name: input.name,
      p_source_view_id: input.sourceView?.id ?? null,
      p_definition: buildProjectViewDefinitionPayload(definition),
    });
  },

  async duplicateView(
    input: ProjectTableViewCreateInput & { sourceView: ProjectTableViewDefinition },
  ): Promise<ProjectTableViewDefinition> {
    return callProjectViewRpc("create_project_table_view", {
      p_name: input.name,
      p_source_view_id: input.sourceView.id,
      p_definition: buildProjectViewDefinitionPayload(input.sourceView),
    });
  },

  async renameView(
    input: ProjectTableViewUpdateInput & { name: string },
  ): Promise<ProjectTableViewDefinition> {
    return callProjectViewRpc("rename_project_table_view", {
      p_view_id: input.viewId,
      p_name: input.name,
    });
  },

  async archiveView(input: ProjectTableViewUpdateInput): Promise<ProjectTableViewDefinition> {
    return callProjectViewRpc("archive_project_table_view", {
      p_view_id: input.viewId,
    });
  },

  async resetDefaultView(input: ProjectTableViewUpdateInput): Promise<ProjectTableViewDefinition> {
    return callProjectViewRpc("reset_project_table_view", {
      p_view_id: input.viewId,
    });
  },

  async shareViewWithTeam(
    input: ProjectTableViewUpdateInput & { canManageViews: boolean },
  ): Promise<ProjectTableViewDefinition> {
    if (!input.canManageViews) {
      throw new ProjectTableViewMutationError("Project view permission denied", "PERMISSION_DENIED");
    }

    return callProjectViewRpc("share_project_table_view", {
      p_view_id: input.viewId,
    });
  },

  async updateViewDefinition(
    input: ProjectTableViewUpdateInput & { definition: ProjectTableViewDefinitionInput },
  ): Promise<ProjectTableViewDefinition> {
    return callProjectViewRpc("update_project_table_view_definition", {
      p_view_id: input.viewId,
      p_definition: buildProjectViewDefinitionPayload(input.definition, { partial: true }),
    });
  },
};

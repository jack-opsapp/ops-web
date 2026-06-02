import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  OpportunityViewCreateInput,
  OpportunityViewDefinition,
  OpportunityViewDefinitionInput,
  OpportunityViewMutationErrorCode,
  OpportunityViewOwnerType,
  OpportunityViewUpdateInput,
  OpportunityViewDbRow,
} from "@/lib/types/pipeline-table";
import {
  buildOpportunityViewDefinitionPayload,
  type OpportunityViewDefinitionPayload,
} from "@/lib/utils/opportunity-view-defaults";
import { mapOpportunityView } from "@/lib/utils/pipeline-table-formatters";

type OpportunityTableViewRpcError = {
  code?: string;
  message?: string;
};

type OpportunityTableViewRpcArgs = {
  create_opportunity_table_view: {
    p_name: string;
    p_source_view_id: string | null;
    p_definition: OpportunityViewDefinitionPayload;
  };
  rename_opportunity_table_view: {
    p_view_id: string;
    p_name: string;
  };
  archive_opportunity_table_view: {
    p_view_id: string;
  };
  reset_opportunity_table_view: {
    p_view_id: string;
  };
  share_opportunity_table_view: {
    p_view_id: string;
  };
  update_opportunity_table_view_definition: {
    p_view_id: string;
    p_definition: OpportunityViewDefinitionPayload;
  };
};

type OpportunityTableViewRpcName = keyof OpportunityTableViewRpcArgs;

type OpportunityTableViewRpcClient = {
  rpc: <Name extends OpportunityTableViewRpcName>(
    name: Name,
    args: OpportunityTableViewRpcArgs[Name],
  ) => Promise<{ data: OpportunityViewDbRow | null; error: OpportunityTableViewRpcError | null }>;
};

export class OpportunityTableViewMutationError extends Error {
  constructor(
    message: string,
    public readonly code: OpportunityViewMutationErrorCode,
  ) {
    super(message);
    this.name = "OpportunityTableViewMutationError";
  }
}

function normalizeOpportunityTableViewMutationError(
  error: OpportunityTableViewRpcError | null,
): OpportunityTableViewMutationError {
  if (!error) {
    return new OpportunityTableViewMutationError("Pipeline view permission denied", "PERMISSION_DENIED");
  }

  if (error.code === "23505") {
    return new OpportunityTableViewMutationError(error.message ?? "Pipeline view name already exists", "DUPLICATE_NAME");
  }

  if (error.code === "42501" || error.code === "PGRST301") {
    return new OpportunityTableViewMutationError(error.message ?? "Pipeline view permission denied", "PERMISSION_DENIED");
  }

  if (error.code === "22023") {
    return new OpportunityTableViewMutationError(error.message ?? "Pipeline view input is invalid", "INVALID_INPUT");
  }

  return new OpportunityTableViewMutationError(error.message ?? "Pipeline view mutation failed", "UNKNOWN");
}

function normalizeOwnerType(value: string): OpportunityViewOwnerType {
  return value === "company" ? "company" : "user";
}

function mapOpportunityTableView(row: OpportunityViewDbRow): OpportunityViewDefinition {
  return {
    ...mapOpportunityView(row),
    ownerType: normalizeOwnerType(row.owner_type),
    ownerId: row.owner_id,
    isArchived: row.is_archived,
  };
}

function mergeDefinitionInput(
  sourceView: OpportunityViewDefinition | null | undefined,
  definition: OpportunityViewDefinitionInput | null | undefined,
): OpportunityViewDefinition | OpportunityViewDefinitionInput | null | undefined {
  if (!sourceView || !definition) return definition ?? sourceView;
  return {
    columns: definition.columns ?? sourceView.columns,
    filters: definition.filters ?? sourceView.filters,
    sort: definition.sort ?? sourceView.sort,
    density: definition.density ?? sourceView.density,
    zoomLevel: definition.zoomLevel ?? sourceView.zoomLevel,
  };
}

async function callOpportunityViewRpc<Name extends OpportunityTableViewRpcName>(
  name: Name,
  args: OpportunityTableViewRpcArgs[Name],
): Promise<OpportunityViewDefinition> {
  const supabase = requireSupabase() as unknown as OpportunityTableViewRpcClient;
  const { data, error } = await supabase.rpc(name, args);

  if (error) throw normalizeOpportunityTableViewMutationError(error);
  if (!data) throw normalizeOpportunityTableViewMutationError(null);
  return mapOpportunityTableView(data);
}

export const OpportunityViewsService = {
  async fetchViews(companyId: string): Promise<OpportunityViewDefinition[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("opportunity_views")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_archived", false)
      .order("sort_position", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch pipeline views: ${error.message}`);
    }

    return (data ?? []).map(mapOpportunityTableView);
  },

  async createPersonalView(input: OpportunityViewCreateInput): Promise<OpportunityViewDefinition> {
    const definition = mergeDefinitionInput(input.sourceView, input.definition);

    return callOpportunityViewRpc("create_opportunity_table_view", {
      p_name: input.name,
      p_source_view_id: input.sourceView?.id ?? null,
      p_definition: buildOpportunityViewDefinitionPayload(definition),
    });
  },

  async duplicateView(
    input: OpportunityViewCreateInput & { sourceView: OpportunityViewDefinition },
  ): Promise<OpportunityViewDefinition> {
    return callOpportunityViewRpc("create_opportunity_table_view", {
      p_name: input.name,
      p_source_view_id: input.sourceView.id,
      p_definition: buildOpportunityViewDefinitionPayload(input.sourceView),
    });
  },

  async renameView(
    input: OpportunityViewUpdateInput & { name: string },
  ): Promise<OpportunityViewDefinition> {
    return callOpportunityViewRpc("rename_opportunity_table_view", {
      p_view_id: input.viewId,
      p_name: input.name,
    });
  },

  async archiveView(input: OpportunityViewUpdateInput): Promise<OpportunityViewDefinition> {
    return callOpportunityViewRpc("archive_opportunity_table_view", {
      p_view_id: input.viewId,
    });
  },

  async resetDefaultView(input: OpportunityViewUpdateInput): Promise<OpportunityViewDefinition> {
    return callOpportunityViewRpc("reset_opportunity_table_view", {
      p_view_id: input.viewId,
    });
  },

  async shareViewWithTeam(
    input: OpportunityViewUpdateInput & { canManageViews: boolean },
  ): Promise<OpportunityViewDefinition> {
    if (!input.canManageViews) {
      throw new OpportunityTableViewMutationError("Pipeline view permission denied", "PERMISSION_DENIED");
    }

    return callOpportunityViewRpc("share_opportunity_table_view", {
      p_view_id: input.viewId,
    });
  },

  async updateViewDefinition(
    input: OpportunityViewUpdateInput & { definition: OpportunityViewDefinitionInput },
  ): Promise<OpportunityViewDefinition> {
    return callOpportunityViewRpc("update_opportunity_table_view_definition", {
      p_view_id: input.viewId,
      p_definition: buildOpportunityViewDefinitionPayload(input.definition, { partial: true }),
    });
  },
};

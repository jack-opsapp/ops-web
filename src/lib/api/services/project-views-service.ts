import { requireSupabase } from "@/lib/supabase/helpers";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";
import { mapProjectView } from "@/lib/utils/project-table-formatters";

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

    return (data ?? []).map(mapProjectView);
  },
};

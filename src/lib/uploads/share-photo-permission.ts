import { resolvePermissionScopeById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function canEditSharePhotoProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  const scope = await resolvePermissionScopeById(userId, "projects.edit");
  if (scope === "all") return true;
  if (scope !== "assigned") return false;

  const { data, error } = await getServiceRoleClient()
    .from("project_tasks")
    .select("id")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .contains("team_member_ids", [userId])
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(
      "[uploads/share-photo] project assignment lookup failed:",
      error.message
    );
    return false;
  }
  return Boolean(data);
}

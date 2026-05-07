/**
 * useProjectCrew — workspace PEOPLE rail.
 *
 * # Schema drift (intentional)
 *
 * The plan asks for `{ pm, crew, subcontractor }` but the schema has no
 * project-scoped role on `team_member_ids` — it's a flat UUID[]. Until a
 * `project_team_members.role` column lands, this hook uses heuristics:
 *
 *   - subcontractor: `users.user_type = 'subcontractor'`
 *   - pm:            highest-ranked non-subcontractor on the team. Rank
 *                    comes from `user_roles → roles.hierarchy` (lower is
 *                    more senior). When no `user_roles` row exists for a
 *                    user, falls back to the legacy `users.role` enum.
 *                    PM must be at hierarchy <= 4 (Operator+) — pure-crew
 *                    teams return `pm: null`.
 *   - crew:          everyone else.
 *
 * When `project_team_members.role` exists, swap the heuristic for that
 * column and delete the fallback path. The shape of this hook should not
 * have to change.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
  email: string | null;
  phone: string | null;
}

export interface ProjectCrew {
  pm: CrewMember | null;
  crew: CrewMember[];
  subcontractor: CrewMember | null;
}

const FALLBACK_AVATAR = "#6F94B0";

const LEGACY_ROLE_HIERARCHY: Record<string, number> = {
  admin: 1,
  owner: 2,
  office: 3,
  operator: 4,
  crew: 5,
  unassigned: 99,
};

const PM_HIERARCHY_CEILING = 4; // Operator and above

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  user_color: string | null;
  user_type: string | null;
  role: string | null;
}

interface UserRoleRow {
  user_id: string;
  roles: { name: string; hierarchy: number } | null;
}

interface ResolvedRole {
  name: string;
  hierarchy: number;
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function resolveRole(
  user: UserRow,
  rolesByUserId: Map<string, { name: string; hierarchy: number }>
): ResolvedRole {
  const fromNew = rolesByUserId.get(user.id);
  if (fromNew) return fromNew;
  if (user.role) {
    const legacy = LEGACY_ROLE_HIERARCHY[user.role.toLowerCase()] ?? 99;
    return { name: titleCase(user.role), hierarchy: legacy };
  }
  return { name: "Unassigned", hierarchy: 99 };
}

function buildMember(
  user: UserRow,
  role: ResolvedRole | "Subcontractor"
): CrewMember {
  const roleName = role === "Subcontractor" ? "Subcontractor" : role.name;
  return {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`.trim(),
    role: roleName,
    avatarColor: user.user_color ?? FALLBACK_AVATAR,
    email: user.email,
    phone: user.phone,
  };
}

export function useProjectCrew(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.crew(projectId),
    queryFn: async (): Promise<ProjectCrew> => {
      if (!projectId) return { pm: null, crew: [], subcontractor: null };
      const supabase = requireSupabase();

      const projectRes = await supabase
        .from("projects")
        .select("team_member_ids")
        .eq("id", projectId)
        .single();
      if (projectRes.error) throw projectRes.error;

      const memberIds = (projectRes.data?.team_member_ids ?? []) as string[];
      if (memberIds.length === 0) {
        return { pm: null, crew: [], subcontractor: null };
      }

      const [usersRes, rolesRes] = await Promise.all([
        supabase
          .from("users")
          .select(
            "id, first_name, last_name, email, phone, user_color, user_type, role"
          )
          .in("id", memberIds),
        supabase
          .from("user_roles")
          .select("user_id, roles ( name, hierarchy )")
          .in("user_id", memberIds),
      ]);

      if (usersRes.error) throw usersRes.error;
      if (rolesRes.error) throw rolesRes.error;

      const userRows = (usersRes.data ?? []) as UserRow[];
      const roleRows = (rolesRes.data ?? []) as unknown as UserRoleRow[];

      const rolesByUserId = new Map<string, { name: string; hierarchy: number }>();
      for (const r of roleRows) {
        if (!r.roles) continue;
        const existing = rolesByUserId.get(r.user_id);
        if (!existing || r.roles.hierarchy < existing.hierarchy) {
          rolesByUserId.set(r.user_id, r.roles);
        }
      }

      let subcontractor: CrewMember | null = null;
      let pm: CrewMember | null = null;
      let pmHierarchy = Number.POSITIVE_INFINITY;
      const crew: CrewMember[] = [];

      for (const user of userRows) {
        if (user.user_type === "subcontractor") {
          if (!subcontractor) subcontractor = buildMember(user, "Subcontractor");
          continue;
        }

        const role = resolveRole(user, rolesByUserId);
        const member = buildMember(user, role);

        // Eligible PM: hierarchy <= ceiling (Operator+) AND outranks the
        // current pick.
        if (role.hierarchy <= PM_HIERARCHY_CEILING && role.hierarchy < pmHierarchy) {
          if (pm) crew.push(pm);
          pm = member;
          pmHierarchy = role.hierarchy;
        } else {
          crew.push(member);
        }
      }

      return { pm, crew, subcontractor };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

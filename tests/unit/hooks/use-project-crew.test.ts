/**
 * useProjectCrew — workspace PEOPLE rail.
 *
 * SCHEMA DRIFT (intentional, surfaced in phase report):
 *   The plan asks for `{ pm, crew, subcontractor }` but the schema has no
 *   project-scoped role on team_member_ids — it's a flat UUID[]. Until a
 *   `project_team_members.role` column lands, this hook uses heuristics:
 *     - subcontractor: any team member where users.user_type = 'subcontractor'
 *     - pm: highest-ranked non-subcontractor (lowest org-role hierarchy
 *           number = most senior; ties broken by users.role legacy enum)
 *     - crew: everyone else
 *
 *   When a subcontractor exists, they're returned in `subcontractor`.
 *   When no operator/owner/admin/office user is on the team, `pm` is null.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface ProjectStub {
  team_member_ids: string[] | null;
}

interface UserStub {
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
  roles: { name: string; hierarchy: number };
}

let project: ProjectStub | null = null;
let users: UserStub[] = [];
let userRoles: UserRoleRow[] = [];

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: project, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: users.filter((u) => ids.includes(u.id)),
                error: null,
              }),
          }),
        };
      }
      if (table === "user_roles") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: userRoles.filter((ur) => ids.includes(ur.user_id)),
                error: null,
              }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { useProjectCrew } from "@/lib/hooks/use-project-crew";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  project = null;
  users = [];
  userRoles = [];
});

describe("useProjectCrew", () => {
  it("infers pm as the most senior non-subcontractor team member", async () => {
    project = { team_member_ids: ["u-pm", "u-crew-1", "u-crew-2"] };
    users = [
      { id: "u-pm", first_name: "Olivia", last_name: "Park", email: "olivia@example.com", phone: "555-0001", user_color: "#9DB582", user_type: "company", role: "operator" },
      { id: "u-crew-1", first_name: "Sam", last_name: "Liu", email: null, phone: null, user_color: "#C4A868", user_type: "employee", role: "crew" },
      { id: "u-crew-2", first_name: "Mia", last_name: "Reed", email: null, phone: null, user_color: "#B58289", user_type: "employee", role: "crew" },
    ];
    userRoles = [
      { user_id: "u-pm", roles: { name: "Operator", hierarchy: 4 } },
      { user_id: "u-crew-1", roles: { name: "Crew", hierarchy: 5 } },
      { user_id: "u-crew-2", roles: { name: "Crew", hierarchy: 5 } },
    ];

    const { result } = renderHook(() => useProjectCrew("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;

    expect(data.pm?.id).toBe("u-pm");
    expect(data.pm?.name).toBe("Olivia Park");
    expect(data.pm?.role).toBe("Operator");
    expect(data.crew.map((c) => c.id).sort()).toEqual(["u-crew-1", "u-crew-2"]);
    expect(data.subcontractor).toBeNull();
  });

  it("recognizes a subcontractor via user_type and excludes them from crew", async () => {
    project = { team_member_ids: ["u-op", "u-sub", "u-crew"] };
    users = [
      { id: "u-op", first_name: "Olivia", last_name: "Park", email: null, phone: null, user_color: null, user_type: "company", role: "operator" },
      { id: "u-sub", first_name: "Sub", last_name: "Contractor", email: "sub@vendor.com", phone: "555-0099", user_color: "#6F94B0", user_type: "subcontractor", role: null },
      { id: "u-crew", first_name: "Crew", last_name: "Member", email: null, phone: null, user_color: null, user_type: "employee", role: "crew" },
    ];
    userRoles = [
      { user_id: "u-op", roles: { name: "Operator", hierarchy: 4 } },
      { user_id: "u-crew", roles: { name: "Crew", hierarchy: 5 } },
    ];

    const { result } = renderHook(() => useProjectCrew("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;

    expect(data.pm?.id).toBe("u-op");
    expect(data.subcontractor?.id).toBe("u-sub");
    expect(data.subcontractor?.role).toBe("Subcontractor");
    expect(data.crew.map((c) => c.id)).toEqual(["u-crew"]);
  });

  it("falls back to legacy users.role when user_roles join is empty", async () => {
    project = { team_member_ids: ["u-legacy"] };
    users = [
      { id: "u-legacy", first_name: "Legacy", last_name: "Owner", email: null, phone: null, user_color: null, user_type: "company", role: "owner" },
    ];
    userRoles = []; // no rows in the new role system

    const { result } = renderHook(() => useProjectCrew("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.pm?.id).toBe("u-legacy");
    expect(result.current.data!.pm?.role).toBe("Owner");
  });

  it("returns null pm and empty crew when team_member_ids is empty", async () => {
    project = { team_member_ids: [] };

    const { result } = renderHook(() => useProjectCrew("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      pm: null,
      crew: [],
      subcontractor: null,
    });
  });

  it("treats team-of-only-crew as crew with null pm", async () => {
    project = { team_member_ids: ["u-1", "u-2"] };
    users = [
      { id: "u-1", first_name: "A", last_name: "B", email: null, phone: null, user_color: null, user_type: "employee", role: "crew" },
      { id: "u-2", first_name: "C", last_name: "D", email: null, phone: null, user_color: null, user_type: "employee", role: "crew" },
    ];
    userRoles = [
      { user_id: "u-1", roles: { name: "Crew", hierarchy: 5 } },
      { user_id: "u-2", roles: { name: "Crew", hierarchy: 5 } },
    ];

    const { result } = renderHook(() => useProjectCrew("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.pm).toBeNull();
    expect(result.current.data!.crew).toHaveLength(2);
  });

  it("does not fetch when projectId is null", async () => {
    const { result } = renderHook(() => useProjectCrew(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isFetching).toBe(false);
  });
});

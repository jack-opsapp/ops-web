/**
 * useProjectTeam — workspace TEAM rail.
 *
 * OPS team is flat. There is no PM concept and no subcontractor concept on
 * a project. Each member's "role label" on a project is the set of task
 * types they're assigned to (e.g. "Roofing · Framing"), computed from
 * tasks.team_member_ids → tasks.task_type_id → task_types_v2.display.
 *
 * This hook is a derived value, not a TanStack Query call — it composes
 * upstream queries (useProject, useTeamMembers, useProjectTasks, useTaskTypes)
 * and is reactive to their cache. Tests mock those hooks directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Project, User, ProjectTask, TaskType } from "@/lib/types/models";

// ─── Mock state ─────────────────────────────────────────────────────────────

let mockProject: { teamMemberIds: string[] } | null = null;
let mockUsers: User[] = [];
let mockTasks: ProjectTask[] = [];
let mockTaskTypes: TaskType[] = [];

vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => ({ data: mockProject as Project | undefined }),
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: mockUsers, remaining: 0, count: mockUsers.length } }),
}));
vi.mock("@/lib/hooks/use-tasks", () => ({
  useProjectTasks: () => ({ data: mockTasks }),
}));
vi.mock("@/lib/hooks/use-task-types", () => ({
  useTaskTypes: () => ({ data: mockTaskTypes }),
}));

// ─── Test harness ────────────────────────────────────────────────────────────

import { useProjectTeam } from "@/lib/hooks/use-project-team";

function makeUser(id: string, first: string, last: string, overrides: Partial<User> = {}): User {
  return {
    id,
    firstName: first,
    lastName: last,
    email: `${first.toLowerCase()}@test.co`,
    phone: "555-0100",
    profileImageURL: null,
    role: "operator" as User["role"],
    companyId: "co-1",
    userType: null,
    latitude: null,
    longitude: null,
    locationName: null,
    homeAddress: null,
    clientId: null,
    isActive: true,
    userColor: "#9DB582",
    devPermission: false,
    onboardingCompleted: {} as User["onboardingCompleted"],
    hasCompletedAppTutorial: true,
    isCompanyAdmin: false,
    specialPermissions: [],
    setupProgress: null,
    stripeCustomerId: null,
    deviceToken: null,
    ...overrides,
  } as User;
}

function makeTask(
  id: string,
  taskTypeId: string,
  teamMemberIds: string[],
  overrides: Partial<ProjectTask> = {},
): ProjectTask {
  return {
    id,
    projectId: "proj-1",
    companyId: "co-1",
    status: "Active" as ProjectTask["status"],
    taskColor: "#000",
    taskNotes: null,
    taskTypeId,
    taskIndex: 0,
    displayOrder: 0,
    customTitle: null,
    sourceLineItemId: null,
    sourceEstimateId: null,
    teamMemberIds,
    startDate: null,
    endDate: null,
    duration: 0,
    allDay: true,
    recurrenceId: null,
    recurrenceOriginDate: null,
    deletedAt: null,
    ...overrides,
  } as ProjectTask;
}

function makeTaskType(id: string, display: string): TaskType {
  return {
    id,
    color: "#6F94B0",
    display,
    icon: null,
    isDefault: false,
    companyId: "co-1",
    displayOrder: 0,
    defaultTeamMemberIds: [],
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
  };
}

beforeEach(() => {
  mockProject = null;
  mockUsers = [];
  mockTasks = [];
  mockTaskTypes = [];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useProjectTeam", () => {
  it("returns empty members when project is undefined", () => {
    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members).toEqual([]);
  });

  it("returns empty members when project has no team_member_ids", () => {
    mockProject = { teamMemberIds: [] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson")];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members).toEqual([]);
  });

  it("returns flat list — no pm, crew, or subcontractor keys", () => {
    mockProject = { teamMemberIds: ["u-1"] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson")];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current).toEqual({
      members: [
        expect.objectContaining({
          id: "u-1",
          name: "Alice Anderson",
        }),
      ],
    });
    expect(result.current).not.toHaveProperty("pm");
    expect(result.current).not.toHaveProperty("crew");
    expect(result.current).not.toHaveProperty("subcontractor");
  });

  it("derives taskTypeNames from tasks the member is assigned to", () => {
    mockProject = { teamMemberIds: ["u-1", "u-2"] };
    mockUsers = [
      makeUser("u-1", "Alice", "Anderson"),
      makeUser("u-2", "Bob", "Brown"),
    ];
    mockTaskTypes = [
      makeTaskType("tt-roof", "Roofing"),
      makeTaskType("tt-frame", "Framing"),
      makeTaskType("tt-paint", "Painting"),
    ];
    mockTasks = [
      makeTask("t-1", "tt-roof", ["u-1"]),
      makeTask("t-2", "tt-frame", ["u-1", "u-2"]),
      makeTask("t-3", "tt-paint", ["u-2"]),
    ];

    const { result } = renderHook(() => useProjectTeam("proj-1"));

    const alice = result.current.members.find((m) => m.id === "u-1")!;
    const bob = result.current.members.find((m) => m.id === "u-2")!;
    expect(alice.taskTypeNames.sort()).toEqual(["Framing", "Roofing"]);
    expect(bob.taskTypeNames.sort()).toEqual(["Framing", "Painting"]);
  });

  it("dedupes task type names when a member is on multiple tasks of the same type", () => {
    mockProject = { teamMemberIds: ["u-1"] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson")];
    mockTaskTypes = [makeTaskType("tt-roof", "Roofing")];
    mockTasks = [
      makeTask("t-1", "tt-roof", ["u-1"]),
      makeTask("t-2", "tt-roof", ["u-1"]),
      makeTask("t-3", "tt-roof", ["u-1"]),
    ];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members[0].taskTypeNames).toEqual(["Roofing"]);
  });

  it("returns members with empty taskTypeNames when assigned to no tasks", () => {
    mockProject = { teamMemberIds: ["u-1"] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson")];
    mockTaskTypes = [makeTaskType("tt-roof", "Roofing")];
    mockTasks = []; // no tasks

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members).toHaveLength(1);
    expect(result.current.members[0].taskTypeNames).toEqual([]);
  });

  it("ignores deleted tasks when computing taskTypeNames", () => {
    mockProject = { teamMemberIds: ["u-1"] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson")];
    mockTaskTypes = [
      makeTaskType("tt-roof", "Roofing"),
      makeTaskType("tt-frame", "Framing"),
    ];
    mockTasks = [
      makeTask("t-1", "tt-roof", ["u-1"]),
      makeTask("t-2", "tt-frame", ["u-1"], { deletedAt: new Date() }),
    ];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members[0].taskTypeNames).toEqual(["Roofing"]);
  });

  it("orders members alphabetically by name", () => {
    mockProject = { teamMemberIds: ["u-1", "u-2", "u-3"] };
    mockUsers = [
      makeUser("u-1", "Charlie", "Connor"),
      makeUser("u-2", "Alice", "Anderson"),
      makeUser("u-3", "Bob", "Brown"),
    ];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members.map((m) => m.name)).toEqual([
      "Alice Anderson",
      "Bob Brown",
      "Charlie Connor",
    ]);
  });

  it("filters out team_member_ids that have no matching user record", () => {
    mockProject = { teamMemberIds: ["u-1", "u-missing"] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson")];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members).toHaveLength(1);
    expect(result.current.members[0].id).toBe("u-1");
  });

  it("falls back to default avatar color when userColor is null", () => {
    mockProject = { teamMemberIds: ["u-1"] };
    mockUsers = [makeUser("u-1", "Alice", "Anderson", { userColor: null })];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    expect(result.current.members[0].avatarColor).toBe("#6F94B0");
  });

  it("exposes email, phone, profileImageURL on each member", () => {
    mockProject = { teamMemberIds: ["u-1"] };
    mockUsers = [
      makeUser("u-1", "Alice", "Anderson", {
        email: "alice@test.co",
        phone: "555-0123",
        profileImageURL: "https://cdn.test/alice.jpg",
      }),
    ];

    const { result } = renderHook(() => useProjectTeam("proj-1"));
    const m = result.current.members[0];
    expect(m.email).toBe("alice@test.co");
    expect(m.phone).toBe("555-0123");
    expect(m.profileImageURL).toBe("https://cdn.test/alice.jpg");
  });

  it("returns empty members when projectId is null", () => {
    const { result } = renderHook(() => useProjectTeam(null));
    expect(result.current.members).toEqual([]);
  });
});

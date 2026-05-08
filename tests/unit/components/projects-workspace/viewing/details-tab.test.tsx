import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockProject = vi.fn();
const mockTeam = vi.fn();
const mockTasks = vi.fn();

vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => mockProject(),
}));
vi.mock("@/lib/hooks/use-project-team", () => ({
  useProjectTeam: () => mockTeam(),
}));
vi.mock("@/lib/hooks/use-project-tasks-grouped", () => ({
  useProjectTasksGrouped: () => mockTasks(),
}));

const { DetailsTab } = await import(
  "@/components/ops/projects/workspace/viewing/details-tab"
);

describe("<DetailsTab>", () => {
  beforeEach(() => {
    mockProject.mockReturnValue({
      data: {
        id: "p1",
        title: "Acme HQ",
        projectDescription: "Replace flat roof and add 3 skylights.",
      },
    });
    mockTeam.mockReturnValue({
      members: [
        {
          id: "u1",
          name: "Jackson Sweet",
          email: null,
          phone: null,
          avatarColor: "#6F94B0",
          profileImageURL: null,
          taskTypeNames: ["Roofing", "Framing"],
        },
        {
          id: "u2",
          name: "Maria Lopez",
          email: null,
          phone: null,
          avatarColor: "#9DB582",
          profileImageURL: null,
          taskTypeNames: [],
        },
      ],
    });
    mockTasks.mockReturnValue({
      data: {
        done: [
          {
            id: "t1",
            title: "Tear-off",
            status: "completed",
            startDate: "2026-05-01",
            endDate: "2026-05-02",
            chipColor: "#9DB582",
            chipLabel: "Roofing",
            chipIcon: null,
            teamMemberIds: [],
            displayOrder: 0,
          },
        ],
        active: [
          {
            id: "t2",
            title: "Decking",
            status: "active",
            startDate: "2026-05-07",
            endDate: "2026-05-09",
            chipColor: "#9DB582",
            chipLabel: "Roofing",
            chipIcon: null,
            teamMemberIds: [],
            displayOrder: 1,
          },
        ],
        upcoming: [
          {
            id: "t3",
            title: "Inspection",
            status: "active",
            startDate: "2026-05-12",
            endDate: "2026-05-12",
            chipColor: "#C4A868",
            chipLabel: "QA",
            chipIcon: null,
            teamMemberIds: [],
            displayOrder: 2,
          },
        ],
        totals: { done: 1, total: 3 },
      },
      isLoading: false,
    });
  });

  it("renders the scope description from project.projectDescription", () => {
    render(<DetailsTab projectId="p1" />);
    expect(
      screen.getByText("Replace flat roof and add 3 skylights."),
    ).toBeInTheDocument();
  });

  it("renders the empty scope state when projectDescription is null", () => {
    mockProject.mockReturnValue({ data: { id: "p1", title: "x", projectDescription: null } });
    render(<DetailsTab projectId="p1" />);
    expect(screen.getByText(/No scope written yet/i)).toBeInTheDocument();
  });

  it("renders one row per team member", () => {
    render(<DetailsTab projectId="p1" />);
    expect(screen.getAllByTestId("team-row")).toHaveLength(2);
    expect(screen.getByText("Jackson Sweet")).toBeInTheDocument();
    expect(screen.getByText("Maria Lopez")).toBeInTheDocument();
  });

  it("renders task type names joined with ' · ' for assigned members", () => {
    render(<DetailsTab projectId="p1" />);
    expect(screen.getByText("Roofing · Framing")).toBeInTheDocument();
  });

  it("renders UNASSIGNED for members with no task type assignments", () => {
    render(<DetailsTab projectId="p1" />);
    expect(screen.getByText("UNASSIGNED")).toBeInTheDocument();
  });

  it("partitions tasks into Active / Upcoming / Done groups", () => {
    render(<DetailsTab projectId="p1" />);
    expect(screen.getByTestId("task-group-active")).toBeInTheDocument();
    expect(screen.getByTestId("task-group-upcoming")).toBeInTheDocument();
    expect(screen.getByTestId("task-group-done")).toBeInTheDocument();
  });

  it("renders the totals header `done/total`", () => {
    render(<DetailsTab projectId="p1" />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("renders the empty tasks state when totals.total is 0", () => {
    mockTasks.mockReturnValue({
      data: { done: [], active: [], upcoming: [], totals: { done: 0, total: 0 } },
      isLoading: false,
    });
    render(<DetailsTab projectId="p1" />);
    expect(screen.getByText(/No tasks scheduled/i)).toBeInTheDocument();
  });
});

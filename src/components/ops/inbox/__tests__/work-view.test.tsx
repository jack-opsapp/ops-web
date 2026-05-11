import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkView } from "../context-rail/work-view";
import { ProjectStatus } from "@/lib/types/models";
import type { Project } from "@/lib/types/models";
import type { PipelineOpp } from "../context-rail/pipeline-list";
import type { ClientTaskRow } from "@/lib/hooks/use-client-tasks";

const baseProject = (overrides: Partial<Project>): Project => ({
  id: "p1",
  title: "Roof replacement",
  address: null,
  latitude: null,
  longitude: null,
  startDate: null,
  endDate: null,
  duration: null,
  status: ProjectStatus.InProgress,
  notes: null,
  companyId: "c1",
  clientId: "cl1",
  opportunityId: null,
  allDay: false,
  teamMemberIds: [],
  projectDescription: null,
  projectImages: [],
  trade: null,
  visibility: "all",
  createdAt: null,
  lastSyncedAt: null,
  needsSync: false,
  syncPriority: 0,
  deletedAt: null,
  ...overrides,
});

const opps: PipelineOpp[] = [
  {
    id: "opp1",
    title: "Annual maintenance",
    value: 8500,
    stage: "Lead",
    confidence: "low",
    source: "Website",
    threadId: "th-current",
    estimateRef: null,
  },
];

const tasks: ClientTaskRow[] = [
  {
    id: "t1",
    projectId: "p1",
    label: "Strip old shingles",
    assignee: "Reed",
    due: "Apr 26",
    status: "todo",
    overdue: false,
  },
  {
    id: "t2",
    projectId: "p1",
    label: "Install underlayment",
    assignee: "You",
    due: "TODAY 17:00",
    status: "active",
    overdue: false,
  },
  {
    id: "t3",
    projectId: "p2",
    label: "Schedule inspection",
    assignee: "Unassigned",
    due: "—",
    status: "todo",
    overdue: false,
  },
];

const projects: Project[] = [
  baseProject({
    id: "p1",
    title: "Roof replacement",
    status: ProjectStatus.InProgress,
    opportunityId: "opp1",
  }),
  baseProject({
    id: "p2",
    title: "Heater swap",
    status: ProjectStatus.RFQ,
    opportunityId: null,
  }),
];

describe("<WorkView>", () => {
  it("renders both LEADS and PROJECTS section headers when both have data", () => {
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={tasks}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    expect(screen.getByText(/\/\/ LEADS/)).toBeInTheDocument();
    expect(screen.getByText(/\/\/ PROJECTS/)).toBeInTheDocument();
  });

  it("renders the leads section pipeline empty state but still shows the projects section when there are no opps", () => {
    render(
      <WorkView
        pipelineOpps={[]}
        projects={projects}
        tasks={tasks}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    // PipelineList's own empty body
    expect(screen.getByText(/no open opportunities/i)).toBeInTheDocument();
    // Projects still render
    expect(screen.getByText("Roof replacement")).toBeInTheDocument();
    expect(screen.getByText("Heater swap")).toBeInTheDocument();
  });

  it("renders only the leads section + the [+ NEW PROJECT] button when projects is empty", () => {
    render(
      <WorkView
        pipelineOpps={opps}
        projects={[]}
        tasks={[]}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    expect(screen.getByText("Annual maintenance")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /\+ NEW PROJECT/i }),
    ).toBeInTheDocument();
    // No project group rendered
    expect(screen.queryByTestId(/project-group-/)).not.toBeInTheDocument();
  });

  it("toggles the task list when the project group chevron is clicked", () => {
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={tasks}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    // Initially collapsed — task labels not visible
    expect(screen.queryByText("Strip old shingles")).not.toBeInTheDocument();
    // Expand the first project
    const expandBtn = screen.getByRole("button", {
      name: /Expand Roof replacement/i,
    });
    fireEvent.click(expandBtn);
    expect(screen.getByText("Strip old shingles")).toBeInTheDocument();
    expect(screen.getByText("Install underlayment")).toBeInTheDocument();
    // Heater swap tasks still hidden
    expect(screen.queryByText("Schedule inspection")).not.toBeInTheDocument();
    // Collapse again
    fireEvent.click(
      screen.getByRole("button", { name: /Collapse Roof replacement/i }),
    );
    expect(screen.queryByText("Strip old shingles")).not.toBeInTheDocument();
  });

  it("flags the linked-to-thread project with data-current=true (accent indicator)", () => {
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={tasks}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    // p1 owns opp1 which is linked to th-current → data-current="true"
    const linked = screen.getByTestId("project-group-p1");
    expect(linked.getAttribute("data-current")).toBe("true");
    // p2 has no opportunityId, so it stays neutral
    const unlinked = screen.getByTestId("project-group-p2");
    expect(unlinked.getAttribute("data-current")).toBe("false");
  });

  it("renders the OPEN button as a `?project={id}` link when no onOpenProject is supplied", () => {
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={[]}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    const openLinks = screen.getAllByRole("link", { name: /Open project/i });
    const hrefs = openLinks.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("?project=p1");
    expect(hrefs).toContain("?project=p2");
  });

  it("calls onNewProject when the [+ NEW PROJECT] button is pressed", () => {
    const onNewProject = vi.fn();
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={[]}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={onNewProject}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /\+ NEW PROJECT/i }),
    );
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenProject (instead of the link fallback) when supplied", () => {
    const onOpenProject = vi.fn();
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={[]}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
        onOpenProject={onOpenProject}
      />,
    );
    const group = screen.getByTestId("project-group-p1");
    fireEvent.click(within(group).getByRole("button", { name: /Open project/i }));
    expect(onOpenProject).toHaveBeenCalledWith("p1");
  });

  it("displays done/total counts derived from the supplied tasks", () => {
    render(
      <WorkView
        pipelineOpps={opps}
        projects={projects}
        tasks={tasks}
        currentThreadId="th-current"
        onNewOpportunity={() => {}}
        onNewProject={() => {}}
      />,
    );
    // p1 has 2 tasks (none done), p2 has 1 task (none done)
    const groupP1 = screen.getByTestId("project-group-p1");
    expect(within(groupP1).getByText("0/2")).toBeInTheDocument();
    const groupP2 = screen.getByTestId("project-group-p2");
    expect(within(groupP2).getByText("0/1")).toBeInTheDocument();
  });
});

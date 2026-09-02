import { type ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PipelineFilterChips } from "@/app/(dashboard)/pipeline/_components/pipeline-filter-chips";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) =>
      ({
        "filter.allStages": "All Stages",
        "filter.everyone": "Everyone",
        "filter.mine": "Mine",
        "filter.unassigned": "Unassigned",
      })[key] ?? key,
  }),
}));

const TEAM_MEMBERS = [{ id: "user-1", firstName: "Avery", lastName: "Stone" }];

function renderChips(
  overrides: Partial<ComponentProps<typeof PipelineFilterChips>> = {}
) {
  const props: ComponentProps<typeof PipelineFilterChips> = {
    stageFilter: "all",
    onStageFilterChange: vi.fn(),
    assigneeFilter: "all",
    onAssigneeFilterChange: vi.fn(),
    teamMembers: TEAM_MEMBERS,
    currentUserId: "current-user",
    showAssigneeFilter: true,
    ...overrides,
  };

  return {
    ...render(<PipelineFilterChips {...props} />),
    props,
  };
}

describe("<PipelineFilterChips>", () => {
  it("renders active stages in the compact stage picker", async () => {
    const user = userEvent.setup();
    renderChips();

    await user.click(screen.getByRole("button", { name: "All Stages" }));
    const panel = await screen.findByRole("dialog", { name: "All Stages" });
    expect(
      within(panel).getByRole("option", { name: "Quoted" })
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("option", { name: "Negotiation" })
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("option", { name: "Won" })).toBeNull();
  });

  it("commits a stage selection from the stage picker", async () => {
    const user = userEvent.setup();
    const { props } = renderChips();

    await user.click(screen.getByRole("button", { name: "All Stages" }));
    const panel = await screen.findByRole("dialog", { name: "All Stages" });
    await user.click(within(panel).getByRole("option", { name: "Quoted" }));
    expect(props.onStageFilterChange).toHaveBeenCalledWith("quoted");
  });

  it("scopes the assignee trigger and its portaled panel out of global keyboard nav", async () => {
    const user = userEvent.setup();
    renderChips();

    const assigneeTrigger = screen.getByRole("button", { name: "Everyone" });
    expect(
      assigneeTrigger.closest("[data-keyboard-scope='modal-or-menu']")
    ).not.toBeNull();

    await user.click(assigneeTrigger);
    const panel = await screen.findByRole("dialog", { name: "Everyone" });
    expect(panel).toHaveAttribute("data-keyboard-scope", "modal-or-menu");
  });

  it("maps typed assignee rows through the 'all' sentinel in both directions", async () => {
    const user = userEvent.setup();
    const { props } = renderChips({ assigneeFilter: "user:user-1" });

    // Trigger reads the active member's name once filtered.
    const trigger = screen.getByRole("button", { name: "Avery Stone" });
    await user.click(trigger);

    // The none row ("Everyone") clears back to the sentinel.
    const panel = await screen.findByRole("dialog", { name: "Everyone" });
    const noneRow = within(panel).getByRole("option", { name: "Everyone" });
    await user.click(noneRow);
    expect(props.onAssigneeFilterChange).toHaveBeenCalledWith("all");
  });

  it("offers Mine first and Unassigned as first-class queue filters", async () => {
    const user = userEvent.setup();
    const { props } = renderChips();

    await user.click(screen.getByRole("button", { name: "Everyone" }));
    const panel = await screen.findByRole("dialog", { name: "Everyone" });
    const options = within(panel).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Everyone",
      "Mine",
      "Unassigned",
      "Avery Stone",
    ]);

    await user.click(within(panel).getByRole("option", { name: "Mine" }));
    expect(props.onAssigneeFilterChange).toHaveBeenCalledWith("mine");
  });

  it("suppresses the redundant assignee filter for assigned-only viewers", () => {
    renderChips({ showAssigneeFilter: false });

    expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "All Stages" })
    ).toBeInTheDocument();
  });
});

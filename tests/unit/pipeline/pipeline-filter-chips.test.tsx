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
  it("renders the stage filter as inline chips (all + active stages), no dropdown", () => {
    renderChips();

    // Stage chips are rendered inline — no listbox to open. "All Stages" is a
    // chip, not a trigger, and each active stage is directly clickable.
    expect(
      screen.getByRole("button", { name: "All Stages" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quoted" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Negotiation" })
    ).toBeInTheDocument();
    // Terminal stages are excluded from the filter (getActiveStages).
    expect(screen.queryByRole("button", { name: "Won" })).toBeNull();
  });

  it("commits a stage selection directly from the chip", async () => {
    const user = userEvent.setup();
    const { props } = renderChips();

    await user.click(screen.getByRole("button", { name: "Quoted" }));
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

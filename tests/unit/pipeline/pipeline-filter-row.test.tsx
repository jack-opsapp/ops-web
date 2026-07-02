import { useState, type ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PipelineFilterRow } from "@/app/(dashboard)/pipeline/_components/pipeline-filter-row";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) =>
      ({
        "focused.search.placeholder": "search pipeline...",
        "filter.allStages": "All Stages",
        "filter.everyone": "Everyone",
        newLead: "New Lead",
      })[key] ?? key,
  }),
}));

const TEAM_MEMBERS = [{ id: "user-1", firstName: "Avery", lastName: "Stone" }];

function renderFilterRow(
  overrides: Partial<ComponentProps<typeof PipelineFilterRow>> = {}
) {
  const props: ComponentProps<typeof PipelineFilterRow> = {
    searchQuery: "",
    onSearchChange: vi.fn(),
    stageFilter: "all",
    onStageFilterChange: vi.fn(),
    assigneeFilter: "all",
    onAssigneeFilterChange: vi.fn(),
    teamMembers: TEAM_MEMBERS,
    onAddLead: vi.fn(),
    canManage: true,
    ...overrides,
  };

  return {
    ...render(<PipelineFilterRow {...props} />),
    props,
  };
}

describe("<PipelineFilterRow>", () => {
  it("renders a native search input using the dictionary placeholder", () => {
    renderFilterRow();

    const input = screen.getByRole("searchbox", {
      name: "search pipeline...",
    });

    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("placeholder", "search pipeline...");
  });

  it("calls onSearchChange as the operator types", async () => {
    const onSearchChange = vi.fn();

    function Harness() {
      const [searchQuery, setSearchQuery] = useState("");
      return (
        <PipelineFilterRow
          searchQuery={searchQuery}
          onSearchChange={(query) => {
            onSearchChange(query);
            setSearchQuery(query);
          }}
          stageFilter="all"
          onStageFilterChange={vi.fn()}
          assigneeFilter="all"
          onAssigneeFilterChange={vi.fn()}
          teamMembers={TEAM_MEMBERS}
          onAddLead={vi.fn()}
          canManage={true}
        />
      );
    }

    render(<Harness />);
    await userEvent.type(
      screen.getByRole("searchbox", { name: "search pipeline..." }),
      "deck"
    );

    expect(onSearchChange).toHaveBeenLastCalledWith("deck");
  });

  it("renders the focused toolbar variant as one restrained toolbar row", () => {
    renderFilterRow({ variant: "toolbar" });

    const row = screen
      .getByRole("searchbox", { name: "search pipeline..." })
      .closest("[data-pipeline-filter-row]");
    const addLead = screen.getByRole("button", { name: /New Lead/ });

    expect(row).toHaveAttribute("data-pipeline-filter-row", "toolbar");
    expect(row).toHaveClass("flex-nowrap");
    // New Lead is the pipeline's single filled-primary accent CTA. In the
    // compact toolbar variant it keeps the accent FILL (denser: h-26 /
    // text-micro), not downgraded to a restrained ghost.
    expect(addLead).toHaveClass(
      "h-[26px]",
      "bg-ops-accent",
      "border-ops-accent",
      "text-black",
      "text-micro"
    );
    expect(addLead).not.toHaveClass("bg-surface-active");
    expect(addLead).not.toHaveClass("bg-white/[0.04]");
  });

  it("scopes dropdown triggers and portaled picker panels out of global keyboard navigation", async () => {
    const user = userEvent.setup();
    renderFilterRow();

    const stageTrigger = screen.getByRole("button", { name: "All Stages" });
    const assigneeTrigger = screen.getByRole("button", { name: "Everyone" });

    expect(stageTrigger.closest("[data-keyboard-scope='modal-or-menu']")).not
      .toBeNull();
    expect(
      assigneeTrigger.closest("[data-keyboard-scope='modal-or-menu']")
    ).not.toBeNull();

    // The panels portal to the body (Picker kit), so the scope attribute must
    // ride on the panel itself — an ancestor's attribute can't cover it.
    await user.click(stageTrigger);
    const stagePanel = await screen.findByRole("dialog", {
      name: "All Stages",
    });
    expect(stagePanel).toHaveAttribute("data-keyboard-scope", "modal-or-menu");
    await user.keyboard("{Escape}");

    await user.click(assigneeTrigger);
    const assigneePanel = await screen.findByRole("dialog", {
      name: "Everyone",
    });
    expect(assigneePanel).toHaveAttribute(
      "data-keyboard-scope",
      "modal-or-menu"
    );
  });

  it("commits a stage selection and maps the none row back to 'all'", async () => {
    const user = userEvent.setup();
    const { props } = renderFilterRow();

    await user.click(screen.getByRole("button", { name: "All Stages" }));
    await user.click(await screen.findByText("Quoted"));
    expect(props.onStageFilterChange).toHaveBeenCalledWith("quoted");
  });

  it("maps the assignee rows through the 'all' sentinel in both directions", async () => {
    const user = userEvent.setup();
    const { props } = renderFilterRow({ assigneeFilter: "user-1" });

    // Trigger reads the active member's name once filtered.
    const trigger = screen.getByRole("button", { name: "Avery Stone" });
    await user.click(trigger);

    // The none row ("Everyone") clears back to the sentinel.
    const panel = await screen.findByRole("dialog", { name: "Everyone" });
    const noneRow = within(panel).getByRole("option", { name: "Everyone" });
    await user.click(noneRow);
    expect(props.onAssigneeFilterChange).toHaveBeenCalledWith("all");
  });
});

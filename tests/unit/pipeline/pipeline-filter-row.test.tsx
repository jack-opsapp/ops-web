import { useState, type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
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
});

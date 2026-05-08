import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnitPicker } from "@/components/ops/unit-picker";

// jsdom doesn't ship `scrollIntoView` on Element. cmdk calls it when
// activating an item — without the stub, every popover interaction
// crashes with "scrollIntoView is not a function".
if (!("scrollIntoView" in Element.prototype)) {
  Element.prototype.scrollIntoView = function () {};
}

vi.mock("@/lib/hooks/use-catalog-lookups", () => ({
  useCatalogLookups: () => ({
    categories: [],
    units: [
      { id: "u-1", display: "EACH", abbreviation: "EA" },
      { id: "u-2", display: "HOUR", abbreviation: "HR" },
      { id: "u-3", display: "BOARD FT", abbreviation: null },
    ],
    isLoading: false,
  }),
}));

describe("<UnitPicker>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the placeholder when no value is selected", () => {
    render(
      <UnitPicker
        value={null}
        onChange={() => {}}
        onCreateNew={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /select unit/i })).toBeInTheDocument();
  });

  it("renders the selected unit's display when value matches a row", () => {
    render(
      <UnitPicker
        value="u-2"
        onChange={() => {}}
        onCreateNew={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /unit: hour/i })).toBeInTheDocument();
  });

  it("opens the popover and lists units alphabetically with abbreviations", async () => {
    const user = userEvent.setup();
    render(
      <UnitPicker
        value={null}
        onChange={() => {}}
        onCreateNew={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: /select unit/i }));
    expect(await screen.findByText("BOARD FT")).toBeInTheDocument();
    expect(screen.getByText("EACH")).toBeInTheDocument();
    expect(screen.getByText("HOUR")).toBeInTheDocument();
    // Abbreviations render alongside their display.
    expect(screen.getByText("EA")).toBeInTheDocument();
    expect(screen.getByText("HR")).toBeInTheDocument();
  });

  it("fires onChange with id + display when a unit is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <UnitPicker
        value={null}
        onChange={onChange}
        onCreateNew={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: /select unit/i }));
    const item = await screen.findByText("HOUR");
    await user.click(item);
    expect(onChange).toHaveBeenCalledWith("u-2", "HOUR");
  });

  it("fires onCreateNew when the inline + NEW item is picked", async () => {
    const onCreateNew = vi.fn();
    const user = userEvent.setup();
    render(
      <UnitPicker
        value={null}
        onChange={() => {}}
        onCreateNew={onCreateNew}
      />
    );
    await user.click(screen.getByRole("button", { name: /select unit/i }));
    const createItem = await screen.findByText(/new unit…/i);
    await user.click(createItem);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

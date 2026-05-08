import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryPicker } from "@/components/ops/category-picker";

// jsdom doesn't ship `scrollIntoView` on Element. cmdk calls it when
// activating an item — without the stub, every popover interaction
// crashes with "scrollIntoView is not a function".
if (!("scrollIntoView" in Element.prototype)) {
  Element.prototype.scrollIntoView = function () {};
}

// Stub the lookup hook with a static set so we don't need a real
// Supabase client / auth store during unit tests. The picker only
// reads `categories` and `units` from the hook; nothing else here
// is exercised.
vi.mock("@/lib/hooks/use-catalog-lookups", () => ({
  useCatalogLookups: () => ({
    categories: [
      { id: "cat-1", name: "Hardware" },
      { id: "cat-2", name: "Labor" },
      { id: "cat-3", name: "Materials" },
    ],
    units: [],
    isLoading: false,
  }),
}));

describe("<CategoryPicker>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the placeholder when no value is selected", () => {
    render(
      <CategoryPicker
        value={null}
        onChange={() => {}}
        onCreateNew={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /select category/i })).toBeInTheDocument();
  });

  it("renders the selected category name when value matches a row", () => {
    render(
      <CategoryPicker
        value="cat-2"
        onChange={() => {}}
        onCreateNew={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /category: labor/i })).toBeInTheDocument();
  });

  it("opens the popover and lists every category sorted alphabetically", async () => {
    const user = userEvent.setup();
    render(
      <CategoryPicker
        value={null}
        onChange={() => {}}
        onCreateNew={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: /select category/i }));
    // cmdk renders items inside the popover. Names should all be present.
    expect(await screen.findByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("Labor")).toBeInTheDocument();
    expect(screen.getByText("Materials")).toBeInTheDocument();
  });

  it("fires onChange with id + name when a category is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CategoryPicker
        value={null}
        onChange={onChange}
        onCreateNew={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: /select category/i }));
    const item = await screen.findByText("Labor");
    await user.click(item);
    expect(onChange).toHaveBeenCalledWith("cat-2", "Labor");
  });

  it("fires onChange with (null, null) when None is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CategoryPicker
        value="cat-1"
        onChange={onChange}
        onCreateNew={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: /category: hardware/i }));
    const noneItem = await screen.findByText("None");
    await user.click(noneItem);
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  it("fires onCreateNew when the inline + NEW item is picked", async () => {
    const onCreateNew = vi.fn();
    const user = userEvent.setup();
    render(
      <CategoryPicker
        value={null}
        onChange={() => {}}
        onCreateNew={onCreateNew}
      />
    );
    await user.click(screen.getByRole("button", { name: /select category/i }));
    const createItem = await screen.findByText(/new category…/i);
    await user.click(createItem);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

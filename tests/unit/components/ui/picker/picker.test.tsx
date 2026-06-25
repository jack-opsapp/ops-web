import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Picker,
  PickerTrigger,
  PickerContent,
  PickerSearch,
  PickerList,
  PickerEmpty,
  PickerItem,
  PickerFooterAction,
} from "@/components/ui/picker";

const ITEMS = [
  { id: "cat-1", label: "Hardware" },
  { id: "cat-2", label: "Labor" },
  { id: "cat-3", label: "Materials" },
];

function SingleHarness({
  onPick,
  onCreate,
}: {
  onPick?: (id: string) => void;
  onCreate?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [value, setValue] = React.useState<string | null>(null);
  return (
    <Picker open={open} onOpenChange={setOpen}>
      <PickerTrigger asChild>
        <button type="button">Open picker</button>
      </PickerTrigger>
      <PickerContent label="Categories">
        <PickerSearch
          value={search}
          onValueChange={setSearch}
          placeholder="Search"
          clearLabel="Clear search"
        />
        <PickerList>
          <PickerEmpty>No matches</PickerEmpty>
          {ITEMS.map((it) => (
            <PickerItem
              key={it.id}
              value={it.label}
              selected={value === it.id}
              onSelect={() => {
                setValue(it.id);
                onPick?.(it.id);
              }}
            >
              {it.label}
            </PickerItem>
          ))}
          <PickerItem value="Concrete" disabled onSelect={() => onPick?.("disabled")}>
            Concrete
          </PickerItem>
        </PickerList>
        <PickerFooterAction onClick={() => onCreate?.()}>New category</PickerFooterAction>
      </PickerContent>
    </Picker>
  );
}

function MultiHarness() {
  const [open, setOpen] = React.useState(false);
  const [ids, setIds] = React.useState<string[]>([]);
  const toggle = (id: string) =>
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <Picker open={open} onOpenChange={setOpen}>
      <PickerTrigger asChild>
        <button type="button">Open picker</button>
      </PickerTrigger>
      <PickerContent label="Crew">
        <PickerList>
          {ITEMS.map((it) => (
            <PickerItem
              key={it.id}
              value={it.label}
              multiple
              selected={ids.includes(it.id)}
              onSelect={() => toggle(it.id)}
            >
              {it.label}
            </PickerItem>
          ))}
        </PickerList>
      </PickerContent>
    </Picker>
  );
}

describe("Picker primitives", () => {
  it("opens on trigger click and lists every item", async () => {
    const user = userEvent.setup();
    render(<SingleHarness />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    expect(await screen.findByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("Labor")).toBeInTheDocument();
    expect(screen.getByText("Materials")).toBeInTheDocument();
  });

  it("filters items as you type", async () => {
    const user = userEvent.setup();
    render(<SingleHarness />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    await user.type(screen.getByPlaceholderText("Search"), "lab");
    expect(await screen.findByText("Labor")).toBeInTheDocument();
    expect(screen.queryByText("Hardware")).not.toBeInTheDocument();
    expect(screen.queryByText("Materials")).not.toBeInTheDocument();
  });

  it("commits on click and marks the chosen row", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<SingleHarness onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    await user.click(await screen.findByText("Labor"));
    expect(onPick).toHaveBeenCalledWith("cat-2");
    expect(screen.getByRole("option", { name: /labor/i })).toHaveAttribute("data-chosen", "true");
  });

  it("commits the keyboard-cursored item on Enter", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<SingleHarness onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    await screen.findByText("Hardware");
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<SingleHarness />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    await user.type(screen.getByPlaceholderText("Search"), "zzzzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

  it("clears the search via the clear button", async () => {
    const user = userEvent.setup();
    render(<SingleHarness />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    const input = screen.getByPlaceholderText("Search");
    await user.type(input, "lab");
    expect(screen.queryByText("Hardware")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear search/i }));
    expect(input).toHaveValue("");
    expect(await screen.findByText("Hardware")).toBeInTheDocument();
  });

  it("does not commit a disabled item", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<SingleHarness onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    await user.click(await screen.findByText("Concrete"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("fires the footer action", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<SingleHarness onCreate={onCreate} />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    await user.click(await screen.findByText(/new category/i));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("toggles multiple rows with aria-checked", async () => {
    const user = userEvent.setup();
    render(<MultiHarness />);
    await user.click(screen.getByRole("button", { name: /open picker/i }));
    const hardware = await screen.findByRole("option", { name: /hardware/i });
    expect(hardware).toHaveAttribute("aria-checked", "false");
    await user.click(hardware);
    expect(screen.getByRole("option", { name: /hardware/i })).toHaveAttribute("aria-checked", "true");
    const labor = screen.getByRole("option", { name: /labor/i });
    await user.click(labor);
    expect(screen.getByRole("option", { name: /labor/i })).toHaveAttribute("aria-checked", "true");
    // Hardware stays checked — multi-select does not clear siblings.
    expect(screen.getByRole("option", { name: /hardware/i })).toHaveAttribute("aria-checked", "true");
  });
});

import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityPicker } from "@/components/ui/entity-picker";

type Member = { id: string; name: string };
const MEMBERS: Member[] = [
  { id: "u1", name: "Dana Reyes" },
  { id: "u2", name: "Tariq Osei" },
  { id: "u3", name: "Marcus Webb" },
];

function SingleEP({
  onChange,
  noneOption,
  readOnly,
  onCreate,
}: {
  onChange?: (id: string | null) => void;
  noneOption?: boolean;
  readOnly?: boolean;
  onCreate?: () => void;
}) {
  const [value, setValue] = React.useState<string | null>(null);
  return (
    <EntityPicker<Member>
      trigger={<button type="button">Open</button>}
      items={MEMBERS}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      getId={(m) => m.id}
      getLabel={(m) => m.name}
      getAvatar={(m) => ({ name: m.name })}
      label="People"
      noneOption={noneOption}
      noneLabel="Unassigned"
      readOnly={readOnly}
      readOnlyLabel="View only"
      createAction={onCreate ? { label: "New person", onCreate } : undefined}
    />
  );
}

function MultiEP({ onChange }: { onChange?: (ids: string[]) => void }) {
  const [ids, setIds] = React.useState<string[]>([]);
  return (
    <EntityPicker<Member>
      multiple
      trigger={<button type="button">Open</button>}
      items={MEMBERS}
      value={ids}
      onChange={(next) => {
        setIds(next);
        onChange?.(next);
      }}
      getId={(m) => m.id}
      getLabel={(m) => m.name}
      getAvatar={(m) => ({ name: m.name })}
      conflictFor={(id) => (id === "u2" ? "Double-booked · Cedar & Main · Mon" : null)}
      label="Crew"
    />
  );
}

describe("<EntityPicker>", () => {
  it("single: commits the id and closes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SingleEP onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /open/i }));
    await user.click(await screen.findByText("Tariq Osei"));
    expect(onChange).toHaveBeenCalledWith("u2");
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /tariq/i })).not.toBeInTheDocument(),
    );
  });

  it("single: renders avatar initials in the rows", async () => {
    const user = userEvent.setup();
    render(<SingleEP />);
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByText("DR")).toBeInTheDocument();
    expect(screen.getByText("TO")).toBeInTheDocument();
  });

  it("single: none-option commits null", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SingleEP onChange={onChange} noneOption />);
    await user.click(screen.getByRole("button", { name: /open/i }));
    await user.click(await screen.findByText("Unassigned"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("single: read-only blocks selection and shows the notice", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SingleEP onChange={onChange} readOnly />);
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByText("View only")).toBeInTheDocument();
    await user.click(screen.getByText("Tariq Osei"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("single: create action fires", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<SingleEP onCreate={onCreate} />);
    await user.click(screen.getByRole("button", { name: /open/i }));
    await user.click(await screen.findByText("New person"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("single: query-aware create action reads the live search and receives it on create", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityPicker<Member>
        trigger={<button type="button">Open</button>}
        items={MEMBERS}
        value={null}
        onChange={() => {}}
        getId={(m) => m.id}
        getLabel={(m) => m.name}
        label="People"
        createAction={{
          label: (q) => (q ? `New person "${q}"` : "New person"),
          onCreate,
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByText("New person")).toBeInTheDocument();

    await user.type(screen.getByRole("combobox"), "Fo");
    await user.click(await screen.findByText('New person "Fo"'));
    expect(onCreate).toHaveBeenCalledWith("Fo");
  });

  describe("duplicate labels (real data: two clients named the same)", () => {
    type Client = { id: string; name: string; email: string };
    const DUPES: Client[] = [
      { id: "c-a", name: "Jordan Hale", email: "jordan.hale@example.com" },
      { id: "c-b", name: "Jordan Hale", email: "jhale.builds@example.net" },
      { id: "c-c", name: "Priya Nand", email: "priya.nand@example.org" },
    ];

    function DupeEP({ onChange }: { onChange: (id: string | null) => void }) {
      return (
        <EntityPicker<Client>
          trigger={<button type="button">Open</button>}
          items={DUPES}
          value={null}
          onChange={onChange}
          getId={(c) => c.id}
          getLabel={(c) => c.name}
          getDescription={(c) => c.email}
          getKeywords={(c) => [c.email]}
          label="Clients"
        />
      );
    }

    it("highlights exactly one row at a time and Enter commits that row's id", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<DupeEP onChange={onChange} />);
      await user.click(screen.getByRole("button", { name: /open/i }));
      await screen.findByText("jhale.builds@example.net");

      // cmdk opens with the first row under the cursor; move to the second
      // "Jordan Hale". Only that row may carry the cursor.
      await user.keyboard("{ArrowDown}");
      const highlighted = screen
        .getAllByRole("option")
        .filter((o) => o.getAttribute("data-selected") === "true");
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0]).toHaveTextContent("jhale.builds@example.net");

      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("c-b");
    });

    it("still searches by label and extra keywords, never by the id", async () => {
      const user = userEvent.setup();
      render(<DupeEP onChange={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /open/i }));

      await user.type(screen.getByRole("combobox"), "priya");
      await waitFor(() =>
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
          expect.stringContaining("Priya Nand"),
        ]),
      );

      await user.clear(screen.getByRole("combobox"));
      await user.type(screen.getByRole("combobox"), "jhale.builds");
      await waitFor(() => {
        const options = screen.getAllByRole("option");
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent("jhale.builds@example.net");
      });

      // "c-b" is an id, not searchable text — it must match nothing.
      await user.clear(screen.getByRole("combobox"));
      await user.type(screen.getByRole("combobox"), "c-b");
      await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    });
  });

  it("multi: toggles ids, stays open, surfaces conflicts", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MultiEP onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /open/i }));
    await user.click(await screen.findByText("Dana Reyes"));
    expect(onChange).toHaveBeenLastCalledWith(["u1"]);
    // still open → Tariq still visible
    await user.click(screen.getByText("Tariq Osei"));
    expect(onChange).toHaveBeenLastCalledWith(["u1", "u2"]);
    // conflict advisory shows on Tariq's row
    expect(screen.getByText(/double-booked · cedar & main · mon/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /dana/i })).toHaveAttribute("aria-checked", "true");
  });
});

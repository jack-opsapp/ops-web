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

/**
 * RegisterTable — sortable column headers.
 *
 * The affordance only: the table renders the control and reports `aria-sort`;
 * the caller owns the comparator and the toggle semantics. A table that passes
 * no `sort`/`onSortChange` and marks no column `sortable` must be untouched —
 * the last case in this file is the regression guard for the eight shipped
 * consumers (Clients, Books, Catalog, Inventory, Settings, Expenses).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RegisterTable, type RegisterTableColumn } from "../register-table";

interface Row {
  id: string;
  name: string;
  age: number;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", age: 3 },
  { id: "b", name: "Bravo", age: 1 },
];

const COLUMNS: RegisterTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
  { id: "age", header: "Age", cell: (row) => row.age, align: "right", sortable: true },
];

function renderTable(props: Partial<React.ComponentProps<typeof RegisterTable<Row>>> = {}) {
  return render(
    <RegisterTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(row) => row.id}
      ariaLabel="Register"
      {...props}
    />,
  );
}

describe("<RegisterTable> sortable headers", () => {
  it("reports aria-sort=none on a sortable-but-unsorted column and omits it entirely on a non-sortable one", () => {
    renderTable();

    const [name, age] = screen.getAllByRole("columnheader");
    expect(name).not.toHaveAttribute("aria-sort");
    expect(age).toHaveAttribute("aria-sort", "none");
  });

  it("reports the active direction on the sorted column", () => {
    const { rerender } = renderTable({ sort: { columnId: "age", direction: "asc" } });
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "ascending");

    rerender(
      <RegisterTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        ariaLabel="Register"
        sort={{ columnId: "age", direction: "desc" }}
      />,
    );
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "descending");
  });

  it("puts the sortable label in a button and fires onSortChange with the column id", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ onSortChange });

    await user.click(screen.getByRole("button", { name: "Age" }));
    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(onSortChange).toHaveBeenCalledWith("age");
  });

  it("does not make a non-sortable header activatable", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ onSortChange });

    expect(screen.queryByRole("button", { name: "Name" })).toBeNull();
    await user.click(screen.getAllByRole("columnheader")[0]);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("leaves a table with no sortable columns free of sort chrome", () => {
    render(
      <RegisterTable<Row>
        columns={[COLUMNS[0], { ...COLUMNS[1], sortable: undefined }]}
        rows={ROWS}
        getRowId={(row) => row.id}
        ariaLabel="Register"
      />,
    );

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).not.toHaveAttribute("aria-sort");
    }
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

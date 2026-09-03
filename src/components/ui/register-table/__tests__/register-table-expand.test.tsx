/**
 * RegisterTable — expandable detail rows.
 *
 * An expanded row is a second `<tr>` carrying one full-width `<td>`: inert
 * chrome that hosts the caller's detail node. Expansion state is owned by the
 * caller. A table that passes neither `renderExpanded` nor `expandedRowIds`
 * emits exactly the rows it always did — the last case guards the eight shipped
 * consumers (Clients, Books, Catalog, Inventory, Settings, Expenses).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  { id: "age", header: "Age", cell: (row) => row.age, align: "right" },
];

const renderDetail = (row: Row) => <div data-testid={`detail-${row.id}`}>Detail for {row.name}</div>;

function bodyRows() {
  const body = screen.getByRole("table").querySelector("tbody");
  return Array.from(body?.querySelectorAll(":scope > tr") ?? []);
}

describe("<RegisterTable> expandable rows", () => {
  it("follows an expanded row with a full-width detail row and leaves collapsed rows alone", () => {
    render(
      <RegisterTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        ariaLabel="Register"
        renderExpanded={renderDetail}
        expandedRowIds={new Set(["a"])}
      />,
    );

    const rows = bodyRows();
    expect(rows).toHaveLength(3);

    const detailRow = rows[1];
    const cells = detailRow.querySelectorAll("td");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("colspan", String(COLUMNS.length));
    expect(within(detailRow as HTMLElement).getByTestId("detail-a")).toBeInTheDocument();

    expect(screen.queryByTestId("detail-b")).toBeNull();
  });

  it("marks the data row's expansion state and keeps the detail row inert", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <RegisterTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        ariaLabel="Register"
        onRowClick={onRowClick}
        renderExpanded={renderDetail}
        expandedRowIds={new Set(["a"])}
      />,
    );

    const [dataRow, detailRow, collapsedRow] = bodyRows();
    expect(dataRow).toHaveAttribute("aria-expanded", "true");
    expect(collapsedRow).toHaveAttribute("aria-expanded", "false");
    expect(detailRow).not.toHaveAttribute("aria-expanded");
    expect(detailRow).not.toHaveAttribute("tabindex");
    expect(detailRow.className).not.toContain("cursor-pointer");
    expect(detailRow.className).not.toContain("hover:");

    await user.click(detailRow);
    expect(onRowClick).not.toHaveBeenCalled();

    await user.click(dataRow);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("emits one row per record and no aria-expanded when expansion is not configured", () => {
    const onRowClick = vi.fn();
    render(
      <RegisterTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        ariaLabel="Register"
        onRowClick={onRowClick}
      />,
    );

    const rows = bodyRows();
    expect(rows).toHaveLength(ROWS.length);
    for (const row of rows) {
      expect(row).not.toHaveAttribute("aria-expanded");
      expect(row.querySelectorAll("td")).toHaveLength(COLUMNS.length);
    }
  });
});

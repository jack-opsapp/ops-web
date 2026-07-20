import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PipelineTableHeader } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table-header";
import type {
  PipelineTableColumnLayout,
  PipelineTableMetrics,
} from "@/app/(dashboard)/pipeline/_components/table/pipeline-table";
import {
  PIPELINE_TABLE_COLUMNS,
  type PipelineTableSort,
} from "@/lib/types/pipeline-table";

// The header labels come from the dictionary; the identity `t` keeps the test
// assertions about ROLES, not copy.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));

const metrics: PipelineTableMetrics = {
  zoom: 1,
  density: "comfortable",
  rowHeight: 44,
  headerHeight: 36,
  fontSize: 13,
  microFontSize: 11,
  avatarSize: 24,
  columnScale: 1,
};

const columns: PipelineTableColumnLayout[] = PIPELINE_TABLE_COLUMNS.map(
  (column, index) => ({
    column,
    width: column.width,
    stickyLeft: column.frozen ? index * 40 : null,
  })
);

const DATA_COLUMNS = PIPELINE_TABLE_COLUMNS.filter((c) => c.id !== "select");

function renderHeader(sorting: PipelineTableSort[] = []) {
  return render(
    <PipelineTableHeader
      columns={columns}
      metrics={metrics}
      sorting={sorting}
      canManage
      onSortChange={vi.fn()}
      allVisibleSelected={false}
      onToggleSelectAllVisible={vi.fn()}
    />
  );
}

describe("PipelineTableHeader — grid semantics", () => {
  it("exposes every data column as a columnheader (the select rail is chrome)", () => {
    renderHeader();
    // One columnheader per data column; the select rail carries no role, in
    // lockstep with the data rows' roleless select cell.
    expect(screen.getAllByRole("columnheader")).toHaveLength(
      DATA_COLUMNS.length
    );
  });

  it("sits inside a header row so the columnheaders are grid-valid", () => {
    renderHeader();
    const row = screen.getByRole("row");
    expect(row).toContainElement(screen.getAllByRole("columnheader")[0]);
  });

  it("advertises aria-sort none on every sortable column until one is sorted", () => {
    renderHeader();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("aria-sort", "none");
    }
  });

  it("reports the active direction on exactly the sorted column", () => {
    renderHeader([{ field: "value", direction: "desc" }]);
    const descending = screen
      .getAllByRole("columnheader")
      .filter((h) => h.getAttribute("aria-sort") === "descending");
    expect(descending).toHaveLength(1);
    // Every other sortable column stays "none".
    const none = screen
      .getAllByRole("columnheader")
      .filter((h) => h.getAttribute("aria-sort") === "none");
    expect(none).toHaveLength(DATA_COLUMNS.length - 1);
  });
});

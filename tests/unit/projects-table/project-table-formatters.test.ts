import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@/lib/types/models";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  mapProjectView,
  mapProjectTableRow,
  parseProjectTableStatus,
} from "@/lib/utils/project-table-formatters";

describe("project-table-formatters", () => {
  it("maps lowercase DB statuses to the TS enum boundary", () => {
    expect(parseProjectTableStatus("in_progress")).toBe(ProjectStatus.InProgress);
    expect(parseProjectTableStatus("completed")).toBe(ProjectStatus.Completed);
    expect(parseProjectTableStatus(null)).toBe(ProjectStatus.RFQ);
  });

  it("formats nulls as an operator dash", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatNumber(null)).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("formats ratio values as percentages", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.375)).toBe("38%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("formats date-only values as local calendar days", () => {
    expect(formatDate("2026-05-20")).toBe("May 20");
  });

  it("drops malformed rows without an id or company", () => {
    expect(mapProjectTableRow({ id: null, company_id: "co-1" } as never)).toBeNull();
    expect(mapProjectTableRow({ id: "p-1", company_id: null } as never)).toBeNull();
  });

  it("maps a project_table_rows record into a render row", () => {
    const row = mapProjectTableRow({
      id: "p-1",
      company_id: "co-1",
      title: "Deck rebuild",
      status: "accepted",
      team_member_ids: ["u-1"],
      task_count: 3,
      task_completed_count: 1,
      photo_count: 2,
    } as never);

    expect(row).toMatchObject({
      id: "p-1",
      title: "Deck rebuild",
      status: ProjectStatus.Accepted,
      rawStatus: "accepted",
      teamMemberIds: ["u-1"],
      taskCount: 3,
      taskCompletedCount: 1,
      photoCount: 2,
    });
  });

  it("drops unknown saved-view column ids", () => {
    const view = mapProjectView({
      id: "view-1",
      name: "My Active Work",
      icon: "table",
      permission_key: null,
      columns: [{ id: "name" }, { id: "not_a_column" }, "status"],
      filters: {},
      sort: [],
      density: "comfortable",
      zoom_level: 1,
      is_default: true,
      sort_position: 0,
      updated_at: "2026-05-12T00:00:00Z",
    } as never);

    expect(view.columns).toEqual(["name", "status"]);
  });
});

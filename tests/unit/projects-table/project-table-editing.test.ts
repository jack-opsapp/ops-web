import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@/lib/types/models";
import {
  PROJECT_TABLE_EDITABLE_COLUMN_IDS,
  getProjectTableEditValue,
  isProjectTableEditableColumn,
  type ProjectTableRow,
} from "@/lib/types/project-table";
import { serializeProjectTableStatus } from "@/lib/utils/project-table-formatters";

const baseRow: ProjectTableRow = {
  id: "p-1",
  companyId: "co-1",
  title: "Deck rebuild",
  status: ProjectStatus.Accepted,
  rawStatus: "accepted",
  clientId: "client-1",
  clientName: "Riley Home",
  clientEmail: null,
  clientPhone: null,
  address: "12 Site Rd",
  teamMemberIds: [],
  startDate: "2026-05-20",
  endDate: null,
  duration: null,
  progress: null,
  nextTask: null,
  taskCount: 0,
  taskCompletedCount: 0,
  daysInStatus: null,
  estimateTotal: null,
  invoiceTotal: null,
  paidTotal: null,
  value: null,
  projectCost: null,
  margin: null,
  photoCount: 0,
  updatedAt: "2026-05-13T00:00:00Z",
};

describe("project table editing contracts", () => {
  it("keeps Phase 3 editable columns tightly scoped", () => {
    expect(PROJECT_TABLE_EDITABLE_COLUMN_IDS).toEqual([
      "name",
      "status",
      "client",
      "address",
      "start_date",
      "end_date",
    ]);
    expect(isProjectTableEditableColumn("team")).toBe(false);
    expect(isProjectTableEditableColumn("invoice_total")).toBe(false);
    expect(isProjectTableEditableColumn("name")).toBe(true);
  });

  it("reads edit values from render rows", () => {
    expect(getProjectTableEditValue(baseRow, "name")).toBe("Deck rebuild");
    expect(getProjectTableEditValue(baseRow, "address")).toBe("12 Site Rd");
    expect(getProjectTableEditValue(baseRow, "start_date")).toBe("2026-05-20");
    expect(getProjectTableEditValue(baseRow, "end_date")).toBe(null);
    expect(getProjectTableEditValue(baseRow, "status")).toBe(ProjectStatus.Accepted);
    expect(getProjectTableEditValue(baseRow, "client")).toEqual({
      clientId: "client-1",
      clientName: "Riley Home",
    });
  });

  it("serializes TS project statuses to lowercase DB values", () => {
    expect(serializeProjectTableStatus(ProjectStatus.InProgress)).toBe("in_progress");
    expect(serializeProjectTableStatus(ProjectStatus.Completed)).toBe("completed");
  });
});

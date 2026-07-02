import { describe, expect, it } from "vitest";
import {
  buildProjectTableFilterInstructions,
  PROJECT_TABLE_SEARCH_FIELDS,
} from "@/lib/utils/project-filter-to-sql";

describe("project-filter-to-sql", () => {
  it("converts the My Active Work dynamic filter", () => {
    const instructions = buildProjectTableFilterInstructions(
      {
        type: "dynamic",
        key: "current_user_assigned",
        and: [{ field: "status", op: "not_in", value: ["closed", "archived"] }],
      },
      "user-1",
      "",
    );

    expect(instructions).toEqual([
      { type: "contains", field: "team_member_ids", values: ["user-1"] },
      { type: "not_in", field: "status", values: ["closed", "archived"] },
    ]);
  });

  it("converts financial overview status inclusion", () => {
    expect(
      buildProjectTableFilterInstructions(
        { field: "status", op: "in", value: ["accepted", "in_progress", "completed"] },
        "user-1",
        "",
      ),
    ).toEqual([
      { type: "in", field: "status", values: ["accepted", "in_progress", "completed"] },
    ]);
  });

  it("adds search as one all-search-fields instruction per token", () => {
    expect(buildProjectTableFilterInstructions({}, "user-1", " deck ")).toEqual([
      { type: "ilike_any", fields: PROJECT_TABLE_SEARCH_FIELDS, value: "deck" },
    ]);
  });

  it("splits multi-word search into ANDed per-token instructions", () => {
    expect(buildProjectTableFilterInstructions({}, "user-1", "miramar  housing")).toEqual([
      { type: "ilike_any", fields: PROJECT_TABLE_SEARCH_FIELDS, value: "miramar" },
      { type: "ilike_any", fields: PROJECT_TABLE_SEARCH_FIELDS, value: "housing" },
    ]);
  });

  it("spans the operator-pasteable fields", () => {
    expect(PROJECT_TABLE_SEARCH_FIELDS).toEqual([
      "title",
      "client_name",
      "client_email",
      "client_phone",
      "address",
      "trade",
      "notes",
      "next_task",
    ]);
  });

  it("drops invalid filter values from saved-view JSON", () => {
    expect(
      buildProjectTableFilterInstructions(
        { field: "status", op: "not_in", value: ["closed", "closed),id.not.is.null"] },
        "user-1",
        "",
      ),
    ).toEqual([{ type: "not_in", field: "status", values: ["closed"] }]);

    expect(
      buildProjectTableFilterInstructions(
        { field: "client_id", op: "in", value: ["not-a-uuid"] },
        "user-1",
        "",
      ),
    ).toEqual([]);
  });
});

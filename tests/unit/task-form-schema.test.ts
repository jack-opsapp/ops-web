import { describe, it, expect } from "vitest";
import { taskFormSchema } from "@/components/ops/task-form";
import { TaskStatus } from "@/lib/types/models";

// Untouched-form shape: the defaults TaskForm seeds before any interaction.
// `dependencyOverrides` is intentionally absent — the form never registers a
// DOM input for it, so an untouched submit carries `undefined`, not "".
function untouchedDefaults() {
  return {
    status: TaskStatus.Booked,
    taskTypeId: "tt-1",
    taskColor: "#59779F",
    teamMemberIds: [],
    startDate: "",
    endDate: "",
  };
}

// Audit pin (2026-07-14): TaskForm has no registered type=number input, so the
// untouched-number-input silent-validation trap (create-lead f4e85e75) cannot
// occur here. `overlap_percentage` is the schema's only z.number() and is fed
// exclusively from controlled state via Number(e.target.value) — a number
// input's DOM value is always "" or a valid float string, so the write is
// always a finite number (Number("") === 0), never "" or NaN. These tests keep
// that contract honest if the field is ever re-wired through register().
describe("taskFormSchema — untouched submit", () => {
  it("parses the untouched defaults (dependencyOverrides absent)", () => {
    const parsed = taskFormSchema.safeParse(untouchedDefaults());
    expect(parsed.success).toBe(true);
  });

  it("accepts null and [] for dependencyOverrides", () => {
    expect(
      taskFormSchema.safeParse({
        ...untouchedDefaults(),
        dependencyOverrides: null,
      }).success,
    ).toBe(true);
    expect(
      taskFormSchema.safeParse({
        ...untouchedDefaults(),
        dependencyOverrides: [],
      }).success,
    ).toBe(true);
  });
});

describe("taskFormSchema — overlap_percentage bounds", () => {
  function withOverlap(overlap: number) {
    return {
      ...untouchedDefaults(),
      dependencyOverrides: [
        { depends_on_task_type_id: "tt-0", overlap_percentage: overlap },
      ],
    };
  }

  it("accepts the 0 and 100 boundaries", () => {
    expect(taskFormSchema.safeParse(withOverlap(0)).success).toBe(true);
    expect(taskFormSchema.safeParse(withOverlap(100)).success).toBe(true);
  });

  it("rejects out-of-range values and NaN", () => {
    expect(taskFormSchema.safeParse(withOverlap(-1)).success).toBe(false);
    expect(taskFormSchema.safeParse(withOverlap(101)).success).toBe(false);
    expect(taskFormSchema.safeParse(withOverlap(Number.NaN)).success).toBe(false);
  });
});

describe("taskFormSchema — taskTypeId", () => {
  it("rejects \"\" (the only failable untouched field, and its error renders)", () => {
    // TaskTypeDropdown receives an `error` prop, so this failure is visible —
    // the form has no silent dead-end.
    const parsed = taskFormSchema.safeParse({
      ...untouchedDefaults(),
      taskTypeId: "",
    });
    expect(parsed.success).toBe(false);
  });
});

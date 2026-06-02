import { describe, it, expect } from "vitest";

import { OpportunityStage } from "@/lib/types/pipeline";
import { migratePipelineModeState } from "../pipeline-mode-store";
import type { SortOption } from "../pipeline-mode-types";

describe("migratePipelineModeState", () => {
  it('coerces the retired "spatial" mode to "focused"', () => {
    const result = migratePipelineModeState(
      { mode: "spatial", focusedStage: OpportunityStage.NewLead },
      3
    );
    expect(result.mode).toBe("focused");
  });

  it('leaves a "table" mode untouched', () => {
    const result = migratePipelineModeState({ mode: "table" }, 4);
    expect(result.mode).toBe("table");
  });

  it('leaves a "focused" mode untouched', () => {
    const result = migratePipelineModeState({ mode: "focused" }, 3);
    expect(result.mode).toBe("focused");
  });

  it("preserves the other persisted fields when coercing spatial", () => {
    // Mirrors what the storage reviver hands `migrate`: a real Map for
    // `stageSortOverrides`, plus the other partialized fields.
    const overrides = new Map<OpportunityStage, SortOption>([
      [OpportunityStage.NewLead, "name"],
    ]);
    const result = migratePipelineModeState(
      {
        mode: "spatial",
        focusedStage: OpportunityStage.Qualifying,
        sortBy: "date",
        stageSortOverrides: overrides,
      },
      3
    );
    expect(result.mode).toBe("focused");
    expect(result.focusedStage).toBe(OpportunityStage.Qualifying);
    expect(result.sortBy).toBe("date");
    // The Map produced by the storage reviver must pass through untouched —
    // same reference, not re-serialized.
    expect(result.stageSortOverrides).toBe(overrides);
    expect(result.stageSortOverrides?.get(OpportunityStage.NewLead)).toBe(
      "name"
    );
  });

  it("returns a safe default object for undefined input", () => {
    const result = migratePipelineModeState(undefined, 3);
    expect(result.mode).toBe("focused");
  });

  it("returns a safe default object for a non-object (string) input", () => {
    const result = migratePipelineModeState("not-an-object", 3);
    expect(result.mode).toBe("focused");
  });

  it("returns a safe default object for a null input", () => {
    const result = migratePipelineModeState(null, 3);
    expect(result.mode).toBe("focused");
  });

  it("does not throw on a malformed (number) input", () => {
    expect(() => migratePipelineModeState(42, 0)).not.toThrow();
  });
});

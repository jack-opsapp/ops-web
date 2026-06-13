import { describe, it, expect } from "vitest";
import {
  buildStepPlan,
  nextStep,
  prevStep,
  type StepContext,
} from "./step-machine";

const full: StepContext = {
  inventoryTracked: true,
  canSell: true,
  canStock: true,
  canTypes: true,
};

describe("step machine", () => {
  it("full plan is sell → stock → types → review", () => {
    expect(buildStepPlan(full)).toEqual(["sell", "stock", "types", "review"]);
  });

  it("omits stock when inventory not tracked", () => {
    expect(buildStepPlan({ ...full, inventoryTracked: false })).toEqual([
      "sell",
      "types",
      "review",
    ]);
  });

  it("omits stock when the operator lacks inventory permission, even if tracked", () => {
    expect(buildStepPlan({ ...full, canStock: false })).toEqual([
      "sell",
      "types",
      "review",
    ]);
  });

  it("omits sell and types when those permissions are absent", () => {
    expect(
      buildStepPlan({
        inventoryTracked: true,
        canSell: false,
        canStock: true,
        canTypes: false,
      }),
    ).toEqual(["stock", "review"]);
  });

  it("review is always present and last", () => {
    const plan = buildStepPlan({
      inventoryTracked: false,
      canSell: false,
      canStock: false,
      canTypes: false,
    });
    expect(plan[plan.length - 1]).toBe("review");
    expect(plan).toEqual(["review"]);
  });

  it("nextStep advances along the plan and clamps at review", () => {
    expect(nextStep("sell", full)).toBe("stock");
    expect(nextStep("review", full)).toBe("review");
  });

  it("prevStep retreats and clamps at the first step", () => {
    expect(prevStep("types", full)).toBe("stock");
    expect(prevStep("sell", full)).toBe("sell");
  });

  it("nextStep skips the omitted stock step", () => {
    const ctx = { ...full, inventoryTracked: false };
    expect(nextStep("sell", ctx)).toBe("types");
  });

  it("prevStep skips the omitted stock step in reverse", () => {
    const ctx = { ...full, inventoryTracked: false };
    expect(prevStep("types", ctx)).toBe("sell");
  });

  it("nextStep on a step not in the plan returns the first step", () => {
    const ctx = { ...full, inventoryTracked: false };
    expect(nextStep("stock", ctx)).toBe("sell");
  });
});

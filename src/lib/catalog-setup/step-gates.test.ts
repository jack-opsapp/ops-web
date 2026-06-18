import { describe, it, expect } from "vitest";
import {
  STEP_REQUIRED_PERMISSIONS,
  isStepAccessible,
  visibleModulePlan,
  entryAllowed,
  type WizardModule,
} from "./step-gates";

const fullCan = () => true;
const noInventory = (p: string) => p !== "inventory.manage" && p !== "inventory.import";
const viewerOnly = (p: string) => p.endsWith(".view");

describe("STEP_REQUIRED_PERMISSIONS", () => {
  it("requires catalog.run_setup + products.manage for SELL", () => {
    expect(STEP_REQUIRED_PERMISSIONS.SELL).toEqual(
      expect.arrayContaining(["catalog.run_setup", "products.manage"]),
    );
  });
  it("requires inventory.manage for STOCK", () => {
    expect(STEP_REQUIRED_PERMISSIONS.STOCK).toContain("inventory.manage");
  });
});

describe("isStepAccessible", () => {
  it("grants SELL to a products manager", () => {
    expect(isStepAccessible("SELL", fullCan)).toBe(true);
  });
  it("hides STOCK from someone without inventory.manage (no dead end)", () => {
    expect(isStepAccessible("STOCK", noInventory)).toBe(false);
  });
  it("hides everything from a view-only user", () => {
    expect(isStepAccessible("SELL", viewerOnly)).toBe(false);
  });
});

describe("visibleModulePlan", () => {
  const plan: WizardModule[] = ["SELL", "STOCK", "TYPES", "REVIEW"];
  it("drops STOCK for a no-inventory manager", () => {
    expect(visibleModulePlan(plan, noInventory)).toEqual(["SELL", "TYPES", "REVIEW"]);
  });
  it("keeps the full plan for a full manager", () => {
    expect(visibleModulePlan(plan, fullCan)).toEqual(plan);
  });
  it("drops a lone REVIEW when nothing is buildable", () => {
    expect(visibleModulePlan(["REVIEW"], fullCan)).toEqual([]);
  });
});

describe("entryAllowed", () => {
  it("is true with catalog.run_setup", () => {
    expect(entryAllowed(fullCan)).toBe(true);
  });
  it("is false without it (operator / crew never sees the takeover)", () => {
    expect(entryAllowed((p) => p !== "catalog.run_setup")).toBe(false);
  });
});

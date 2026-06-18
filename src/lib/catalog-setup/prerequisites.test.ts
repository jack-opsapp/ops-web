import { describe, it, expect } from "vitest";
import {
  deriveBlockingPrerequisite,
  baselineSeeded,
  type PrereqInput,
} from "./prerequisites";

const ok: PrereqInput = {
  companyExists: true,
  baselineSeeded: true,
  catalogSurfaceDeployed: true,
  subscriptionLocked: false,
};

describe("deriveBlockingPrerequisite", () => {
  it("returns null when all prerequisites pass", () => {
    expect(deriveBlockingPrerequisite(ok)).toBeNull();
  });
  it("flags a missing company first (highest priority)", () => {
    expect(deriveBlockingPrerequisite({ ...ok, companyExists: false })).toBe("no_company");
  });
  it("flags an unseeded baseline", () => {
    expect(deriveBlockingPrerequisite({ ...ok, baselineSeeded: false })).toBe(
      "baseline_not_seeded",
    );
  });
  it("flags a missing catalog surface", () => {
    expect(deriveBlockingPrerequisite({ ...ok, catalogSurfaceDeployed: false })).toBe(
      "catalog_surface_absent",
    );
  });
  it("flags subscription lockout", () => {
    expect(deriveBlockingPrerequisite({ ...ok, subscriptionLocked: true })).toBe(
      "subscription_locked",
    );
  });
  it("returns the highest-priority blocker when several fail", () => {
    expect(
      deriveBlockingPrerequisite({
        companyExists: false,
        baselineSeeded: false,
        catalogSurfaceDeployed: false,
        subscriptionLocked: true,
      }),
    ).toBe("no_company");
  });
  it("ranks subscription lockout above data-shape gates", () => {
    expect(
      deriveBlockingPrerequisite({
        ...ok,
        subscriptionLocked: true,
        catalogSurfaceDeployed: false,
        baselineSeeded: false,
      }),
    ).toBe("subscription_locked");
  });
});

describe("baselineSeeded", () => {
  it("is false on a fresh company (0/0)", () => {
    expect(baselineSeeded(0, 0)).toBe(false);
  });
  it("is true once task types AND units exist", () => {
    expect(baselineSeeded(196, 12)).toBe(true);
  });
  it("is false when only one primitive is present", () => {
    expect(baselineSeeded(196, 0)).toBe(false);
  });
});

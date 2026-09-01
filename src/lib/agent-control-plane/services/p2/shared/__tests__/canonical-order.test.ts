import { describe, expect, it } from "vitest";

import {
  canonicalizeAgentMachineStringSet,
  compareAgentMachineStrings,
} from "@/lib/agent-control-plane/canonical-order";

describe("P2 machine-string canonical order", () => {
  it("uses locale-independent bytewise ordering for OAuth scopes", () => {
    const consentOrder = [
      "ops.catalog_costs.read",
      "ops.jobs.read",
      "ops.catalog.read",
      "ops.catalog_costs.read",
    ];

    expect(canonicalizeAgentMachineStringSet(consentOrder)).toEqual([
      "ops.catalog.read",
      "ops.catalog_costs.read",
      "ops.jobs.read",
    ]);
    expect(
      compareAgentMachineStrings("ops.catalog.read", "ops.catalog_costs.read")
    ).toBeLessThan(0);
  });

  it("returns a frozen set snapshot without mutating its input", () => {
    const input = ["ops.jobs.read", "ops.company.read"];
    const canonical = canonicalizeAgentMachineStringSet(input);

    expect(input).toEqual(["ops.jobs.read", "ops.company.read"]);
    expect(canonical).toEqual(["ops.company.read", "ops.jobs.read"]);
    expect(Object.isFrozen(canonical)).toBe(true);
  });
});

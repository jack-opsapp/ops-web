import { describe, expect, it } from "vitest";
import { SPEC_CAPACITY_RECORD_IDS } from "../spec-constants";
import { SPEC_TIERS } from "../spec-tiers";

describe("SPEC_CAPACITY_RECORD_IDS — audit_log anchors", () => {
  it("keeps the legacy v1 anchors byte-for-byte (old audit rows reference them)", () => {
    expect(SPEC_CAPACITY_RECORD_IDS.setup).toBe("00000000-0000-0000-cafe-000000000001");
    expect(SPEC_CAPACITY_RECORD_IDS.build).toBe("00000000-0000-0000-cafe-000000000002");
    expect(SPEC_CAPACITY_RECORD_IDS.enterprise).toBe("00000000-0000-0000-cafe-000000000003");
  });

  it("issues a fresh, distinct anchor for every v2 tier", () => {
    const all = Object.values(SPEC_CAPACITY_RECORD_IDS);
    expect(new Set(all).size).toBe(all.length);
    for (const tier of SPEC_TIERS) {
      expect(SPEC_CAPACITY_RECORD_IDS[tier]).toMatch(
        /^00000000-0000-0000-cafe-00000000000[0-9a-f]$/,
      );
    }
  });
});

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { realmIdLookup } from "@/lib/api/services/token-cipher";

describe("realmIdLookup", () => {
  it("returns the lowercase hex SHA-256 of the realm id", () => {
    const realmId = "4620816365088321";
    const expected = createHash("sha256").update(realmId, "utf8").digest("hex");
    expect(realmIdLookup(realmId)).toBe(expected);
  });

  it("is deterministic — same input always yields the same hash", () => {
    expect(realmIdLookup("123")).toBe(realmIdLookup("123"));
  });

  it("differs for different realm ids", () => {
    expect(realmIdLookup("123")).not.toBe(realmIdLookup("124"));
  });

  it("emits lowercase hex of 64 chars (256-bit digest)", () => {
    const hash = realmIdLookup("9341452742069765");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

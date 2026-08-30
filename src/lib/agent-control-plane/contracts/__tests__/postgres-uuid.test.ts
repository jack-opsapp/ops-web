import { describe, expect, it } from "vitest";
import { z } from "zod-v4";

import { isCanonicalPostgresUuid, PostgresUuidSchema } from "../postgres-uuid";

const POSTGRES_UUIDS = [
  "d0000000-0000-4000-d000-00000000000b",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
] as const;

describe("canonical PostgreSQL UUID text", () => {
  it("emits the exact lowercase hyphenated constraint into JSON Schema", () => {
    expect(z.toJSONSchema(PostgresUuidSchema)).toMatchObject({
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    });
  });

  it.each(POSTGRES_UUIDS)("accepts the stored lowercase identity %s", (id) => {
    expect(isCanonicalPostgresUuid(id)).toBe(true);
    expect(PostgresUuidSchema.parse(id)).toBe(id);
  });

  it.each([
    "D0000000-0000-4000-D000-00000000000B",
    "d0000000-0000-4000-d000-00000000000z",
    "d000000000004000d00000000000000b",
    " d0000000-0000-4000-d000-00000000000b",
    "d0000000-0000-4000-d000-00000000000b ",
    7,
    null,
  ])("rejects noncanonical identity text %#", (id) => {
    expect(isCanonicalPostgresUuid(id)).toBe(false);
    expect(PostgresUuidSchema.safeParse(id).success).toBe(false);
  });

  it("remains fail-closed after RegExp.prototype.test is replaced", () => {
    const originalTest = RegExp.prototype.test;
    RegExp.prototype.test = () => true;
    try {
      expect(isCanonicalPostgresUuid("attacker-selected-id")).toBe(false);
      expect(
        isCanonicalPostgresUuid("d0000000-0000-4000-d000-00000000000b")
      ).toBe(true);
    } finally {
      RegExp.prototype.test = originalTest;
    }
  });
});

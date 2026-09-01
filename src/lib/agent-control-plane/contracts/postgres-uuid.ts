import { z } from "zod-v4";

const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicReflectApply = Reflect.apply;

/**
 * PostgreSQL accepts every 128-bit UUID value. Its canonical text output is
 * lowercase and hyphenated, but it does not require RFC version/variant bits.
 */
export function isCanonicalPostgresUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    intrinsicReflectApply(intrinsicRegExpTest, POSTGRES_UUID_PATTERN, [value])
  );
}

export const PostgresUuidSchema = z
  .string()
  .regex(POSTGRES_UUID_PATTERN, "UUID must use canonical PostgreSQL text");

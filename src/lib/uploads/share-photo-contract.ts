const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_RE = /\p{Cc}/u;
const MAX_RECOVERY_IDENTIFIER_BYTES = 128;

export function canonicalUuid(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function boundedRecoveryIdentifier(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  if (
    trimmed.length === 0 ||
    Buffer.byteLength(trimmed, "utf8") > MAX_RECOVERY_IDENTIFIER_BYTES ||
    CONTROL_CHARACTER_RE.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

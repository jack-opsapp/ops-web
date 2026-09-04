const UUID_BYTES = 16;
const UUID_TOKEN_LENGTH = 22;

export function encodeOpaqueUuid(
  prefix: "src" | "frm" | "upl" | "sub" | "lead",
  uuid: string
): string {
  const compact = uuid.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("invalid_opaque_uuid");
  }
  return `${prefix}_${Buffer.from(compact, "hex").toString("base64url")}`;
}

export function decodeOpaqueUuid(
  value: string,
  expectedPrefix: "src" | "frm" | "upl" | "sub" | "lead"
): string {
  const expectedStart = `${expectedPrefix}_`;
  if (!value.startsWith(expectedStart)) {
    throw new Error("invalid_opaque_uuid");
  }
  const token = value.slice(expectedStart.length);
  if (token.length !== UUID_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("invalid_opaque_uuid");
  }
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== UUID_BYTES || bytes.toString("base64url") !== token) {
    throw new Error("invalid_opaque_uuid");
  }
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

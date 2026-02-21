/**
 * Normalize a private key from env var into proper PEM format.
 * Handles: raw base64 (no headers), literal \n, quoted strings.
 */
export function parsePrivateKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // Strip surrounding quotes if present
  let key = raw.replace(/^["']|["']$/g, "");

  // Replace literal \n with real newlines
  key = key.replace(/\\n/g, "\n");

  // If PEM headers are already present, we're done
  if (key.includes("-----BEGIN")) return key;

  // Raw base64 body only — strip any whitespace/newlines and wrap in PEM
  const base64 = key.replace(/\s/g, "");
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

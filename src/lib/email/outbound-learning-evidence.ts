const READABLE_PREFIX_LENGTH = 72;

function normalizeEvidencePart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Builds a compact, collision-resistant key safe for a Postgres btree index.
 * The readable prefix helps operators inspect receipts; the SHA-256 digest is
 * authoritative and keeps distinct long model outputs from collapsing.
 */
export async function outboundLearningEvidenceKey(
  kind: "fact" | "edge" | "draft-correction",
  parts: string[]
): Promise<string> {
  const normalized = parts.map(normalizeEvidencePart).join("\u001f");
  const digestBytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized)
  );
  const digest = Array.from(new Uint8Array(digestBytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const readable = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, READABLE_PREFIX_LENGTH);
  return `${kind}:${readable || "evidence"}:${digest}`;
}

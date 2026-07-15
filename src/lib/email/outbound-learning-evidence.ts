import { createHash } from "node:crypto";

const READABLE_PREFIX_LENGTH = 72;

function normalizeEvidencePart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Builds a compact, collision-resistant key safe for a Postgres btree index.
 * The readable prefix helps operators inspect receipts; the SHA-256 digest is
 * authoritative and keeps distinct long model outputs from collapsing.
 */
export function outboundLearningEvidenceKey(
  kind: "fact" | "edge" | "draft-correction",
  parts: string[]
): string {
  const normalized = parts.map(normalizeEvidencePart).join("\u001f");
  const digest = createHash("sha256").update(normalized).digest("hex");
  const readable = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, READABLE_PREFIX_LENGTH);
  return `${kind}:${readable || "evidence"}:${digest}`;
}

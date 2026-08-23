import "server-only";

import {
  P2DomainRevisionSchema,
  P2DomainRevisionVectorSchema,
  SourceVersionSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";

export const P2_READ_DOMAINS = Object.freeze([
  "artifacts",
  "availability",
  "catalog",
  "company",
  "customer",
  "deck_designs",
  "expenses",
  "integrations",
  "payments",
  "purchasing",
  "sales_documents",
  "site_visits",
  "tasks",
  "team",
  "work_queue",
] as const);

export type P2ReadDomain = (typeof P2_READ_DOMAINS)[number];
export type P2DomainRevisionInput =
  | P2DomainRevision
  | Readonly<{
      source_domain: string;
      source_type: string;
      source_id: string;
      version: string;
    }>;

const P2_READ_DOMAIN_SET = new Set<string>(P2_READ_DOMAINS);
const REVISION_PATTERN = /^revision:(0|[1-9][0-9]*)$/;
const CONTACTABILITY_ID_PATTERN = /^sha256:([0-9a-f]{64})$/;

export class P2DomainRevisionError extends Error {
  constructor(
    readonly code: "P2_DOMAIN_REVISION_INVALID" | "P2_DOMAIN_REVISION_CONFLICT"
  ) {
    super(code);
    this.name = "P2DomainRevisionError";
  }
}

function revisionNumber(version: string): number {
  if (!REVISION_PATTERN.test(version)) {
    throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
  }
  const revision = Number(version.slice("revision:".length));
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
  }
  return revision;
}

function legacyRevision(input: unknown): P2DomainRevision {
  const parsed = SourceVersionSchema.safeParse(input);
  if (!parsed.success || parsed.data.source_domain !== "operations") {
    throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
  }

  const revision = revisionNumber(parsed.data.version);
  if (
    parsed.data.source_type === "operational_read_revision" &&
    parsed.data.source_id === "private.agent_operational_read_revisions"
  ) {
    return Object.freeze({
      domain: "legacy_operational",
      source_revision: revision,
    });
  }
  if (
    parsed.data.source_type === "job_history_read_revision" &&
    parsed.data.source_id === "private.agent_job_history_revisions"
  ) {
    return Object.freeze({
      domain: "legacy_job_history",
      source_revision: revision,
    });
  }
  if (parsed.data.source_type === "contactability_revision") {
    const digest = CONTACTABILITY_ID_PATTERN.exec(parsed.data.source_id)?.[1];
    if (digest) {
      return Object.freeze({
        // Contract slugs are lowercase and capped at 64 characters. A padded
        // base-36 encoding preserves the complete 256-bit address-set digest
        // without truncation while staying within both constraints.
        domain: `legacy_c:${BigInt(`0x${digest}`).toString(36).padStart(50, "0")}`,
        source_revision: revision,
      });
    }
  }
  throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
}

function normalizeRevision(input: unknown): P2DomainRevision {
  const parsedDomain = P2DomainRevisionSchema.safeParse(input);
  if (parsedDomain.success) {
    if (!P2_READ_DOMAIN_SET.has(parsedDomain.data.domain)) {
      throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
    }
    return Object.freeze({ ...parsedDomain.data });
  }
  return legacyRevision(input);
}

/**
 * Canonicalizes only the closed P2 domain vocabulary and the three frozen
 * legacy source-version families. It deliberately cannot translate arbitrary
 * table names or entity kinds into revision authority.
 */
export function canonicalizeP2DomainRevisions(
  inputs: readonly P2DomainRevisionInput[]
): readonly P2DomainRevision[] {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 64) {
    throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
  }

  const byDomain = new Map<string, P2DomainRevision>();
  for (const input of inputs) {
    const revision = normalizeRevision(input);
    const current = byDomain.get(revision.domain);
    if (current && current.source_revision !== revision.source_revision) {
      throw new P2DomainRevisionError("P2_DOMAIN_REVISION_CONFLICT");
    }
    if (!current) byDomain.set(revision.domain, revision);
  }

  const canonical = [...byDomain.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain)
  );
  const validated = P2DomainRevisionVectorSchema.safeParse(canonical);
  if (!validated.success) {
    throw new P2DomainRevisionError("P2_DOMAIN_REVISION_INVALID");
  }
  return Object.freeze(
    validated.data.map((item) => Object.freeze({ ...item }))
  );
}

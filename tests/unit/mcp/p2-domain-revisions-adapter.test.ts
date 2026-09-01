import { describe, expect, it } from "vitest";

import {
  canonicalizeP2DomainRevisions,
  P2DomainRevisionError,
  P2_READ_DOMAINS,
} from "@/lib/agent-control-plane/services/p2/shared/domain-revisions";

const EXPECTED_DOMAINS = [
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
] as const;

describe("Task 6 P2 domain revision adapter", () => {
  it("accepts and canonically sorts exactly the fifteen SQL revision domains", () => {
    expect(P2_READ_DOMAINS).toEqual(EXPECTED_DOMAINS);

    expect(
      canonicalizeP2DomainRevisions(
        [...EXPECTED_DOMAINS]
          .reverse()
          .map((domain, index) => ({ domain, source_revision: index }))
      )
    ).toEqual(
      EXPECTED_DOMAINS.map((domain) => ({
        domain,
        source_revision: 14 - EXPECTED_DOMAINS.indexOf(domain),
      }))
    );
  });

  it("accepts both safe-integer edges and rejects unsafe or non-integer revisions", () => {
    expect(
      canonicalizeP2DomainRevisions([
        { domain: "customer", source_revision: 0 },
        { domain: "tasks", source_revision: Number.MAX_SAFE_INTEGER },
      ])
    ).toEqual([
      { domain: "customer", source_revision: 0 },
      { domain: "tasks", source_revision: Number.MAX_SAFE_INTEGER },
    ]);

    for (const source_revision of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        canonicalizeP2DomainRevisions([
          { domain: "customer", source_revision } as never,
        ])
      ).toThrow(P2DomainRevisionError);
    }
  });

  it("recognizes only the exact operational, job-history, and address-scoped legacy families", () => {
    const digestA = "a".repeat(64);
    const digestB = "b".repeat(64);
    const canonical = canonicalizeP2DomainRevisions([
      {
        source_domain: "operations",
        source_type: "operational_read_revision",
        source_id: "private.agent_operational_read_revisions",
        version: "revision:1",
      },
      {
        source_domain: "operations",
        source_type: "job_history_read_revision",
        source_id: "private.agent_job_history_revisions",
        version: "revision:2",
      },
      {
        source_domain: "operations",
        source_type: "contactability_revision",
        source_id: `sha256:${digestA}`,
        version: "revision:3",
      },
      {
        source_domain: "operations",
        source_type: "contactability_revision",
        source_id: `sha256:${digestB}`,
        version: "revision:4",
      },
    ]);

    expect(canonical).toEqual([
      {
        domain:
          "legacy_c:494rtk7ddoepe5ru2lx4oc855i6lc23p3apolh04feq8q517sa",
        source_revision: 3,
      },
      {
        domain:
          "legacy_c:4og1sx0wpug6bz5f2vb8qruk2geg9nwv786ngf3qgy79ljxqkb",
        source_revision: 4,
      },
      { domain: "legacy_job_history", source_revision: 2 },
      { domain: "legacy_operational", source_revision: 1 },
    ]);
    expect(canonical[0]?.domain).not.toBe(canonical[1]?.domain);
    expect(canonical[0]?.domain).toHaveLength(59);
    expect(canonical[1]?.domain).toHaveLength(59);
  });

  it.each([
    {
      source_domain: "other",
      source_type: "operational_read_revision",
      source_id: "private.agent_operational_read_revisions",
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "operational_read_revision",
      source_id: "private.agent_read_domain_revisions",
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "job_history_read_revision",
      source_id: "private.agent_job_history_revision",
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "contactability_revision",
      source_id: `sha256:${"A".repeat(64)}`,
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "contactability_revision",
      source_id: `sha256:${"a".repeat(63)}`,
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "generic_source_revision",
      source_id: "private.agent_read_domain_revisions",
      version: "revision:1",
    },
  ])("rejects widened legacy or generic atom %#", (atom) => {
    expect(() => canonicalizeP2DomainRevisions([atom])).toThrow(
      P2DomainRevisionError
    );
  });

  it("rejects empty and oversized vectors before canonicalization", () => {
    expect(() => canonicalizeP2DomainRevisions([])).toThrowError(
      "P2_DOMAIN_REVISION_INVALID"
    );
    expect(() =>
      canonicalizeP2DomainRevisions(
        Array.from({ length: 65 }, () => ({
          domain: "customer" as const,
          source_revision: 1,
        }))
      )
    ).toThrowError("P2_DOMAIN_REVISION_INVALID");
  });
});

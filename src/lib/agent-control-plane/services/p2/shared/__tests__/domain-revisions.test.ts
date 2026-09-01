import { describe, expect, it } from "vitest";

import {
  canonicalizeP2DomainRevisions,
  P2DomainRevisionError,
} from "../domain-revisions";

describe("P2 domain-revision canonicalization", () => {
  it("sorts closed P2 domains and the three exact frozen legacy atom families", () => {
    expect(
      canonicalizeP2DomainRevisions([
        {
          source_domain: "operations",
          source_type: "contactability_revision",
          source_id: `sha256:${"c".repeat(64)}`,
          version: "revision:7",
        },
        { domain: "tasks", source_revision: 4 },
        {
          source_domain: "operations",
          source_type: "job_history_read_revision",
          source_id: "private.agent_job_history_revisions",
          version: "revision:9",
        },
        { domain: "customer", source_revision: 3 },
        {
          source_domain: "operations",
          source_type: "operational_read_revision",
          source_id: "private.agent_operational_read_revisions",
          version: "revision:8",
        },
      ])
    ).toEqual([
      { domain: "customer", source_revision: 3 },
      {
        domain: `legacy_c:${BigInt(`0x${"c".repeat(64)}`)
          .toString(36)
          .padStart(50, "0")}`,
        source_revision: 7,
      },
      { domain: "legacy_job_history", source_revision: 9 },
      { domain: "legacy_operational", source_revision: 8 },
      { domain: "tasks", source_revision: 4 },
    ]);
  });

  it.each([
    {
      source_domain: "operations",
      source_type: "operational_read_revision",
      source_id: "private.any_table",
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "job_history_read_revision",
      source_id: "private.agent_job_history_revisions",
      version: "etag:1",
    },
    {
      source_domain: "operations",
      source_type: "contactability_revision",
      source_id: "person@example.com",
      version: "revision:1",
    },
    {
      source_domain: "operations",
      source_type: "generic_table_revision",
      source_id: "public.opportunities",
      version: "revision:1",
    },
    { domain: "arbitrary_table", source_revision: 1 },
  ])("rejects generic or malformed revision tuple %#", (input) => {
    expect(() => canonicalizeP2DomainRevisions([input])).toThrow(
      P2DomainRevisionError
    );
  });

  it("deduplicates identical atoms but fails conflicting revisions for one identity", () => {
    const atom = {
      source_domain: "operations",
      source_type: "operational_read_revision",
      source_id: "private.agent_operational_read_revisions",
      version: "revision:8",
    } as const;
    expect(canonicalizeP2DomainRevisions([atom, atom])).toEqual([
      { domain: "legacy_operational", source_revision: 8 },
    ]);
    expect(() =>
      canonicalizeP2DomainRevisions([atom, { ...atom, version: "revision:9" }])
    ).toThrowError("P2_DOMAIN_REVISION_CONFLICT");
  });
});

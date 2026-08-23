import { describe, expect, it } from "vitest";

import {
  P2CollectionProofSchema,
  P2EvidenceIdentitySchema,
  P2EntityProofSchema,
} from "../p2-proof";

const REVISIONS = [
  { domain: "artifacts", source_revision: 7 },
  { domain: "tasks", source_revision: 11 },
] as const;

describe("P2 proof contracts", () => {
  it("requires an opaque collection proof for a valid empty result", () => {
    expect(
      P2CollectionProofSchema.parse({
        proof_ref: "ops_proof:v1:4RLekdvZNnWDJSsPLS4N8jSKz0c8nlbO4ajw7qRWH1c",
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: REVISIONS,
        returned_count: 0,
        has_more: false,
      })
    ).toEqual({
      proof_ref: "ops_proof:v1:4RLekdvZNnWDJSsPLS4N8jSKz0c8nlbO4ajw7qRWH1c",
      read_at: "2026-08-23T07:30:00.000Z",
      source_revisions: REVISIONS,
      returned_count: 0,
      has_more: false,
    });
    expect(
      P2CollectionProofSchema.safeParse({
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: REVISIONS,
        returned_count: 0,
        has_more: false,
      }).success
    ).toBe(false);
  });

  it("keeps entity and evidence identities opaque and locator-free", () => {
    expect(
      P2EntityProofSchema.parse({
        proof_ref: "ops_proof:v1:4RLekdvZNnWDJSsPLS4N8jSKz0c8nlbO4ajw7qRWH1c",
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: REVISIONS,
      })
    ).toBeDefined();
    expect(
      P2EvidenceIdentitySchema.parse({
        evidence_ref:
          "ops_evidence:v1:8az3qL1TBUp38Tu1LXbTbcnfVTwJGYtE5yWBYRqmYB8",
        source_domain: "artifacts",
        source_type: "document",
        occurred_at: "2026-08-23T07:29:00.000Z",
      })
    ).toBeDefined();

    for (const forbidden of [
      { source_id: "de305d54-75b4-431b-adb2-eb6b9e546014" },
      { locator: "s3://private/raw" },
      { provider_id: "provider-row-123" },
      { storage_path: "company/private/file.pdf" },
      { signed_url: "https://example.invalid/private" },
    ]) {
      expect(
        P2EvidenceIdentitySchema.safeParse({
          evidence_ref:
            "ops_evidence:v1:8az3qL1TBUp38Tu1LXbTbcnfVTwJGYtE5yWBYRqmYB8",
          source_domain: "artifacts",
          source_type: "document",
          occurred_at: "2026-08-23T07:29:00.000Z",
          ...forbidden,
        }).success
      ).toBe(false);
    }
  });

  it("rejects mutable, malformed, and inconsistent proof identities", () => {
    expect(
      P2CollectionProofSchema.safeParse({
        proof_ref: "raw-row-id",
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: REVISIONS,
        returned_count: 0,
        has_more: false,
      }).success
    ).toBe(false);
    expect(
      P2CollectionProofSchema.safeParse({
        proof_ref: "ops_proof:v1:4RLekdvZNnWDJSsPLS4N8jSKz0c8nlbO4ajw7qRWH1c",
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: REVISIONS,
        returned_count: 0,
        has_more: true,
      }).success
    ).toBe(false);
    expect(
      P2CollectionProofSchema.safeParse({
        proof_ref: "ops_proof:v1:4RLekdvZNnWDJSsPLS4N8jSKz0c8nlbO4ajw7qRWH1c",
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: [...REVISIONS].reverse(),
        returned_count: 2,
        has_more: false,
      }).success
    ).toBe(false);
    expect(
      P2CollectionProofSchema.safeParse({
        proof_ref: "ops_proof:v1:4RLekdvZNnWDJSsPLS4N8jSKz0c8nlbO4ajw7qRWH1c",
        read_at: "2026-08-23T07:30:00.000Z",
        source_revisions: REVISIONS,
        returned_count: 26,
        has_more: false,
      }).success
    ).toBe(false);
  });
});

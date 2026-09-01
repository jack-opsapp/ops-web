import { describe, expect, it } from "vitest";

import {
  ARTIFACT_SOURCE_KINDS,
  ARTIFACT_SOURCE_SCHEMA_REVISION,
  ArtifactMetadataSchema,
  GetJobArtifactEvidenceInputSchema,
  GetJobArtifactEvidenceSourceResultSchema,
  JobArtifactListInputSchema,
  ListJobArtifactsResultSchema,
  assertNoArtifactForbiddenFields,
} from "../job-artifacts";

const UUIDS = {
  job: "11111111-1111-4111-8111-111111111111",
} as const;
const READ_AT = "2026-08-23T12:00:00.000Z";
const REVISIONS = [
  { domain: "artifacts", source_revision: 7 },
  { domain: "legacy_operational", source_revision: 11 },
] as const;

function opaque(prefix: "evidence" | "proof", fill: string) {
  return `ops_${prefix}:v1:${fill.repeat(64)}`;
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    evidence_ref: opaque("evidence", "a"),
    source_kind: "project_photo",
    artifact_kind: "photo",
    occurred_at: "2026-08-22T10:00:00.000Z",
    display_name: {
      text: "Rear elevation",
      content_kind: "untrusted_business_data",
    },
    note_excerpt: null,
    review_state: "not_applicable",
    client_visibility: "visible",
    mime_family: "image",
    byte_size: 1_024,
    availability: "available",
    inspection_state: "not_required",
    ...overrides,
  };
}

function proof(ref: string, returnedCount?: number, hasMore?: boolean) {
  return {
    proof_ref: ref,
    read_at: READ_AT,
    source_revisions: REVISIONS,
    ...(returnedCount === undefined
      ? {}
      : { returned_count: returnedCount, has_more: hasMore }),
  };
}

function evidence(ref: string) {
  return {
    evidence_ref: ref,
    source_domain: "artifacts",
    source_type: "project_photo",
    occurred_at: READ_AT,
  };
}

describe("P2 job artifact contracts", () => {
  it("freezes one immutable schema revision and a closed source vocabulary", () => {
    expect(ARTIFACT_SOURCE_SCHEMA_REVISION).toBe("2026-08-22.v1");
    expect(ARTIFACT_SOURCE_KINDS).toEqual([
      "deck_design",
      "email_attachment",
      "expense_receipt",
      "generated_estimate",
      "generated_invoice",
      "project_note",
      "project_photo",
      "site_visit_artifact",
    ]);
    expect(Object.isFrozen(ARTIFACT_SOURCE_KINDS)).toBe(true);
  });

  it("accepts only one exact job, unique explicitly selected sources, and a 25 item page", () => {
    expect(
      JobArtifactListInputSchema.parse({
        job_ref: { kind: "project", id: UUIDS.job },
        source_kinds: ["project_photo", "project_note"],
      })
    ).toEqual({
      job_ref: { kind: "project", id: UUIDS.job },
      source_kinds: ["project_photo", "project_note"],
      limit: 25,
    });

    for (const invalid of [
      {
        job_ref: { kind: "project", id: UUIDS.job },
        source_kinds: ["project_photo", "project_photo"],
      },
      {
        job_ref: { kind: "project", id: UUIDS.job },
        source_kinds: [],
      },
      {
        job_ref: { kind: "project", id: UUIDS.job },
        source_kinds: ["raw_storage"],
      },
      {
        job_ref: { kind: "project", id: UUIDS.job },
        source_kinds: ["project_photo"],
        limit: 26,
      },
      {
        job_ref: { kind: "project", id: UUIDS.job },
        source_kinds: ["project_photo"],
        company_id: UUIDS.job,
      },
    ]) {
      expect(JobArtifactListInputSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts exact evidence only through an opaque reference and rejects selectors that bypass discovery", () => {
    const input = {
      job_ref: { kind: "opportunity", id: UUIDS.job },
      source_kind: "project_photo",
      evidence_ref: opaque("evidence", "b"),
    };
    expect(GetJobArtifactEvidenceInputSchema.parse(input)).toEqual(input);
    for (const bypass of [
      { ...input, artifact_id: UUIDS.job },
      { ...input, filename: "receipt.pdf" },
      { ...input, storage_path: "private/receipt.pdf" },
      { ...input, source_url: "https://example.test/file" },
    ]) {
      expect(GetJobArtifactEvidenceInputSchema.safeParse(bypass).success).toBe(
        false
      );
    }
  });

  it("projects safe metadata and forbids raw paths, providers, identity, annotations, and receipt internals", () => {
    expect(ArtifactMetadataSchema.parse(metadata())).toEqual(metadata());
    const forbidden = [
      "storage_path",
      "source_url",
      "provider_id",
      "created_by",
      "uploaded_by",
      "from_email",
      "annotation_url",
      "layers",
      "dimensions",
      "drawing_data",
      "ocr_raw_data",
      "receipt_image_url",
      "receipt_thumbnail_url",
    ];
    for (const field of forbidden) {
      const candidate = metadata({ [field]: "secret" });
      expect(ArtifactMetadataSchema.safeParse(candidate).success, field).toBe(
        false
      );
      expect(() => assertNoArtifactForbiddenFields(candidate), field).toThrow();
    }
  });

  it("keeps a site-visit deck artifact linked to its opaque deck design identity", () => {
    expect(
      ArtifactMetadataSchema.parse(
        metadata({
          source_kind: "site_visit_artifact",
          artifact_kind: "deck_design",
          mime_family: "other",
          byte_size: null,
          availability: "unavailable",
          deck_design_ref: `ops_deck_design:v1:${"a".repeat(64)}`,
        })
      )
    ).toMatchObject({
      source_kind: "site_visit_artifact",
      artifact_kind: "deck_design",
      deck_design_ref: `ops_deck_design:v1:${"a".repeat(64)}`,
    });
  });

  it("couples list items, proofs, evidence identities, ordering, and pagination atomically", () => {
    const firstRef = opaque("evidence", "a");
    const secondRef = opaque("evidence", "b");
    const result = {
      items: [
        metadata({ evidence_ref: firstRef }),
        metadata({
          evidence_ref: secondRef,
          source_kind: "project_note",
          artifact_kind: "note",
          occurred_at: "2026-08-21T10:00:00.000Z",
          mime_family: "text",
          byte_size: null,
        }),
      ],
      item_proofs: [proof(opaque("proof", "a")), proof(opaque("proof", "b"))],
      evidence: [evidence(firstRef), evidence(secondRef)],
      next_cursor: null,
      collection_proof: proof(opaque("proof", "c"), 2, false),
    };
    expect(ListJobArtifactsResultSchema.parse(result)).toEqual(result);

    expect(
      ListJobArtifactsResultSchema.safeParse({
        ...result,
        items: [...result.items].reverse(),
      }).success
    ).toBe(false);
    expect(
      ListJobArtifactsResultSchema.safeParse({
        ...result,
        evidence: [result.evidence[0]],
      }).success
    ).toBe(false);
    expect(
      ListJobArtifactsResultSchema.safeParse({
        ...result,
        collection_proof: proof(opaque("proof", "c"), 2, true),
      }).success
    ).toBe(false);
  });

  it("returns bounded inline text or a binary source readiness marker without a URL", () => {
    const inline = {
      artifact: metadata({
        source_kind: "project_note",
        artifact_kind: "note",
        mime_family: "text",
        byte_size: null,
      }),
      content: {
        kind: "inline_text",
        text: "Customer asked for black pickets on the rear deck.",
        content_kind: "untrusted_business_data",
      },
      evidence: [evidence(opaque("evidence", "a"))],
      proof: proof(opaque("proof", "a")),
    };
    expect(GetJobArtifactEvidenceSourceResultSchema.parse(inline)).toEqual(
      inline
    );

    const binary = {
      artifact: metadata(),
      content: {
        kind: "binary_resource",
        delivery_state: "ready_for_single_use_delivery",
        mime_family: "image",
        byte_size: 1_024,
      },
      evidence: [evidence(opaque("evidence", "a"))],
      proof: proof(opaque("proof", "a")),
    };
    expect(GetJobArtifactEvidenceSourceResultSchema.parse(binary)).toEqual(
      binary
    );
    expect(JSON.stringify(binary)).not.toMatch(/https?:|storage|object_key/i);
  });

  it("rejects binary delivery unless the current source is available and inspection-safe", () => {
    for (const artifact of [
      metadata({ availability: "pending" }),
      metadata({ availability: "blocked" }),
      metadata({ inspection_state: "pending" }),
      metadata({ inspection_state: "failed" }),
      metadata({ mime_family: "other" }),
    ]) {
      expect(
        GetJobArtifactEvidenceSourceResultSchema.safeParse({
          artifact,
          content: {
            kind: "binary_resource",
            delivery_state: "ready_for_single_use_delivery",
            mime_family: artifact.mime_family,
            byte_size: artifact.byte_size,
          },
          evidence: [evidence(opaque("evidence", "a"))],
          proof: proof(opaque("proof", "a")),
        }).success
      ).toBe(false);
    }
  });
});

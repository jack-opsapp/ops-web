import { describe, expect, it } from "vitest";

import {
  deckDesignRef,
  deckGeometryDrawingContentHash,
  deckGeometryEvidenceRef,
  deckGeometrySourceFence,
} from "../deck-geometry-proof";
import {
  DECK_GEOMETRY_COMPANY_ID,
  DECK_GEOMETRY_DESIGN_ID,
  DECK_GEOMETRY_JOB_ID,
  deckGeometryAuthorization,
} from "./deck-geometry-service-fixtures";

const REVISIONS = [
  { domain: "artifacts", source_revision: 1 },
  { domain: "deck_designs", source_revision: 2 },
  { domain: "legacy_operational", source_revision: 3 },
  { domain: "site_visits", source_revision: 4 },
] as const;

describe("P2 deck-geometry proof identities", () => {
  it("derives deterministic opaque design and evidence identities", () => {
    const designRef = deckDesignRef({
      companyId: DECK_GEOMETRY_COMPANY_ID,
      designId: DECK_GEOMETRY_DESIGN_ID,
    });
    const contentHash = deckGeometryDrawingContentHash('{"safe":true}');
    const evidenceRef = deckGeometryEvidenceRef({
      companyId: DECK_GEOMETRY_COMPANY_ID,
      designId: DECK_GEOMETRY_DESIGN_ID,
      drawingContentHash: contentHash,
    });

    expect(designRef).toMatch(/^ops_deck_design:v1:[0-9a-f]{64}$/);
    expect(contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidenceRef).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(
      deckDesignRef({
        companyId: DECK_GEOMETRY_COMPANY_ID,
        designId: DECK_GEOMETRY_DESIGN_ID,
      })
    ).toBe(designRef);
  });

  it("binds the opaque fence to authority, source, anchor, and all four revisions", async () => {
    const authorization = await deckGeometryAuthorization({
      source: "job_artifact",
      job_ref: { kind: "project", id: DECK_GEOMETRY_JOB_ID },
      deck_design_ref: deckDesignRef({
        companyId: DECK_GEOMETRY_COMPANY_ID,
        designId: DECK_GEOMETRY_DESIGN_ID,
      }),
    });
    const base = {
      authorization,
      selectedAuthorization: authorization.authorizationCandidates[0]!,
      designId: DECK_GEOMETRY_DESIGN_ID,
      drawingContentHash: deckGeometryDrawingContentHash('{"safe":true}'),
      authorityPath: "job_project" as const,
      designParents: {
        opportunityId: null,
        projectId: DECK_GEOMETRY_JOB_ID,
      },
      sourceRevisions: REVISIONS,
    };
    const fence = deckGeometrySourceFence(base);

    expect(fence).toMatch(/^ops_deck_geometry_fence:v1:[A-Za-z0-9_-]{43}$/);
    expect(deckGeometrySourceFence(base)).toBe(fence);
    expect(
      deckGeometrySourceFence({
        ...base,
        drawingContentHash: deckGeometryDrawingContentHash('{"safe":false}'),
      })
    ).not.toBe(fence);
    expect(
      deckGeometrySourceFence({
        ...base,
        sourceRevisions: [
          REVISIONS[0],
          { domain: "deck_designs", source_revision: 5 },
          REVISIONS[2],
          REVISIONS[3],
        ],
      })
    ).not.toBe(fence);
    expect(
      deckGeometrySourceFence({
        ...base,
        designParents: {
          opportunityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          projectId: DECK_GEOMETRY_JOB_ID,
        },
      })
    ).not.toBe(fence);
  });

  it("binds the fence to the exact database-selected authorization candidate", async () => {
    const authorization = await deckGeometryAuthorization({
      source: "site_visit_artifact",
      site_visit_ref: {
        kind: "site_visit",
        id: "55555555-5555-4555-8555-555555555555",
      },
      deck_design_ref: deckDesignRef({
        companyId: DECK_GEOMETRY_COMPANY_ID,
        designId: DECK_GEOMETRY_DESIGN_ID,
      }),
    });
    expect(authorization.authorizationCandidates).toHaveLength(2);
    const base = {
      authorization,
      designId: DECK_GEOMETRY_DESIGN_ID,
      drawingContentHash: deckGeometryDrawingContentHash('{"safe":true}'),
      authorityPath: "site_visit_linked" as const,
      designParents: {
        opportunityId: DECK_GEOMETRY_JOB_ID,
        projectId: null,
      },
      sourceRevisions: REVISIONS,
    };
    const linked = deckGeometrySourceFence({
      ...base,
      selectedAuthorization: authorization.authorizationCandidates[0]!,
    });
    const unlinked = deckGeometrySourceFence({
      ...base,
      selectedAuthorization: authorization.authorizationCandidates[1]!,
    });

    expect(linked).not.toBe(unlinked);
    expect(() =>
      deckGeometrySourceFence({
        ...base,
        selectedAuthorization: {
          ...authorization.authorizationCandidates[0]!,
        },
      })
    ).toThrow("DECK_GEOMETRY_AUTHORIZATION_SELECTION_INVALID");
  });

  it("rejects an incomplete or reordered revision vector", async () => {
    const authorization = await deckGeometryAuthorization();
    const base = {
      authorization,
      selectedAuthorization: authorization.authorizationCandidates[0]!,
      designId: DECK_GEOMETRY_DESIGN_ID,
      drawingContentHash: deckGeometryDrawingContentHash("{}"),
      authorityPath: "job_project" as const,
      designParents: {
        opportunityId: null,
        projectId: DECK_GEOMETRY_JOB_ID,
      },
    };
    expect(() =>
      deckGeometrySourceFence({
        ...base,
        sourceRevisions: REVISIONS.slice(1),
      })
    ).toThrow("DECK_GEOMETRY_REVISION_VECTOR_INVALID");
    expect(() =>
      deckGeometrySourceFence({
        ...base,
        sourceRevisions: [
          REVISIONS[1],
          REVISIONS[0],
          REVISIONS[2],
          REVISIONS[3],
        ],
      })
    ).toThrow("DECK_GEOMETRY_REVISION_VECTOR_INVALID");
  });
});

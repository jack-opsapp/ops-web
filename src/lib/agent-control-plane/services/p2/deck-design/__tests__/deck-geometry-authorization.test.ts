import { describe, expect, it } from "vitest";

import { DeckDesignGeometryInputSchema } from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import {
  DeckGeometryReadAuthorizationError,
  authorizeDeckDesignGeometryRead,
  isAuthorizedDeckDesignGeometryRead,
} from "../deck-geometry-authorization";
import {
  DECK_GEOMETRY_CLIENT_ID,
  DECK_GEOMETRY_DECK_REF,
  DECK_GEOMETRY_GRANT_ID,
  DECK_GEOMETRY_JOB_ID,
  DECK_GEOMETRY_SITE_VISIT_ID,
  deckGeometryCandidateAuthorizations,
} from "./deck-geometry-service-fixtures";

const MINIMAL_UNLINKED_OAUTH_SCOPES = [
  "ops.files.read",
  "ops.jobs.read",
  "ops.site_visits.read",
] as const;

function siteVisitQuery() {
  return DeckDesignGeometryInputSchema.parse({
    source: "site_visit_artifact",
    site_visit_ref: {
      kind: "site_visit",
      id: DECK_GEOMETRY_SITE_VISIT_ID,
    },
    deck_design_ref: DECK_GEOMETRY_DECK_REF,
  });
}

describe("P2 deck-geometry nominal authorization", () => {
  it("mints exact current-project authority from the opaque job anchor", async () => {
    const query = DeckDesignGeometryInputSchema.parse({
      source: "job_artifact",
      job_ref: { kind: "project", id: DECK_GEOMETRY_JOB_ID },
      deck_design_ref: DECK_GEOMETRY_DECK_REF,
    });
    const proof = authorizeDeckDesignGeometryRead({
      query,
      authorizations: await deckGeometryCandidateAuthorizations({
        query,
        permissions: {
          "calendar.view": null,
          "clients.view": null,
          "deck_builder.view": "assigned",
          "pipeline.view": null,
          "projects.view": "assigned",
        },
      }),
    });

    expect(isAuthorizedDeckDesignGeometryRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "get_deck_design_geometry",
      capabilityRevision: "get_deck_design_geometry:2026-08-22.v1",
      oauthGrantId: DECK_GEOMETRY_GRANT_ID,
      oauthClientId: DECK_GEOMETRY_CLIENT_ID,
      variantKeys: ["job_artifact_project"],
      authorizationCandidates: [
        {
          variantKey: "job_artifact_project",
          requiredOAuthScopes: ["ops.files.read", "ops.jobs.read"],
          resolvedPermissionScopes: {
            "deck_builder.view": "assigned",
            "projects.view": "assigned",
          },
          satisfiedPermissionGroupIndexes: [0],
          calendarScope: null,
          clientsScope: null,
          deckBuilderScope: "assigned",
          pipelineScope: null,
          projectsScope: "assigned",
        },
      ],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.query)).toBe(true);
    expect(Object.isFrozen(proof.authorizationCandidates)).toBe(true);
    expect(Object.isFrozen(proof.authorizationCandidates[0])).toBe(true);
  });

  it.each([
    ["opportunity", "job_artifact_opportunity"],
    ["project", "job_artifact_project"],
  ] as const)(
    "records the optional dual-parent permissions for a %s job anchor",
    async (jobKind, variantKey) => {
      const query = DeckDesignGeometryInputSchema.parse({
        source: "job_artifact",
        job_ref: { kind: jobKind, id: DECK_GEOMETRY_JOB_ID },
        deck_design_ref: DECK_GEOMETRY_DECK_REF,
      });
      const proof = authorizeDeckDesignGeometryRead({
        query,
        authorizations: await deckGeometryCandidateAuthorizations({
          query,
          permissions: {
            "calendar.view": null,
            "clients.view": null,
            "deck_builder.view": "assigned",
            "pipeline.view": "assigned",
            "projects.view": "assigned",
          },
        }),
      });

      expect(proof.authorizationCandidates).toEqual([
        expect.objectContaining({
          variantKey,
          resolvedPermissionScopes: {
            "deck_builder.view": "assigned",
            "pipeline.view": "assigned",
            "projects.view": "assigned",
          },
          satisfiedPermissionGroupIndexes: [0, 1],
          pipelineScope: "assigned",
          projectsScope: "assigned",
        }),
      ]);
    }
  );

  it("retains only linked authority when the unlinked policy is not satisfied", async () => {
    const query = siteVisitQuery();
    const proof = authorizeDeckDesignGeometryRead({
      query,
      authorizations: await deckGeometryCandidateAuthorizations({
        query,
        permissions: {
          "calendar.view": "own",
          "clients.view": "assigned",
          "deck_builder.view": "assigned",
          "pipeline.view": "assigned",
          "projects.view": null,
        },
      }),
    });

    expect(proof.variantKeys).toEqual(["site_visit_artifact_linked"]);
    expect(proof.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "site_visit_artifact_linked",
        calendarScope: "own",
        clientsScope: "assigned",
        deckBuilderScope: "assigned",
        pipelineScope: "assigned",
        projectsScope: null,
        satisfiedPermissionGroupIndexes: [0],
      }),
    ]);
  });

  it("mints minimal unlinked authority without customer or schedule OAuth scopes", async () => {
    const query = siteVisitQuery();
    const proof = authorizeDeckDesignGeometryRead({
      query,
      authorizations: await deckGeometryCandidateAuthorizations({
        query,
        oauthScopes: MINIMAL_UNLINKED_OAUTH_SCOPES,
        permissions: {
          "calendar.view": null,
          "clients.view": null,
          "deck_builder.view": "all",
          "pipeline.view": "all",
          "projects.view": null,
        },
      }),
    });

    expect(proof.grantedScopeCeiling).toEqual(MINIMAL_UNLINKED_OAUTH_SCOPES);
    expect(proof.variantKeys).toEqual(["site_visit_artifact_unlinked"]);
    expect(proof.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "site_visit_artifact_unlinked",
        requiredOAuthScopes: MINIMAL_UNLINKED_OAUTH_SCOPES,
        resolvedPermissionScopes: {
          "deck_builder.view": "all",
          "pipeline.view": "all",
        },
        calendarScope: null,
        clientsScope: null,
        deckBuilderScope: "all",
        pipelineScope: "all",
        projectsScope: null,
        satisfiedPermissionGroupIndexes: [0, 2],
      }),
    ]);
  });

  it("retains both valid site-visit candidates in canonical order", async () => {
    const query = siteVisitQuery();
    const proof = authorizeDeckDesignGeometryRead({
      query,
      authorizations: await deckGeometryCandidateAuthorizations({ query }),
    });

    expect(proof.variantKeys).toEqual([
      "site_visit_artifact_linked",
      "site_visit_artifact_unlinked",
    ]);
    expect(
      proof.authorizationCandidates.map(({ variantKey }) => variantKey)
    ).toEqual(proof.variantKeys);
    expect(Object.isFrozen(proof.variantKeys)).toBe(true);
    expect(Object.isFrozen(proof.authorizationCandidates)).toBe(true);
    for (const candidate of proof.authorizationCandidates) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.requiredOAuthScopes)).toBe(true);
      expect(Object.isFrozen(candidate.resolvedPermissionScopes)).toBe(true);
      expect(Object.isFrozen(candidate.satisfiedPermissionGroupIndexes)).toBe(
        true
      );
    }
  });

  it("rejects a site visit when neither linked nor unlinked authority is valid", async () => {
    const query = siteVisitQuery();
    const authorizations = await deckGeometryCandidateAuthorizations({
      query,
      oauthScopes: MINIMAL_UNLINKED_OAUTH_SCOPES,
      permissions: {
        "calendar.view": null,
        "clients.view": null,
        "deck_builder.view": "assigned",
        "pipeline.view": "assigned",
        "projects.view": null,
      },
    });

    expect(authorizations).toEqual({});
    expect(() =>
      authorizeDeckDesignGeometryRead({ query, authorizations })
    ).toThrow(DeckGeometryReadAuthorizationError);
  });

  it("rejects extra, borrowed, reconstructed, and mixed-actor site candidates", async () => {
    const query = siteVisitQuery();
    const exact = await deckGeometryCandidateAuthorizations({ query });
    const linkedOnly = await deckGeometryCandidateAuthorizations({
      query,
      permissions: {
        "calendar.view": "own",
        "clients.view": "assigned",
        "deck_builder.view": "assigned",
        "pipeline.view": "assigned",
        "projects.view": null,
      },
    });
    const unlinkedOnly = await deckGeometryCandidateAuthorizations({
      query,
      oauthScopes: MINIMAL_UNLINKED_OAUTH_SCOPES,
      permissions: {
        "calendar.view": null,
        "clients.view": null,
        "deck_builder.view": "all",
        "pipeline.view": "all",
        "projects.view": null,
      },
    });
    const linked = exact.site_visit_artifact_linked;
    const unlinked = exact.site_visit_artifact_unlinked;

    for (const invalid of [
      {},
      { ...exact, extra: linked },
      { site_visit_artifact_linked: unlinked },
      { site_visit_artifact_linked: { ...linked } },
      {
        site_visit_artifact_linked: linkedOnly.site_visit_artifact_linked,
        site_visit_artifact_unlinked: unlinkedOnly.site_visit_artifact_unlinked,
      },
    ]) {
      expect(() =>
        authorizeDeckDesignGeometryRead({ query, authorizations: invalid })
      ).toThrow(DeckGeometryReadAuthorizationError);
    }
  });

  it("rejects missing, extra, and reconstructed job authorization records", async () => {
    const query = DeckDesignGeometryInputSchema.parse({
      source: "job_artifact",
      job_ref: { kind: "opportunity", id: DECK_GEOMETRY_JOB_ID },
      deck_design_ref: DECK_GEOMETRY_DECK_REF,
    });
    const exact = await deckGeometryCandidateAuthorizations({ query });
    for (const invalid of [
      {},
      { ...exact, extra: exact.job_artifact_opportunity },
      { job_artifact_opportunity: { ...exact.job_artifact_opportunity } },
    ]) {
      expect(() =>
        authorizeDeckDesignGeometryRead({ query, authorizations: invalid })
      ).toThrow(DeckGeometryReadAuthorizationError);
    }
  });

  it("rejects accessor and non-enumerable authorization entries before binding", async () => {
    const query = DeckDesignGeometryInputSchema.parse({
      source: "job_artifact",
      job_ref: { kind: "opportunity", id: DECK_GEOMETRY_JOB_ID },
      deck_design_ref: DECK_GEOMETRY_DECK_REF,
    });
    const exact = await deckGeometryCandidateAuthorizations({ query });
    let getterCalls = 0;
    const accessorRecord = Object.defineProperty(
      {},
      "job_artifact_opportunity",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return exact.job_artifact_opportunity;
        },
      }
    );
    const hiddenRecord = Object.defineProperty({}, "job_artifact_opportunity", {
      enumerable: false,
      value: exact.job_artifact_opportunity,
    });

    expect(() =>
      authorizeDeckDesignGeometryRead({
        query,
        authorizations: accessorRecord,
      })
    ).toThrow(DeckGeometryReadAuthorizationError);
    expect(getterCalls).toBe(0);
    expect(() =>
      authorizeDeckDesignGeometryRead({
        query,
        authorizations: hiddenRecord,
      })
    ).toThrow(DeckGeometryReadAuthorizationError);
  });
});

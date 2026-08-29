import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS,
  GET_DECK_DESIGN_GEOMETRY_CANDIDATE,
  selectedDeckDesignGeometryVariantKeys,
} from "../deck-design";

const UUID = "11111111-1111-4111-8111-111111111111";
const DECK_REF = `ops_deck_design:v1:${"a".repeat(64)}`;

describe("P2 deck-design geometry candidate", () => {
  it("stays implementation-only while pinning the read-only boundary", () => {
    expect(GET_DECK_DESIGN_GEOMETRY_CANDIDATE).toMatchObject({
      name: "get_deck_design_geometry",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      bounds: {
        maxInputBytes: 8_192,
        maxOutputCharacters: 60_000,
        maxResultItems: 1,
      },
      availability: { implementation: "available" },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(
      CAPABILITY_MANIFEST.some(
        (capability) => capability.name === "get_deck_design_geometry"
      )
    ).toBe(false);
  });

  it("pins one nominal policy variant for each opaque anchor", () => {
    expect(DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "job_artifact_opportunity",
      "job_artifact_project",
      "site_visit_artifact_linked",
      "site_visit_artifact_unlinked",
    ]);
    const variants = GET_DECK_DESIGN_GEOMETRY_CANDIDATE.authorization.variants;
    expect(variants.map((variant) => variant.key)).toEqual(
      DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS
    );

    const opportunity = variants[0]!.policy;
    expect(opportunity.requiredOAuthScopes).toEqual([
      "ops.files.read",
      "ops.jobs.read",
    ]);
    expect(opportunity.permissionRequirementGroups).toEqual([
      [
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
    ]);

    const project = variants[1]!.policy;
    expect(project.requiredOAuthScopes).toEqual([
      "ops.files.read",
      "ops.jobs.read",
    ]);
    expect(project.permissionRequirementGroups).toEqual([
      [
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
    ]);

    const linkedVisit = variants[2]!.policy;
    expect(linkedVisit.requiredOAuthScopes).toEqual([
      "ops.customers.read",
      "ops.files.read",
      "ops.jobs.read",
      "ops.schedule.read",
      "ops.site_visits.read",
    ]);
    expect(linkedVisit.permissionRequirementGroups).toEqual([
      [
        { permission: "calendar.view", allowedScopes: ["all", "own"] },
        { permission: "clients.view", allowedScopes: ["all", "assigned"] },
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "calendar.view", allowedScopes: ["all", "own"] },
        { permission: "clients.view", allowedScopes: ["all", "assigned"] },
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "calendar.view", allowedScopes: ["all", "own"] },
        { permission: "clients.view", allowedScopes: ["all", "assigned"] },
        { permission: "deck_builder.view", allowedScopes: ["all"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
      ],
    ]);

    const unlinkedVisit = variants[3]!.policy;
    expect(unlinkedVisit.requiredOAuthScopes).toEqual([
      "ops.files.read",
      "ops.jobs.read",
      "ops.site_visits.read",
    ]);
    expect(unlinkedVisit.permissionRequirementGroups).toEqual([
      [
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all"] },
      ],
      [
        { permission: "deck_builder.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "deck_builder.view", allowedScopes: ["all"] },
        { permission: "pipeline.view", allowedScopes: ["all"] },
      ],
    ]);
  });

  it("selects exactly one variant from the strict input union", () => {
    expect(
      selectedDeckDesignGeometryVariantKeys({
        source: "job_artifact",
        job_ref: { kind: "opportunity", id: UUID },
        deck_design_ref: DECK_REF,
      })
    ).toEqual({
      required: ["job_artifact_opportunity"],
      alternatives: [],
    });
    expect(
      selectedDeckDesignGeometryVariantKeys({
        source: "job_artifact",
        job_ref: { kind: "project", id: UUID },
        deck_design_ref: DECK_REF,
      })
    ).toEqual({
      required: ["job_artifact_project"],
      alternatives: [],
    });
    expect(
      selectedDeckDesignGeometryVariantKeys({
        source: "site_visit_artifact",
        site_visit_ref: { kind: "site_visit", id: UUID },
        deck_design_ref: DECK_REF,
      })
    ).toEqual({
      required: [],
      alternatives: [
        ["site_visit_artifact_linked"],
        ["site_visit_artifact_unlinked"],
      ],
    });
  });
});

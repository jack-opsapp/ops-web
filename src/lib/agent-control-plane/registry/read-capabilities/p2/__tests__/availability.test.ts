import { describe, expect, it } from "vitest";

import {
  LIST_TEAM_AVAILABILITY_CANDIDATE,
  selectedTeamAvailabilityVariantKeys,
} from "../availability";

function permissionShape() {
  return LIST_TEAM_AVAILABILITY_CANDIDATE.authorization.variants.map(
    (variant) => ({
      key: variant.key,
      scopes: variant.policy.requiredOAuthScopes,
      groups: variant.policy.permissionRequirementGroups.map((group) =>
        group.map((requirement) => ({
          permission: requirement.permission,
          scopes: requirement.allowedScopes,
        }))
      ),
    })
  );
}

describe("P2 team availability candidate", () => {
  it("pins exact company and self-only authorization without widening own calendar access", () => {
    expect(permissionShape()).toEqual([
      {
        key: "company",
        scopes: ["ops.team.read"],
        groups: [
          [
            { permission: "calendar.view", scopes: ["all"] },
            { permission: "team.view", scopes: ["all"] },
          ],
        ],
      },
      {
        key: "self",
        scopes: ["ops.team.read"],
        groups: [[{ permission: "calendar.view", scopes: ["all", "own"] }]],
      },
    ]);
  });

  it("selects exactly one closed variant from the parsed view", () => {
    expect(
      selectedTeamAvailabilityVariantKeys({
        view: "company",
        starts_on: "2026-11-01",
        ends_on: "2026-11-07",
      })
    ).toEqual(["company"]);
    expect(
      selectedTeamAvailabilityVariantKeys({
        view: "self",
        starts_on: "2026-11-01",
        ends_on: "2026-11-07",
      })
    ).toEqual(["self"]);
    expect(() =>
      selectedTeamAvailabilityVariantKeys({
        view: "assigned",
        starts_on: "2026-11-01",
        ends_on: "2026-11-07",
      })
    ).toThrow();
  });

  it("is a dark high-risk read with strict bounds and no confirmation", () => {
    expect(LIST_TEAM_AVAILABILITY_CANDIDATE).toMatchObject({
      name: "list_team_availability",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      riskTier: "high",
      bounds: {
        maxInputBytes: 12_000,
        maxOutputCharacters: 60_000,
        maxResultItems: 10,
        maxWindowDays: 31,
      },
      evidencePolicy: {
        output: "required",
        maxEvidenceRefs: 10,
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      confirmationPolicy: { kind: "not_required" },
      idempotencyPolicy: { kind: "inherent" },
      availability: { implementation: "available" },
      rolloutFlag: "agent_control_plane.capability.list_team_availability",
    });
  });
});

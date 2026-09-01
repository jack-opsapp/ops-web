import { describe, expect, it } from "vitest";

import {
  LIST_TEAM_MEMBERS_CANDIDATE,
  selectedTeamDirectoryVariantKeys,
} from "../team";

describe("P2 team-directory candidate policy", () => {
  it("pins one exact all-team read policy under the reserved v8 identity", () => {
    expect(LIST_TEAM_MEMBERS_CANDIDATE).toMatchObject({
      name: "list_team_members",
      operation: "read",
      bounds: {
        maxInputBytes: 12_000,
        maxOutputCharacters: 60_000,
        maxResultItems: 25,
      },
      availability: { implementation: "available" },
      authorization: {
        variants: [
          {
            key: "team",
            policy: {
              capabilityId: "list_team_members",
              capabilityRevision: "list_team_members:2026-08-22.v1",
              capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
              requiredOAuthScopes: ["ops.team.read"],
              permissionRequirementGroups: [
                [
                  {
                    permission: "team.view",
                    allowedScopes: ["all"],
                  },
                ],
              ],
            },
          },
        ],
      },
    });
  });

  it("selects only the team variant and remains implementation-only", () => {
    expect(selectedTeamDirectoryVariantKeys({ limit: 25 })).toEqual(["team"]);
    expect(() =>
      selectedTeamDirectoryVariantKeys({ include_inactive: true })
    ).toThrow();
    expect(Object.isFrozen(LIST_TEAM_MEMBERS_CANDIDATE)).toBe(true);
    expect(Object.keys(LIST_TEAM_MEMBERS_CANDIDATE.availability)).toEqual([
      "implementation",
    ]);
  });
});

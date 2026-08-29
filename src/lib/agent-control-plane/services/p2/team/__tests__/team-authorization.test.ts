import { describe, expect, it } from "vitest";

import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { LIST_TEAM_MEMBERS_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/team";
import {
  authorizeTeamDirectoryRead,
  isAuthorizedTeamDirectoryRead,
  TeamDirectoryAuthorizationError,
} from "../team-authorization";
import {
  TEAM_CLIENT_ID,
  TEAM_GRANT_ID,
  TEAM_GRANT_REVISION,
  teamActorContext,
} from "./team-fixtures";

function policy() {
  return LIST_TEAM_MEMBERS_CANDIDATE.authorization.variants[0]!.policy;
}

describe("P2 team-directory nominal authorization", () => {
  it("mints exact full-team MCP authority and freezes the parsed query", async () => {
    const actorContext = await teamActorContext();
    const nominal = authorizeCapability({ actorContext, policy: policy() });
    const proof = authorizeTeamDirectoryRead({
      query: { limit: 12 },
      authorizations: { team: nominal },
    });

    expect(isAuthorizedTeamDirectoryRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "list_team_members",
      capabilityRevision: "list_team_members:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: ["ops.team.read"],
      oauthGrantId: TEAM_GRANT_ID,
      oauthClientId: TEAM_CLIENT_ID,
      grantRevision: TEAM_GRANT_REVISION,
      grantedScopeCeiling: ["ops.team.read"],
      teamScope: "all",
      query: { limit: 12 },
      variantKeys: ["team"],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.query)).toBe(true);
  });

  it("fails closed on missing, extra, cloned, assigned, or open query authority", async () => {
    const actorContext = await teamActorContext();
    const nominal = authorizeCapability({ actorContext, policy: policy() });
    for (const authorizations of [
      {},
      { team: nominal, extra: nominal },
      { team: { ...nominal } },
    ]) {
      expect(() =>
        authorizeTeamDirectoryRead({ query: {}, authorizations })
      ).toThrow(TeamDirectoryAuthorizationError);
    }
    expect(() =>
      authorizeTeamDirectoryRead({
        query: { include_private: true },
        authorizations: { team: nominal },
      })
    ).toThrow(TeamDirectoryAuthorizationError);
    const assignedContext = await teamActorContext("assigned");
    expect(() =>
      authorizeCapability({ actorContext: assignedContext, policy: policy() })
    ).toThrow();
  });
});

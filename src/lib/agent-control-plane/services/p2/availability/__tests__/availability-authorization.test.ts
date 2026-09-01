import { describe, expect, it } from "vitest";

import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { LIST_TEAM_AVAILABILITY_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/availability";
import {
  authorizeTeamAvailabilityRead,
  isAuthorizedTeamAvailabilityRead,
  TeamAvailabilityAuthorizationError,
} from "../availability-authorization";
import {
  AVAILABILITY_CLIENT_ID,
  AVAILABILITY_GRANT_ID,
  AVAILABILITY_GRANT_REVISION,
  availabilityActorContext,
  availabilityAuthorization,
  companyAvailabilityQuery,
} from "./availability-fixtures";

function policy(key: "company" | "self") {
  const variant = LIST_TEAM_AVAILABILITY_CANDIDATE.authorization.variants.find(
    (candidate) => candidate.key === key
  );
  if (!variant) throw new TypeError("availability policy missing");
  return variant.policy;
}

describe("P2 team-availability authorization", () => {
  it("mints exact frozen full-team authority", async () => {
    const proof = await availabilityAuthorization();
    expect(isAuthorizedTeamAvailabilityRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "list_team_availability",
      capabilityRevision: "list_team_availability:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: ["ops.team.read"],
      oauthGrantId: AVAILABILITY_GRANT_ID,
      oauthClientId: AVAILABILITY_CLIENT_ID,
      grantRevision: AVAILABILITY_GRANT_REVISION,
      grantedScopeCeiling: ["ops.team.read"],
      availabilityScope: "company",
      calendarScope: "all",
      teamScope: "all",
      query: companyAvailabilityQuery({ limit: 10 }),
      variantKeys: ["company"],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.query)).toBe(true);
  });

  it("mints self-only authority for own or all calendar scope without team.view", async () => {
    for (const scope of ["own", "all"] as const) {
      const proof = await availabilityAuthorization(
        {
          view: "self",
          starts_on: "2026-11-01",
          ends_on: "2026-11-03",
        },
        scope
      );
      expect(proof).toMatchObject({
        availabilityScope: "self",
        calendarScope: scope,
        teamScope: null,
        variantKeys: ["self"],
      });
    }
  });

  it("fails closed on mismatched, cloned, extra, or widened bindings", async () => {
    const companyContext = await availabilityActorContext({ view: "company" });
    const company = authorizeCapability({
      actorContext: companyContext,
      policy: policy("company"),
    });
    for (const authorizations of [
      {},
      { self: company },
      { company, extra: company },
      { company: { ...company } },
    ]) {
      expect(() =>
        authorizeTeamAvailabilityRead({
          query: companyAvailabilityQuery(),
          authorizations,
        })
      ).toThrow(TeamAvailabilityAuthorizationError);
    }

    const ownCompanyContext = await availabilityActorContext({
      view: "company",
      calendarScope: "own",
    });
    expect(() =>
      authorizeCapability({
        actorContext: ownCompanyContext,
        policy: policy("company"),
      })
    ).toThrow();

    const selfContext = await availabilityActorContext({ view: "self" });
    const self = authorizeCapability({
      actorContext: selfContext,
      policy: policy("self"),
    });
    expect(() =>
      authorizeTeamAvailabilityRead({
        query: companyAvailabilityQuery(),
        authorizations: { company: self },
      })
    ).toThrow(TeamAvailabilityAuthorizationError);
  });
});

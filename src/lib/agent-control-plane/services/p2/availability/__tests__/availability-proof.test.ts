import { describe, expect, it } from "vitest";

import {
  exactTeamAvailabilitySourceRevisions,
  teamAvailabilityCollectionProofRef,
  teamAvailabilityEntityProofRef,
  teamAvailabilityEvidenceRef,
  teamAvailabilityProofContext,
} from "../availability-proof";
import {
  AVAILABILITY_READ_AT,
  AVAILABILITY_SOURCE_REVISIONS,
  availabilityAuthorization,
  availabilityMember,
} from "./availability-fixtures";

describe("P2 team-availability proofs", () => {
  it("binds authority, civil window, timezone, four revisions, and both physical inspections", async () => {
    const authorization = await availabilityAuthorization();
    const item = availabilityMember();
    const context = teamAvailabilityProofContext({
      authorization,
      cursor: null,
      readAt: AVAILABILITY_READ_AT,
      timezone: "America/Vancouver",
      sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
      memberSourceInspected: 2,
      scheduleSourceInspected: 9,
      sourceHasMore: false,
    });
    expect(context).toMatchObject({
      view: "company",
      starts_on: "2026-11-01",
      ends_on: "2026-11-03",
      company_timezone: "America/Vancouver",
      member_source_inspected: 2,
      schedule_source_inspected: 9,
      source_revisions: AVAILABILITY_SOURCE_REVISIONS,
    });
    expect(teamAvailabilityEntityProofRef({ context, item })).toMatch(
      /^ops_proof:v1:/
    );
    expect(
      teamAvailabilityEvidenceRef({
        context,
        memberRef: item.member_ref,
      })
    ).toMatch(/^ops_evidence:v1:/);
    expect(
      teamAvailabilityCollectionProofRef({
        context,
        returnedCount: 1,
        hasMore: false,
        children: [
          {
            member_ref: item.member_ref,
            proof_ref: `ops_proof:v1:${"a".repeat(64)}`,
            evidence_ref: `ops_evidence:v1:${"b".repeat(64)}`,
          },
        ],
      })
    ).toMatch(/^ops_proof:v1:/);
  });

  it("changes proof identity for capacity, timezone, bounds, or revisions and rejects partial vectors", async () => {
    const authorization = await availabilityAuthorization();
    const item = availabilityMember();
    const base = teamAvailabilityProofContext({
      authorization,
      cursor: null,
      readAt: AVAILABILITY_READ_AT,
      timezone: "America/Vancouver",
      sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
      memberSourceInspected: 1,
      scheduleSourceInspected: 2,
      sourceHasMore: false,
    });
    const changed = teamAvailabilityProofContext({
      authorization,
      cursor: null,
      readAt: AVAILABILITY_READ_AT,
      timezone: "America/Toronto",
      sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
      memberSourceInspected: 1,
      scheduleSourceInspected: 3,
      sourceHasMore: false,
    });
    expect(teamAvailabilityEntityProofRef({ context: base, item })).not.toBe(
      teamAvailabilityEntityProofRef({
        context: changed,
        item: {
          ...item,
          days: item.days.map((day, index) =>
            index === 1
              ? {
                  ...day,
                  state: "limited" as const,
                  committed_minutes: 60,
                  available_minutes: 480,
                }
              : day
          ),
        },
      })
    );
    expect(() =>
      exactTeamAvailabilitySourceRevisions([
        { domain: "availability", source_revision: 3 },
        { domain: "team", source_revision: 11 },
      ])
    ).toThrow("TEAM_AVAILABILITY_REVISION_VECTOR_INVALID");
  });
});
